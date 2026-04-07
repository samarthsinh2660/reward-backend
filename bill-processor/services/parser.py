import json
import time
from openai import OpenAI, RateLimitError
import logging
from openai import OpenAI

from config import OPENAI_API_KEY, ALLOWED_PLATFORMS
from models.schemas import ExtractedBillData, BillItem

logger = logging.getLogger(__name__)


# Module-level singleton — created once, reused across all requests.
# OpenAI client manages its own connection pool internally.
_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=OPENAI_API_KEY)
    return _client


SYSTEM_PROMPT = """You are a bill data extraction assistant for an Indian food delivery and quick-commerce cashback app.
Supported platforms: Zepto, Blinkit, Swiggy, Zomato. Extract from any of these accurately.

Platform identifiers:
- Zepto: "Zepto", "Kiranakart Technologies", zepto.com, GSTIN starting with 27AAGCZ or 29AAGCZ
- Blinkit: "Blinkit", "Grofers", "Blink Commerce", blinkit.com
- Swiggy: "Swiggy", "Bundl Technologies", swiggy.in
- Zomato: "Zomato", zomato.com
If from any other platform, extract accurately but set platform to its actual name.

Return ONLY valid JSON matching this exact schema — no markdown, no explanation:
{
  "platform": "zepto | blinkit | swiggy | zomato | <other lowercase name> | \"unknown\"",
  "order_id": "string or null",
  "order_date": "YYYY-MM-DD or null",
  "merchant_name": "string or null",
  "seller_gstin": "15-char GSTIN string or null",
  "fssai_license": "14-digit FSSAI license number or null",
  "fbo_email": "platform support email from the invoice (e.g. support@zeptonow.com) or null",
  "customer_name": "name from Bill To / Ship To section or null",
  "total_amount": number or null,
  "subtotal": number or null,
  "delivery_fee": number or null,
  "handling_fee": number or null,
  "extra_charges": number or null,
  "discount": number or null,
  "coupon_code": "coupon/promo code string applied or null",
  "taxes": number or null,
  "items": [
    { "name": "string", "hsn_code": "string or null", "quantity": number or null, "unit_price": number or null, "total_price": number or null }
  ],
  "currency": "INR",
  "delivery_city": "string or null",
  "delivery_state": "string or null",
  "delivery_pincode": "string or null",
  "place_of_supply": "state name only or null"
}

Rules:
- All amounts must be numbers, never strings. Use null if not found.
- order_date must be YYYY-MM-DD. Use null if ambiguous.
- handling_fee: sum of ALL known platform charges beyond base delivery — handling fee + late night fee + surge fee + rain fee etc. combined into one number. null if none.
- extra_charges: sum of any remaining fee types not covered by delivery_fee or handling_fee (e.g. packaging fee, convenience fee, any unrecognised charge). null if none.
- discount: total of ALL discounts combined — coupon discount + membership/pass discount + item-level discounts. Always a positive number (deducted from total). null if none.
- coupon_code: the promo/coupon code string visible on the bill (e.g. "ZEPTOSAVE50"). null if none.
- fssai_license: the 14-digit FSSAI license number printed on the invoice. null if not found.
- fbo_email: the platform support email address visible on the invoice (e.g. support@zeptonow.com). null if not found.
- customer_name: the name in the "Bill To" or "Ship To" section. null if not found.
- items: every line item. Extract ALL items — do not truncate. Empty array [] only if truly none found.
- seller_gstin: the seller/FBO GSTIN (15 chars). null if not found.
- Never hallucinate. If a field is absent from the text, use null.
"""


class ParseResult:
    def __init__(
        self,
        passed: bool,
        data: ExtractedBillData | None = None,
        reason: str = "",
        message: str = "",
    ):
        self.passed = passed
        self.data = data
        self.reason = reason
        self.message = message


class ClassifyResult:
    def __init__(self, is_bill: bool, platform: str | None, skipped: bool = False):
        self.is_bill = is_bill
        self.platform = platform  # lowercase platform name or None
        self.skipped = skipped    # True when OpenAI was unavailable — proceed with caution


_CLASSIFY_PROMPT = """You are a document classifier for an Indian food delivery cashback app.
Determine if the text is an order invoice or receipt from one of these platforms: Zepto, Swiggy, Zomato, Blinkit.

Reply ONLY with valid JSON (no markdown): {"is_bill": true or false, "platform": "zepto" or "swiggy" or "zomato" or "blinkit" or null}

- is_bill: true only if this is clearly an order invoice/tax receipt from one of the four platforms.
- platform: detected platform in lowercase, or null if unrecognised.
- Salary slips, bank statements, or any non-food-delivery document → is_bill: false.
"""


