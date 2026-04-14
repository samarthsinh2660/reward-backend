import re
import logging
from config import TAMPERING_CONFIDENCE_THRESHOLD, FBO_EMAIL_DOMAINS
from models.schemas import FraudSignals, ExtractedBillData
from services.tampering import TamperingResult

logger = logging.getLogger(__name__)

# ── Identifier regexes ────────────────────────────────────────────────────────
_GSTIN_RE = re.compile(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')

# ── Scoring weights ───────────────────────────────────────────────────────────
TAMPERING_POINTS          = 35   # added when confidence > TAMPERING_CONFIDENCE_THRESHOLD

RULE_UNKNOWN_PLATFORM     = 20   # platform completely unidentifiable (None or "unknown")
RULE_NO_ORDER_ID          = 10   # order_id missing
RULE_NO_MERCHANT          = 10   # merchant_name missing
RULE_ZERO_TOTAL           = 20   # total_amount is null, zero, or negative
RULE_NO_ITEMS             = 15   # items list is empty
RULE_TOTAL_MISMATCH       = 25   # |subtotal + taxes + delivery − discount − total| > ₹10
RULE_INVALID_GSTIN        = 20   # seller_gstin missing or fails GSTIN format check
RULE_NO_FSSAI             = 15   # FSSAI license number missing (expected on food delivery invoices)
RULE_WRONG_FBO_EMAIL      = 30   # email domain on invoice belongs to a different known platform (spoofing)


def compute_fraud_signals(
    extracted: ExtractedBillData,
    tampering: TamperingResult,
) -> FraudSignals:
    """
    Aggregate all fraud signals into a point-based score.

    The Node.js backend owns the threshold policy and decides whether to
    auto-approve, flag for review, or reject based on fraud_score.

    Risk tiers (guideline — enforced by Node.js, not here):
      0–20   low risk    → auto-approve
      21–50  medium risk → flag for manual review
      51+    high risk   → reject
    """
    violations: list[str] = []
    rule_points = 0

    if extracted.platform in (None, "unknown"):
        # Truly unidentifiable — not even a recognisable brand name
        violations.append("unknown_platform")
        rule_points += RULE_UNKNOWN_PLATFORM

    if not extracted.order_id:
        violations.append("missing_order_id")
        rule_points += RULE_NO_ORDER_ID

    if not extracted.merchant_name:
        violations.append("missing_merchant_name")
        rule_points += RULE_NO_MERCHANT

    total = extracted.total_amount
    if total is None or total <= 0:
        violations.append("zero_or_missing_total")
        rule_points += RULE_ZERO_TOTAL

    # Blinkit charges-only invoice (handling/surge/delivery fees, no goods) is a valid
    # PDF that users may upload — don't penalise it for having no line items.
    _blinkit_charges_only = (
        extracted.platform == 'blinkit'
        and not extracted.items
        and bool(extracted.handling_fee or extracted.delivery_fee)
    )
    if not extracted.items and not _blinkit_charges_only:
        violations.append("no_line_items")
        rule_points += RULE_NO_ITEMS

    # Total consistency: subtotal + taxes + delivery + handling + extra − discount ≈ total
    if total and total > 0 and extracted.subtotal is not None:
        computed = (
            (extracted.subtotal      or 0.0)
            + (extracted.taxes         or 0.0)
            + (extracted.delivery_fee  or 0.0)
            + (extracted.handling_fee  or 0.0)
            + (extracted.extra_charges or 0.0)
            - (extracted.discount      or 0.0)
        )
        if abs(computed - total) > 10.0:
            violations.append(
                f"total_mismatch:expected={total:.2f},computed={computed:.2f}"
            )
            rule_points += RULE_TOTAL_MISMATCH

    # ── GSTIN format check ────────────────────────────────────────────────────
    # Validates the seller is a GST-registered business. No registry check —
    # Zepto/Swiggy invoices have marketplace seller GSTINs, not the platform's.
    gstin = (extracted.seller_gstin or "").strip().upper()
    if not gstin or not _GSTIN_RE.match(gstin):
        violations.append("invalid_or_missing_gstin")
        rule_points += RULE_INVALID_GSTIN

    # ── FSSAI license presence ────────────────────────────────────────────────
    # All licensed food businesses in India must display their FSSAI number.
    # 14-digit format: first 2 digits = state code, rest = license number.
    fssai = (extracted.fssai_license or "").strip()
    if not fssai or not re.match(r'^\d{14}$', fssai):
        violations.append("missing_or_invalid_fssai")
        rule_points += RULE_NO_FSSAI

    # ── FBO email domain cross-check ──────────────────────────────────────────
    # If the invoice contains an email from a DIFFERENT known platform's domain,
    # that is a strong spoofing signal (e.g. Swiggy email on a Zomato invoice).
    fbo_email = (extracted.fbo_email or "").strip().lower()
    if fbo_email:
        platform_key = (extracted.platform or "").lower()
        expected_domain = FBO_EMAIL_DOMAINS.get(platform_key, "")
        if expected_domain and expected_domain not in fbo_email:
            # Check if it matches any OTHER platform's domain (spoofing)
            other_domains = {d for p, d in FBO_EMAIL_DOMAINS.items() if p != platform_key}
            if any(d in fbo_email for d in other_domains):
                violations.append(f"fbo_email_platform_mismatch:{fbo_email}")
                rule_points += RULE_WRONG_FBO_EMAIL
                logger.warning(f"Email {fbo_email!r} belongs to a different platform than {platform_key!r}")

    tampering_points = (
        TAMPERING_POINTS
        if tampering.confidence > TAMPERING_CONFIDENCE_THRESHOLD
        else 0
    )

    score = rule_points + tampering_points
    logger.info(f"Fraud score={score} violations={violations} tampering_confidence={tampering.confidence}")
    return FraudSignals(
        tampering_confidence=tampering.confidence,
        tampering_points=tampering_points,
        rule_violations=violations,
        rule_violation_points=rule_points,
        fraud_score=score,
    )
