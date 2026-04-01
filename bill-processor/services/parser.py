import json
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
  "platform": "swiggy" | "zomato" | "zepto" | "blinkit" | "unknown",
  "order_id": "string or null",
  "order_date": "YYYY-MM-DD or null",
  "merchant_name": "string or null",
  "total_amount": number or null,
  "subtotal": number or null,
  "delivery_fee": number or null,
  "discount": number or null,
  "taxes": number or null,
  "items": [
    { "name": "string", "quantity": number or null, "unit_price": number or null, "total_price": number or null }
  ],
  "currency": "INR"
}

Rules:
- All amounts must be numbers (not strings). Use null if not found.
- order_date must be ISO format YYYY-MM-DD. Use null if not found or ambiguous.
- platform must be lowercase. Use "unknown" if not identifiable.
- items must be an array — empty array [] if no line items found.
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


def parse_bill(ocr_text: str) -> ParseResult:
    """
    Send OCR text to OpenAI gpt-4o-mini and parse into structured bill JSON.
    gpt-4o-mini: cheapest capable model — $0.15/1M input, $0.60/1M output tokens.
    A typical bill OCR text is ~500–800 tokens.

    DEMO MODE: if OpenAI call fails (no key, quota, network), fall back to
    a hardcoded result so the end-to-end demo flow always completes.
    """
    # Truncate very long OCR text to keep cost low — bills are rarely > 1500 chars
    truncated_text = ocr_text[:3000]

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
        parsed = json.loads(raw)

        # Normalize platform to known set
        platform = (parsed.get("platform") or "unknown").lower().strip()
        if platform not in ALLOWED_PLATFORMS:
            platform = "unknown"
        parsed["platform"] = platform

        # Build items list safely
        raw_items = parsed.get("items") or []
        items = []
        for item in raw_items:
            if isinstance(item, dict) and item.get("name"):
                items.append(BillItem(
                    name=str(item["name"]),
                    quantity=_to_float(item.get("quantity")),
                    unit_price=_to_float(item.get("unit_price")),
                    total_price=_to_float(item.get("total_price")),
                ))

        data = ExtractedBillData(
            platform=parsed.get("platform"),
            order_id=_to_str(parsed.get("order_id")),
            order_date=_to_str(parsed.get("order_date")),
            merchant_name=_to_str(parsed.get("merchant_name")),
            total_amount=_to_float(parsed.get("total_amount")),
            subtotal=_to_float(parsed.get("subtotal")),
            delivery_fee=_to_float(parsed.get("delivery_fee")),
            discount=_to_float(parsed.get("discount")),
            taxes=_to_float(parsed.get("taxes")),
            items=items,
            currency=parsed.get("currency", "INR"),
            raw_text_snippet=ocr_text[:200],
        )

        return ParseResult(passed=True, data=data)

    except json.JSONDecodeError as e:
        logger.error(f"OpenAI returned invalid JSON: {e}")
        return _parse_text_fallback(ocr_text)
    except Exception as e:
        logger.error(f"OpenAI call failed ({type(e).__name__}): {e}")
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
