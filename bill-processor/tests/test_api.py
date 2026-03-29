"""
API-level integration tests using FastAPI TestClient.

All external service calls (Google Vision, OpenAI) are mocked so tests are
fast, offline, and deterministic. Each test validates the full HTTP
request/response contract.
"""
import io
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image
import numpy as np

from models.schemas import ExtractedBillData, BillItem, FraudSignals
from services.quality import QualityResult
from services.ocr import OCRResult
from services.parser import ParseResult
from services.tampering import TamperingResult


# ── App import (env vars already set by conftest.setup_env) ───────────────────
from main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_jpeg_bytes(width=800, height=800) -> bytes:
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    arr[::2, ::2] = 255
    buf = io.BytesIO()
    Image.fromarray(arr, "RGB").save(buf, format="JPEG")
    return buf.getvalue()


def _good_bill() -> ExtractedBillData:
    return ExtractedBillData(
        platform="swiggy",
        order_id="ORD-001",
        merchant_name="Domino's",
        total_amount=350.0,
        subtotal=300.0,
        delivery_fee=30.0,
        taxes=20.0,
        discount=0.0,
        items=[BillItem(name="Cheese Burst", quantity=1, unit_price=300.0, total_price=300.0)],
    )


def _passing_quality()  -> QualityResult:
    return QualityResult(True, "", {"sharpness": 200.0, "brightness": 128.0, "resolution": "800x800"})

def _passing_ocr()      -> OCRResult:
    return OCRResult(True, "Swiggy Order #ORD-001 Domino's ₹350")

def _passing_parse()    -> ParseResult:
    return ParseResult(passed=True, data=_good_bill())

def _clean_tampering()  -> TamperingResult:
    return TamperingResult(confidence=0.0, points=[])

def _zero_fraud()       -> FraudSignals:
    return FraudSignals(
        tampering_confidence=0.0,
        tampering_points=0,
        rule_violations=[],
        rule_violation_points=0,
        fraud_score=0,
    )


def _mock_all_services(quality=None, ocr=None, parse=None, tampering=None, fraud=None):
    """Context manager that mocks all services in main.py with passing defaults."""
    return patch.multiple(
        "main",
        check_quality=MagicMock(return_value=quality or _passing_quality()),
        run_ocr=MagicMock(return_value=ocr or _passing_ocr()),
        parse_bill=MagicMock(return_value=parse or _passing_parse()),
        check_tampering=MagicMock(return_value=tampering or _clean_tampering()),
        compute_fraud_signals=MagicMock(return_value=fraud or _zero_fraud()),
    )


# ── Health endpoint ───────────────────────────────────────────────────────────

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# ── File validation ───────────────────────────────────────────────────────────

def test_missing_file_returns_422(client):
    r = client.post("/process")
    assert r.status_code == 422
    body = r.json()
    assert body["status"] == "failed"
    assert body["reason"] == "invalid_request"


