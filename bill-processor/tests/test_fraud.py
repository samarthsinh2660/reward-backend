"""
Unit tests for services/fraud.py — pure logic, no external calls.
"""
import pytest

from models.schemas import ExtractedBillData, BillItem, FraudSignals
from services.fraud import (
    compute_fraud_signals,
    RULE_UNKNOWN_PLATFORM,
    RULE_NO_ORDER_ID,
    RULE_NO_MERCHANT,
    RULE_ZERO_TOTAL,
    RULE_NO_ITEMS,
    RULE_TOTAL_MISMATCH,
    TAMPERING_POINTS,
)
from services.tampering import TamperingResult
from config import TAMPERING_CONFIDENCE_THRESHOLD


def _clean_bill() -> ExtractedBillData:
    """Minimal valid bill — passes all rule checks."""
    return ExtractedBillData(
        platform="swiggy",
        order_id="ORD123",
        merchant_name="Pizza Hut",
        total_amount=350.0,
        subtotal=300.0,
        delivery_fee=30.0,
        taxes=20.0,
        discount=0.0,
        items=[BillItem(name="Margherita Pizza", quantity=1, unit_price=300.0, total_price=300.0)],
    )


def _clean_tampering() -> TamperingResult:
    return TamperingResult(confidence=0.0, points=[])


# ── Clean bill ────────────────────────────────────────────────────────────────

def test_clean_bill_zero_fraud_score():
    result = compute_fraud_signals(_clean_bill(), _clean_tampering())
    assert result.fraud_score == 0
    assert result.rule_violations == []
    assert result.tampering_points == 0


# ── Individual rule violations ────────────────────────────────────────────────

def test_unknown_platform_adds_points():
    bill = _clean_bill().model_copy(update={"platform": "unknown"})
    result = compute_fraud_signals(bill, _clean_tampering())
    assert "unknown_platform" in result.rule_violations
    assert result.rule_violation_points >= RULE_UNKNOWN_PLATFORM


def test_none_platform_adds_points():
    bill = _clean_bill().model_copy(update={"platform": None})
    result = compute_fraud_signals(bill, _clean_tampering())
    assert "unknown_platform" in result.rule_violations


def test_missing_order_id_adds_points():
    bill = _clean_bill().model_copy(update={"order_id": None})
    result = compute_fraud_signals(bill, _clean_tampering())
    assert "missing_order_id" in result.rule_violations
    assert result.rule_violation_points >= RULE_NO_ORDER_ID


def test_missing_merchant_adds_points():
    bill = _clean_bill().model_copy(update={"merchant_name": None})
    result = compute_fraud_signals(bill, _clean_tampering())
    assert "missing_merchant_name" in result.rule_violations
    assert result.rule_violation_points >= RULE_NO_MERCHANT


def test_zero_total_adds_points():
    bill = _clean_bill().model_copy(update={"total_amount": 0.0})
    result = compute_fraud_signals(bill, _clean_tampering())
    assert "zero_or_missing_total" in result.rule_violations
    assert result.rule_violation_points >= RULE_ZERO_TOTAL


def test_negative_total_adds_points():
    bill = _clean_bill().model_copy(update={"total_amount": -10.0})
    result = compute_fraud_signals(bill, _clean_tampering())
    assert "zero_or_missing_total" in result.rule_violations


def test_null_total_adds_points():
    bill = _clean_bill().model_copy(update={"total_amount": None})
    result = compute_fraud_signals(bill, _clean_tampering())
    assert "zero_or_missing_total" in result.rule_violations


def test_empty_items_adds_points():
    bill = _clean_bill().model_copy(update={"items": []})
    result = compute_fraud_signals(bill, _clean_tampering())
    assert "no_line_items" in result.rule_violations
    assert result.rule_violation_points >= RULE_NO_ITEMS


def test_total_mismatch_adds_points():
    # subtotal(300) + taxes(20) + delivery(30) - discount(0) = 350, but total_amount = 500
    bill = _clean_bill().model_copy(update={"total_amount": 500.0})
    result = compute_fraud_signals(bill, _clean_tampering())
    assert any("total_mismatch" in v for v in result.rule_violations)
    assert result.rule_violation_points >= RULE_TOTAL_MISMATCH


def test_total_within_tolerance_no_mismatch():
    # Difference of exactly ₹5 — within the ₹10 tolerance
    bill = _clean_bill().model_copy(update={"total_amount": 355.0})
    result = compute_fraud_signals(bill, _clean_tampering())
    assert not any("total_mismatch" in v for v in result.rule_violations)


# ── Tampering signal ──────────────────────────────────────────────────────────

def test_tampering_above_threshold_adds_points():
    tampering = TamperingResult(
        confidence=TAMPERING_CONFIDENCE_THRESHOLD + 0.01,
        points=["no_exif_metadata"],
    )
    result = compute_fraud_signals(_clean_bill(), tampering)
    assert result.tampering_points == TAMPERING_POINTS
    assert result.fraud_score == TAMPERING_POINTS


def test_tampering_at_threshold_no_points():
    # Exactly at threshold — must be strictly greater
    tampering = TamperingResult(confidence=TAMPERING_CONFIDENCE_THRESHOLD, points=[])
    result = compute_fraud_signals(_clean_bill(), tampering)
    assert result.tampering_points == 0


def test_tampering_below_threshold_no_points():
    tampering = TamperingResult(confidence=0.50, points=["no_exif_metadata"])
    result = compute_fraud_signals(_clean_bill(), tampering)
    assert result.tampering_points == 0


# ── Score accumulation ────────────────────────────────────────────────────────

def test_multiple_violations_accumulate():
    bill = ExtractedBillData(
        platform="unknown",
        order_id=None,
        merchant_name=None,
        total_amount=None,
        items=[],
    )
    result = compute_fraud_signals(bill, _clean_tampering())
    expected = (
        RULE_UNKNOWN_PLATFORM
        + RULE_NO_ORDER_ID
        + RULE_NO_MERCHANT
        + RULE_ZERO_TOTAL
        + RULE_NO_ITEMS
    )
    assert result.fraud_score == expected
    assert len(result.rule_violations) == 5


def test_fraud_score_equals_rule_points_plus_tampering():
    tampering = TamperingResult(confidence=0.9, points=["no_exif_metadata"])
    bill = _clean_bill().model_copy(update={"order_id": None})
    result = compute_fraud_signals(bill, tampering)
    assert result.fraud_score == result.rule_violation_points + result.tampering_points


# ── Supported platforms pass ──────────────────────────────────────────────────

@pytest.mark.parametrize("platform", ["swiggy", "zomato", "zepto", "blinkit"])
def test_known_platforms_no_violation(platform: str):
    bill = _clean_bill().model_copy(update={"platform": platform})
    result = compute_fraud_signals(bill, _clean_tampering())
    assert "unknown_platform" not in result.rule_violations


def test_tampering_confidence_stored_correctly():
    tampering = TamperingResult(confidence=0.85, points=[])
    result = compute_fraud_signals(_clean_bill(), tampering)
    assert result.tampering_confidence == 0.85
