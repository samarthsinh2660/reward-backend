import logging
from config import TAMPERING_CONFIDENCE_THRESHOLD
from models.schemas import FraudSignals, ExtractedBillData
from services.tampering import TamperingResult

logger = logging.getLogger(__name__)


# ── Scoring weights ───────────────────────────────────────────────────────────
TAMPERING_POINTS        = 35   # added when confidence > TAMPERING_CONFIDENCE_THRESHOLD

RULE_UNKNOWN_PLATFORM   = 20   # platform not in ALLOWED_PLATFORMS
RULE_NO_ORDER_ID        = 10   # order_id missing
RULE_NO_MERCHANT        = 10   # merchant_name missing
RULE_ZERO_TOTAL         = 20   # total_amount is null, zero, or negative
RULE_NO_ITEMS           = 15   # items list is empty
RULE_TOTAL_MISMATCH     = 25   # |subtotal + taxes + delivery − discount − total| > ₹10


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

    if not extracted.items:
        violations.append("no_line_items")
        rule_points += RULE_NO_ITEMS

    # Total consistency: subtotal + taxes + delivery − discount ≈ total
    if total and total > 0 and extracted.subtotal is not None:
        computed = (
            (extracted.subtotal    or 0.0)
            + (extracted.taxes       or 0.0)
            + (extracted.delivery_fee or 0.0)
            - (extracted.discount    or 0.0)
        )
        if abs(computed - total) > 10.0:
            violations.append(
                f"total_mismatch:expected={total:.2f},computed={computed:.2f}"
            )
            rule_points += RULE_TOTAL_MISMATCH

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