def test_unsupported_content_type_returns_400(client):
    r = client.post(
        "/process",
        files={"file": ("bill.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert r.status_code == 400
    body = r.json()
    assert body["status"] == "failed"
    assert body["reason"] == "invalid_file"
    assert "application/pdf" in body["message"]


def test_empty_file_returns_400(client):
    r = client.post(
        "/process",
        files={"file": ("empty.jpg", b"", "image/jpeg")},
    )
    assert r.status_code == 400
    body = r.json()
    assert body["reason"] == "invalid_file"
    assert "empty" in body["message"].lower()


def test_oversized_file_returns_400(client):
    big = b"x" * (11 * 1024 * 1024)   # 11 MB > 10 MB limit
    r = client.post(
        "/process",
        files={"file": ("large.jpg", big, "image/jpeg")},
    )
    assert r.status_code == 400
    body = r.json()
    assert body["reason"] == "invalid_file"
    assert "large" in body["message"].lower()


# ── Pipeline failure propagation ──────────────────────────────────────────────

def test_quality_failure_returns_400(client):
    fail_quality = QualityResult(False, "quality_low", {"error": "Too blurry."})
    with _mock_all_services(quality=fail_quality):
        r = client.post(
            "/process",
            files={"file": ("bill.jpg", _make_jpeg_bytes(), "image/jpeg")},
        )
    assert r.status_code == 400
    body = r.json()
    assert body["reason"] == "quality_low"
    assert "blurry" in body["message"].lower()


def test_ocr_failure_returns_400(client):
    fail_ocr = OCRResult(False, "", "ocr_failed", "Could not read text.")
    with _mock_all_services(ocr=fail_ocr):
        r = client.post(
            "/process",
            files={"file": ("bill.jpg", _make_jpeg_bytes(), "image/jpeg")},
        )
    assert r.status_code == 400
    assert r.json()["reason"] == "ocr_failed"


def test_parse_failure_returns_400(client):
    fail_parse = ParseResult(passed=False, reason="parse_failed", message="Could not parse bill.")
    with _mock_all_services(parse=fail_parse):
        r = client.post(
            "/process",
            files={"file": ("bill.jpg", _make_jpeg_bytes(), "image/jpeg")},
        )
    assert r.status_code == 400
    assert r.json()["reason"] == "parse_failed"


# ── Successful pipeline ───────────────────────────────────────────────────────

def test_success_response_structure(client):
    with _mock_all_services():
        r = client.post(
            "/process",
            files={"file": ("bill.jpg", _make_jpeg_bytes(), "image/jpeg")},
        )

    assert r.status_code == 200
    body = r.json()

    assert body["status"] == "success"
    assert "extracted_data" in body
    assert "image_hash"     in body
    assert "phash"          in body
    assert "fraud_signals"  in body

    # image_hash and phash are real (not mocked) — verify they are hex strings
    assert len(body["image_hash"]) == 64              # SHA-256 hex
    assert len(body["phash"]) > 0

    extracted = body["extracted_data"]
    assert extracted["platform"] == "swiggy"
    assert extracted["order_id"] == "ORD-001"
    assert extracted["total_amount"] == 350.0
    assert extracted["currency"] == "INR"
    assert len(extracted["items"]) == 1

    fraud = body["fraud_signals"]
    assert fraud["fraud_score"] == 0
    assert fraud["tampering_confidence"] == 0.0
    assert fraud["rule_violations"] == []


def test_success_png_file(client):
    """PNG content type must also be accepted."""
    arr = np.zeros((800, 800, 3), dtype=np.uint8)
    arr[::2, ::2] = 255
    buf = io.BytesIO()
    Image.fromarray(arr, "RGB").save(buf, format="PNG")
    png_bytes = buf.getvalue()

    with _mock_all_services():
        r = client.post(
            "/process",
            files={"file": ("bill.png", png_bytes, "image/png")},
        )
    assert r.status_code == 200


def test_fraud_score_propagated_in_response(client):
    fraud_with_violation = FraudSignals(
        tampering_confidence=0.0,
        tampering_points=0,
        rule_violations=["missing_order_id"],
        rule_violation_points=10,
        fraud_score=10,
    )
    with _mock_all_services(fraud=fraud_with_violation):
        r = client.post(
            "/process",
            files={"file": ("bill.jpg", _make_jpeg_bytes(), "image/jpeg")},
        )

    assert r.status_code == 200
    fraud = r.json()["fraud_signals"]
    assert fraud["fraud_score"] == 10
    assert "missing_order_id" in fraud["rule_violations"]


# ── Platform support ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("platform", ["swiggy", "zomato", "zepto", "blinkit"])
def test_all_platforms_return_success(client, platform):
    bill = _good_bill().model_copy(update={"platform": platform})
    with _mock_all_services(parse=ParseResult(passed=True, data=bill)):
        r = client.post(
            "/process",
            files={"file": ("bill.jpg", _make_jpeg_bytes(), "image/jpeg")},
        )
    assert r.status_code == 200
    assert r.json()["extracted_data"]["platform"] == platform
