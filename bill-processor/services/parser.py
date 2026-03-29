import json
from openai import OpenAI

from config import OPENAI_API_KEY, ALLOWED_PLATFORMS
from models.schemas import ExtractedBillData, BillItem


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

    except json.JSONDecodeError:
        return ParseResult(
            passed=False,
            reason="parse_failed",
            message="Could not parse bill data. Please upload a clearer bill image.",
        )
    except Exception:
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