def classify_pdf(ocr_text: str) -> ClassifyResult:
    """
    Tiny OpenAI call to verify the PDF is a food delivery bill.
    Only the first 500 chars are sent — enough to identify the invoice header.
    max_tokens=30 keeps this extremely cheap (~$0.000015 per call).
    Falls back to skipped=True if OpenAI is unavailable (rate limit, network, etc).
    """
    snippet = ocr_text[:500]
    try:
        response = _get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _CLASSIFY_PROMPT},
                {"role": "user", "content": snippet},
            ],
            max_tokens=30,
            temperature=0,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content
        parsed = json.loads(raw)
        is_bill = bool(parsed.get("is_bill", False))
        platform = _to_str(parsed.get("platform"))
        logger.info(f"PDF classifier: is_bill={is_bill} platform={platform!r}")
        return ClassifyResult(is_bill=is_bill, platform=platform)
    except Exception as e:
        logger.warning(f"PDF classifier unavailable ({type(e).__name__}) — will proceed with regex only: {e}")
        return ClassifyResult(is_bill=True, platform=None, skipped=True)


def parse_bill_pdf(ocr_text: str) -> ParseResult:
    """
    PDF-specific parsing pipeline:
      1. classify_pdf() — tiny OpenAI call to verify this is a food delivery bill.
         Catches random PDFs (salary slips, bank statements, etc.) uploaded to game the system.
      2. If not a bill → reject immediately (no regex, no further processing).
      3. If yes (or classifier unavailable) → _parse_text_fallback() for structured extraction.
         Zepto/Swiggy/Zomato/Blinkit PDFs are machine-generated e-invoices with fixed layouts —
         regex is more reliable and free, no second OpenAI call needed.
    """
    classify = classify_pdf(ocr_text)

    if not classify.is_bill:
        logger.warning("PDF classifier: not a food delivery bill — rejecting")
        return ParseResult(
            passed=False,
            reason="not_a_bill",
            message="The uploaded PDF does not appear to be a food delivery invoice. "
                    "Only Zepto, Swiggy, Zomato, and Blinkit invoices are accepted.",
        )

    if classify.skipped:
        logger.warning("PDF classifier skipped — proceeding with regex extraction without bill verification")

    return _parse_text_fallback(ocr_text)


_MAX_RETRIES  = 3
_RETRY_DELAY  = 2.0   # seconds between attempts (longer for OpenAI rate limits)


