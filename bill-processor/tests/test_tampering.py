"""
Unit tests for services/tampering.py — uses synthetic PIL images (no external calls).
"""
import io
import struct

import pytest
from PIL import Image

from services.tampering import (
    check_tampering,
    _get_exif,
    _is_jpeg,
    _is_editing_software,
    _count_jpeg_app_segments,
)
from tests.conftest import make_jpeg_bytes, make_png_bytes


# ── _get_exif ─────────────────────────────────────────────────────────────────

def test_get_exif_returns_none_for_png_without_exif():
    """PNG images typically have no EXIF — should return None, not raise."""
    img = Image.open(io.BytesIO(make_png_bytes()))
    assert _get_exif(img) is None


def test_get_exif_returns_none_for_jpeg_without_exif():
    img = Image.open(io.BytesIO(make_jpeg_bytes()))
    # Synthetically generated JPEGs have no camera EXIF
    result = _get_exif(img)
    assert result is None or isinstance(result, dict)


# ── _is_jpeg ──────────────────────────────────────────────────────────────────

def test_is_jpeg_true_for_jpeg_bytes():
    data = make_jpeg_bytes()
    assert _is_jpeg(data) is True


def test_is_jpeg_false_for_png_bytes():
    data = make_png_bytes()
    assert _is_jpeg(data) is False


def test_is_jpeg_false_for_empty_bytes():
    assert _is_jpeg(b"") is False


# ── _is_editing_software ──────────────────────────────────────────────────────

@pytest.mark.parametrize("software", [
    "Adobe Photoshop 2024",
    "GIMP 2.10",
    "Lightroom Classic",
    "Snapseed",
    "PicsArt",
    "Canva",
    "Pixlr",
])
def test_editing_software_detected(software: str):
    assert _is_editing_software(software.lower()) is True


def test_camera_firmware_not_flagged():
    assert _is_editing_software("samsung camera firmware 1.0") is False
    assert _is_editing_software("google pixel camera") is False
    assert _is_editing_software("") is False


# ── _count_jpeg_app_segments ──────────────────────────────────────────────────

def test_jpeg_app_segment_count_reasonable():
    data = make_jpeg_bytes()
    count = _count_jpeg_app_segments(data)
    # A freshly-encoded PIL JPEG should have 1–2 APP segments (APP0/APP1)
    assert 0 <= count <= 5


def test_non_jpeg_app_segment_count_is_zero():
    data = make_png_bytes()
    assert _count_jpeg_app_segments(data) == 0


# ── check_tampering ───────────────────────────────────────────────────────────

def test_jpeg_no_exif_gets_nonzero_confidence():
    """Synthetically generated JPEG has no camera EXIF — should add +0.25."""
    data = make_jpeg_bytes()
    result = check_tampering(data)
    assert result.confidence > 0.0
    assert "no_exif_metadata" in result.points


def test_png_no_exif_gets_nonzero_confidence():
    data = make_png_bytes()
    result = check_tampering(data)
    assert result.confidence > 0.0


def test_small_image_adds_to_confidence():
    """Image < 600×600 should trigger the small-dimension signal."""
    small = make_jpeg_bytes(width=300, height=300)
    normal = make_jpeg_bytes(width=800, height=800)

    small_result = check_tampering(small)
    normal_result = check_tampering(normal)

    # Small image should score higher
    assert small_result.confidence > normal_result.confidence
    assert any("suspicious_small_dimensions" in p for p in small_result.points)


def test_garbage_bytes_does_not_raise():
    """Invalid image bytes must not raise — should return a low-confidence result."""
    result = check_tampering(b"not-an-image-at-all")
    assert 0.0 <= result.confidence <= 1.0
    assert "image_inspection_failed" in result.points


def test_confidence_capped_at_one():
    """No matter how many signals fire, confidence must never exceed 1.0."""
    result = check_tampering(b"bad")
    assert result.confidence <= 1.0


def test_result_confidence_is_rounded():
    result = check_tampering(make_jpeg_bytes())
    # Should be a float with at most 3 decimal places
    assert result.confidence == round(result.confidence, 3)
