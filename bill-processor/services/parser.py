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


SYSTEM_PROMPT = """You are a bill data extraction assistant for an Indian food delivery cashback app.
Extract structured data from food delivery bill text (Swiggy, Zomato, Zepto, Blinkit).

Return ONLY valid JSON matching this exact schema — no markdown, no explanation:
{
  "platform": "the delivery platform name in lowercase (e.g. swiggy, zomato, zepto, blinkit, amazon, flipkart, dunzo, etc.) or \"unknown\" if completely unidentifiable",
  "order_id": "string or null",
  "order_date": "YYYY-MM-DD or null",
  "merchant_name": "string or null",
  "seller_gstin": "string or null",
  "total_amount": number or null,
  "subtotal": number or null,
  "delivery_fee": number or null,
  "discount": number or null,
  "taxes": number or null,
  "items": [
    { "name": "string", "hsn_code": "string or null", "quantity": number or null, "unit_price": number or null, "total_price": number or null }
  ],
  "currency": "INR",
  "delivery_city": "string or null",
  "delivery_state": "string or null",
  "delivery_pincode": "string or null",
  "place_of_supply": "string or null"
}

Rules:
- All amounts must be numbers (not strings). Use null if not found.
- order_date must be ISO format YYYY-MM-DD. Use null if not found or ambiguous.
- platform must be lowercase. Return the actual platform name as detected. Use "unknown" only if truly unidentifiable.
- items must be an array — empty array [] if no line items found.
- hsn_code is the HSN/SAC code for the item (numeric string). Use null if not found.
- seller_gstin is the seller's GST Identification Number (e.g. 24AAJCD2242F1Z2). Use null if not found.
- delivery_city, delivery_state, delivery_pincode extract from the "Ship To" or "Bill To" delivery address.
- place_of_supply is the place of supply field (e.g. "GUJARAT"). Extract only the state name, not the code.
- Never hallucinate data. If a field is not in the text, use null.
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


_MAX_RETRIES  = 3
_RETRY_DELAY  = 2.0   # seconds between attempts (longer for OpenAI rate limits)


def parse_bill(ocr_text: str) -> ParseResult:
    """
    Send OCR text to OpenAI gpt-4o-mini and parse into structured bill JSON.
    gpt-4o-mini: cheapest capable model — $0.15/1M input, $0.60/1M output tokens.
    A typical bill OCR text is ~500–800 tokens.
    Retries up to 3 times on transient errors (network, rate limit, 500s).
    """
    # Truncate very long OCR text to keep cost low — bills are rarely > 1500 chars
    truncated_text = ocr_text[:3000]

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            response = _get_client().chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"Extract bill data from this text:\n\n{truncated_text}"}
                ],
                max_tokens=600,
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
                total_amount=_to_float(parsed.get("total_amount")),
                subtotal=_to_float(parsed.get("subtotal")),
                delivery_fee=_to_float(parsed.get("delivery_fee")),
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
            return ParseResult(
                passed=False,
                reason="parse_failed",
                message="Bill parsing service is busy. Please try again shortly.",
            )

        except Exception:
            if attempt < _MAX_RETRIES:
                time.sleep(_RETRY_DELAY)
                continue
            return ParseResult(
                passed=False,
                reason="parse_failed",
                message="Bill parsing service unavailable. Please try again.",
            )


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

    # ── Taxes ─────────────────────────────────────────────────────────────────
    taxes = None
    m = re.search(r'(?:Taxes|GST\s*Total)\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)', text, re.IGNORECASE)
    if m:
        try:
            taxes = float(m.group(1).replace(',', ''))
        except ValueError:
            pass

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
        order_id=order_id,
        order_date=order_date,
        merchant_name=merchant_name,
        total_amount=total_amount,
        subtotal=subtotal,
        delivery_fee=delivery_fee,
        discount=None,
        taxes=taxes,
        items=items,
        currency="INR",
        raw_text_snippet=ocr_text[:200],
    )
    return ParseResult(passed=True, data=data)