def parse_bill(ocr_text: str) -> ParseResult:
    """
    Send OCR text to OpenAI gpt-4o-mini and parse into structured bill JSON.
    gpt-4o-mini: cheapest capable model — $0.15/1M input, $0.60/1M output tokens.
    A typical bill OCR text is ~500–800 tokens.
    Retries up to 3 times on transient errors (network, rate limit, 500s).
    """
    # Truncate very long OCR text — 8000 chars covers even large multi-item GST invoices
    truncated_text = ocr_text[:8000]

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            response = _get_client().chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"Extract bill data from this text:\n\n{truncated_text}"}
                ],
                max_tokens=2000,
                temperature=0,          # deterministic — no creativity needed
                response_format={"type": "json_object"},
            )

            raw = response.choices[0].message.content

            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                # Malformed JSON from GPT — retry, it's rare but transient
                if attempt < _MAX_RETRIES:
                    time.sleep(_RETRY_DELAY)
                    continue
                return ParseResult(
                    passed=False,
                    reason="parse_failed",
                    message="Could not parse bill data. Please upload a clearer bill image.",
                )

            # Normalize platform — keep the actual detected name, just flag if unsupported
            platform = (parsed.get("platform") or "unknown").lower().strip()
            parsed["platform"] = platform
            is_supported_platform = platform in ALLOWED_PLATFORMS

            # Build items list safely
            raw_items = parsed.get("items") or []
            items = []
            for item in raw_items:
                if isinstance(item, dict) and item.get("name"):
                    items.append(BillItem(
                        name=str(item["name"]),
                        hsn_code=_to_str(item.get("hsn_code")),
                        quantity=_to_float(item.get("quantity")),
                        unit_price=_to_float(item.get("unit_price")),
                        total_price=_to_float(item.get("total_price")),
                    ))

            data = ExtractedBillData(
                platform=parsed.get("platform"),
                is_supported_platform=is_supported_platform,
                order_id=_to_str(parsed.get("order_id")),
                order_date=_to_str(parsed.get("order_date")),
                merchant_name=_to_str(parsed.get("merchant_name")),
                seller_gstin=_to_str(parsed.get("seller_gstin")),
                fssai_license=_to_str(parsed.get("fssai_license")),
                fbo_email=_to_str(parsed.get("fbo_email")),
                customer_name=_to_str(parsed.get("customer_name")),
                total_amount=_to_float(parsed.get("total_amount")),
                subtotal=_to_float(parsed.get("subtotal")),
                delivery_fee=_to_float(parsed.get("delivery_fee")),
                handling_fee=_to_float(parsed.get("handling_fee")),
                extra_charges=_to_float(parsed.get("extra_charges")),
                coupon_code=_to_str(parsed.get("coupon_code")),
                discount=_to_float(parsed.get("discount")),
                taxes=_to_float(parsed.get("taxes")),
                items=items,
                currency=parsed.get("currency", "INR"),
                delivery_city=_to_str(parsed.get("delivery_city")),
                delivery_state=_to_str(parsed.get("delivery_state")),
                delivery_pincode=_to_str(parsed.get("delivery_pincode")),
                place_of_supply=_to_str(parsed.get("place_of_supply")),
                raw_text_snippet=ocr_text[:200],
            )

            return ParseResult(passed=True, data=data)

        except RateLimitError:
            # OpenAI quota hit — wait longer before retrying
            if attempt < _MAX_RETRIES:
                time.sleep(_RETRY_DELAY * attempt)   # 2s, 4s
                continue
            logger.warning("OpenAI rate limit exhausted — falling back to regex parser")
            return _parse_text_fallback(ocr_text)

        except Exception:
            if attempt < _MAX_RETRIES:
                time.sleep(_RETRY_DELAY)
                continue
            logger.warning("OpenAI unavailable after all retries — falling back to regex parser")
            return _parse_text_fallback(ocr_text)


def _to_float(val) -> float | None:
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def _to_str(val) -> str | None:
    if val is None or str(val).strip() in ("", "null", "None"):
        return None
    return str(val).strip()


def _parse_text_fallback(ocr_text: str) -> ParseResult:
    """
    Regex-based extraction from real OCR/PDF text.
    Used when OpenAI is unavailable. Parses actual content — not hardcoded.
    """
    import re

    text = ocr_text

    # ── Platform ──────────────────────────────────────────────────────────────
    platform = "unknown"
    for p in ALLOWED_PLATFORMS:
        if re.search(p, text, re.IGNORECASE):
            platform = p
            break

    # ── Order ID ──────────────────────────────────────────────────────────────
    order_id = None
    for pat in [
        r'Order\s*No\.?\s*[:\-]?\s*([A-Z0-9]+)',
        r'Order\s*ID\s*[:\-]?\s*([A-Z0-9]+)',
        r'Order\s*#\s*([A-Z0-9]+)',
    ]:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            order_id = m.group(1).strip()
            break

    # ── Date ──────────────────────────────────────────────────────────────────
    order_date = None
    m = re.search(r'\b(\d{2})[-/](\d{2})[-/](\d{4})\b', text)
    if m:
        order_date = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    else:
        m = re.search(r'\b(\d{4})[-/](\d{2})[-/](\d{2})\b', text)
        if m:
            order_date = m.group(0)

    # ── Merchant name ─────────────────────────────────────────────────────────
    # pypdf can concatenate lines without \n, so stop at company-type suffix
    # OR at address/GSTIN keywords — whichever comes first.
    merchant_name = None
    for pat in [
        r'Seller\s*Name\s*[:\-]?\s*(.+?(?:Pvt\.?\s*Ltd\.?|Private\s+Limited|LLP|LLC|Limited|Co\.))',
        r'Seller\s*Name\s*[:\-]?\s*(.+?)(?:\n|GSTIN|FSSAI|No\s+\d)',
        r'Restaurant\s*[:\-]?\s*(.+?)(?:\n|$)',
        r'From\s*[:\-]?\s*(.+?)(?:\n|$)',
    ]:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            merchant_name = m.group(1).strip()
            break

    # ── Total amount ──────────────────────────────────────────────────────────
    total_amount = None
    for pat in [
        r'Invoice\s*Value\s*[\r\n\s]+([\d,]+\.?\d*)',
        r'Grand\s*Total\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)',
        r'Total\s*(?:Amt\.?|Amount)\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)',
    ]:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            try:
                total_amount = float(m.group(1).replace(',', ''))
                break
            except ValueError:
                pass

    # ── Subtotal ──────────────────────────────────────────────────────────────
    subtotal = None
    m = re.search(r'(?:Item\s*Total|Subtotal|Sub\s*Total)\s*[\r\n\s]+([\d,]+\.?\d*)', text, re.IGNORECASE)
    if m:
        try:
            subtotal = float(m.group(1).replace(',', ''))
        except ValueError:
            pass

    # ── Delivery fee ──────────────────────────────────────────────────────────
    delivery_fee = None
    m = re.search(r'Delivery\s*(?:Fee|Charge)\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)', text, re.IGNORECASE)
    if m:
        try:
            delivery_fee = float(m.group(1).replace(',', ''))
        except ValueError:
            pass

    # ── Handling fee (Zepto: handling + late night + surge combined) ──────────
    handling_fee = None
    handling_total = 0.0
    for pat in [
        r'Handling\s*(?:Fee|Charge)\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)',
        r'Late\s*Night\s*(?:Fee|Charge)\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)',
        r'Surge\s*(?:Fee|Charge)\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)',
        r'Rain\s*(?:Fee|Charge)\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)',
    ]:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            try:
                handling_total += float(m.group(1).replace(',', ''))
            except ValueError:
                pass
    if handling_total > 0:
        handling_fee = handling_total

    # ── Extra charges (catch-all for unknown fee types) ───────────────────────
    extra_charges = None
    extra_total = 0.0
    for pat in [
        r'(?:Packaging|Convenience|Platform|Service)\s*(?:Fee|Charge)\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)',
    ]:
        for m in re.finditer(pat, text, re.IGNORECASE):
            try:
                extra_total += float(m.group(1).replace(',', ''))
            except ValueError:
                pass
    if extra_total > 0:
        extra_charges = extra_total

    # ── Discount (coupon + membership combined) ───────────────────────────────
    discount = None
    discount_total = 0.0
    for pat in [
        r'(?:Coupon|Promo|Code)\s*(?:Discount|Savings?)\s*[:\-]?\s*(?:-\s*)?(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)',
        r'(?:Zepto\s*Pass|Membership)\s*(?:Discount|Savings?)\s*[:\-]?\s*(?:-\s*)?(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)',
        r'Total\s*Savings?\s*[:\-]?\s*(?:-\s*)?(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)',
        r'Discount\s*[:\-]?\s*(?:-\s*)?(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)',
    ]:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            try:
                discount_total += float(m.group(1).replace(',', ''))
                break   # use first match to avoid double-counting
            except ValueError:
                pass
    if discount_total > 0:
        discount = discount_total

    # ── Coupon code ───────────────────────────────────────────────────────────
    coupon_code = None
    m = re.search(r'(?:Coupon|Promo)\s*(?:Code|Applied)?\s*[:\-]?\s*([A-Z0-9]{4,20})', text, re.IGNORECASE)
    if m:
        coupon_code = m.group(1).strip().upper()

    # ── Taxes ─────────────────────────────────────────────────────────────────
    taxes = None
    m = re.search(r'(?:Taxes|GST\s*Total)\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)', text, re.IGNORECASE)
    if m:
        try:
            taxes = float(m.group(1).replace(',', ''))
        except ValueError:
            pass

    # ── Seller GSTIN ──────────────────────────────────────────────────────────
    # Only validates format (proves seller is GST-registered). Any valid GSTIN found
    # in the text is sufficient — no platform registry check.
    seller_gstin = None
    all_gstins = re.findall(r'\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b', text)
    if all_gstins:
        seller_gstin = all_gstins[0]

    # ── FSSAI license ─────────────────────────────────────────────────────────
    # All licensed food businesses in India display a 14-digit FSSAI number.
    fssai_license = None
    m = re.search(r'FSSAI\s*(?:Lic(?:ense|ence)?\.?\s*(?:No\.?|Number)?|No\.?|Number)?\s*[:\-]?\s*(\d{14})', text, re.IGNORECASE)
    if m:
        fssai_license = m.group(1).strip()

    # ── FBO support email ─────────────────────────────────────────────────────
    # Platform support email is a stable identifier (e.g. support@zeptonow.com).
    fbo_email = None
    m = re.search(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', text)
    if m:
        fbo_email = m.group(0).strip().lower()

    # ── Customer name (Bill To / Ship To) ─────────────────────────────────────
    customer_name = None
    for pat in [
        r'Bill\s*To\s*[:\-]?\s*\n?\s*(.+?)(?:\n|GSTIN|Address|$)',
        r'Ship\s*To\s*[:\-]?\s*\n?\s*(.+?)(?:\n|GSTIN|Address|$)',
        r'Billing\s*(?:Name|Address)\s*[:\-]?\s*(.+?)(?:\n|$)',
    ]:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            customer_name = m.group(1).strip()
            break

    # ── Delivery address fields ───────────────────────────────────────────────
    delivery_city     = None
    delivery_state    = None
    delivery_pincode  = None
    place_of_supply   = None

    m = re.search(r'(?:Place\s*of\s*Supply|POS)\s*[:\-]?\s*(.+?)(?:\n|$)', text, re.IGNORECASE)
    if m:
        place_of_supply = m.group(1).strip()

    # 6-digit Indian pincode
    m = re.search(r'\b(\d{6})\b', text)
    if m:
        delivery_pincode = m.group(1)

    # ── Items ─────────────────────────────────────────────────────────────────
    items: list[BillItem] = []

    # Strategy 1: GST tabular format — anchor on 8-digit HSN code.
    # Row pattern: <MRP>  <HSN8>  <Qty>  <UnitRate>  <Disc%>  <TaxableAmt> ...
    # Item name is the text between the SR number and the MRP on the same line.
    header_words = {'description', 'item', 'hsn', 'qty', 'rate', 'disc',
                    'taxable', 'cgst', 'sgst', 'cess', 'unit', 'mrp', 'rsp',
                    'sr', 'no', 'amt', 'supply'}
    for m in re.finditer(
        r'([\d.]+)\s+'       # MRP / RSP
        r'(\d{7,8})\s+'      # HSN code (7-8 digits)
        r'(\d+)\s+'          # Qty
        r'([\d.]+)\s+'       # Unit rate (Product Rate)
        r'[\d.]+%\s+'        # Discount %
        r'([\d.]+)',          # Taxable amount
        text,
    ):
        mrp_pos   = m.start()
        qty       = float(m.group(3))
        unit_price = float(m.group(4))
        taxable   = float(m.group(5))

        # The item name sits in the text before the MRP on this row.
        # Walk back to the nearest SR number (\n<digits>\n or start of item block).
        prefix = text[:mrp_pos]
        name_m = re.search(r'(?:^|\n)\s*(\d+)\s*\n(.+?)$', prefix, re.DOTALL)
        if name_m:
            raw_name = name_m.group(2)
        else:
            # Fallback: take up to 80 chars before MRP
            raw_name = prefix[-80:]

        # Flatten multiline name, strip table header noise
        name = re.sub(r'\s+', ' ', raw_name).strip()
        name_lower = name.lower()
        if any(w == tok for tok in name_lower.split() for w in header_words):
            name = ' '.join(
                tok for tok in name.split()
                if tok.lower() not in header_words
            ).strip()

        if not name or len(name) < 2:
            continue

        items.append(BillItem(
            name=name,
            quantity=qty,
            unit_price=unit_price,
            total_price=taxable,
        ))

    # Strategy 2: "- Item ×qty: ₹price" narrative style (Swiggy/Zomato receipts)
    if not items:
        for m in re.finditer(
            r'[-•]\s*(.+?)\s*[x×]\s*(\d+)\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)',
            text, re.IGNORECASE,
        ):
            try:
                items.append(BillItem(
                    name=m.group(1).strip(),
                    quantity=float(m.group(2)),
                    unit_price=None,
                    total_price=float(m.group(3).replace(',', '')),
                ))
            except ValueError:
                pass

    data = ExtractedBillData(
        platform=platform,
        is_supported_platform=platform in ALLOWED_PLATFORMS,
        order_id=order_id,
        order_date=order_date,
        merchant_name=merchant_name,
        seller_gstin=seller_gstin,
        fssai_license=fssai_license,
        fbo_email=fbo_email,
        customer_name=customer_name,
        total_amount=total_amount,
        subtotal=subtotal,
        delivery_fee=delivery_fee,
        handling_fee=handling_fee,
        extra_charges=extra_charges,
        coupon_code=coupon_code,
        discount=discount,
        taxes=taxes,
        items=items,
        currency="INR",
        delivery_city=delivery_city,
        delivery_state=delivery_state,
        delivery_pincode=delivery_pincode,
        place_of_supply=place_of_supply,
        raw_text_snippet=ocr_text[:200],
    )
    return ParseResult(passed=True, data=data)
