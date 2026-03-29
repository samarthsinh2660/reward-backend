"""
Unit tests for services/quality.py.

Uses real OpenCV processing on synthetic numpy arrays —
no mocking needed since the computations are deterministic.
"""
import io

import numpy as np
import pytest
from PIL import Image

from services.quality import check_quality
from config import MIN_WIDTH_PX, MIN_HEIGHT_PX, MIN_SHARPNESS, MIN_BRIGHTNESS, MAX_BRIGHTNESS


def _make_image_bytes(arr: np.ndarray, fmt: str = "JPEG") -> bytes:
    img = Image.fromarray(arr.astype(np.uint8), "RGB")
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def _sharp_array(h=600, w=600) -> np.ndarray:
    """High-contrast checkerboard → high Laplacian variance (above MIN_SHARPNESS)."""
    arr = np.zeros((h, w, 3), dtype=np.uint8)
    arr[::2, ::2] = 255
    return arr


def _uniform_array(h=600, w=600, brightness=128) -> np.ndarray:
    """Uniform colour → Laplacian variance ≈ 0 (blurry)."""
    return np.full((h, w, 3), brightness, dtype=np.uint8)


# ── Resolution check ──────────────────────────────────────────────────────────

def test_image_too_small_fails():
    arr = _sharp_array(h=200, w=200)
    result = check_quality(_make_image_bytes(arr))
    assert not result.passed
    assert result.reason == "quality_low"
    assert "too small" in result.detail["error"].lower()


def test_image_at_minimum_size_passes_resolution():
    arr = _sharp_array(h=MIN_HEIGHT_PX, w=MIN_WIDTH_PX)
    result = check_quality(_make_image_bytes(arr))
    # May still fail sharpness depending on checkerboard density — that's fine.
    # We're just asserting it's NOT rejected for resolution.
    assert "too small" not in result.detail.get("error", "")


# ── Sharpness check ───────────────────────────────────────────────────────────

def test_blurry_image_fails():
    """Uniform grey image has Laplacian variance ≈ 0 — should fail sharpness."""
    arr = _uniform_array(brightness=128)
    result = check_quality(_make_image_bytes(arr))
    assert not result.passed
    assert result.reason == "quality_low"
    assert "blurry" in result.detail["error"].lower()


def test_sharp_image_passes_sharpness():
    arr = _sharp_array(h=600, w=600)
    result = check_quality(_make_image_bytes(arr))
    # Sharp + well-lit → should pass
    assert result.passed


# ── Brightness check ──────────────────────────────────────────────────────────

def test_too_dark_fails():
    arr = _uniform_array(brightness=5)    # mean brightness ≈ 5, below MIN_BRIGHTNESS=40
    result = check_quality(_make_image_bytes(arr))
    assert not result.passed
    assert "dark" in result.detail["error"].lower()


def test_overexposed_fails():
    arr = _uniform_array(brightness=252)  # mean ≈ 252, above MAX_BRIGHTNESS=230
    result = check_quality(_make_image_bytes(arr))
    assert not result.passed
    assert "overexposed" in result.detail["error"].lower()


# ── Undecodable image ─────────────────────────────────────────────────────────

def test_garbage_bytes_fails_gracefully():
    result = check_quality(b"not-an-image")
    assert not result.passed
    assert result.reason == "quality_low"
    assert "error" in result.detail


# ── Passing image includes metrics in detail ──────────────────────────────────

def test_passing_image_detail_contains_metrics():
    arr = _sharp_array(h=600, w=600)
    result = check_quality(_make_image_bytes(arr))
    if result.passed:
        assert "sharpness"  in result.detail
        assert "brightness" in result.detail
        assert "resolution" in result.detail
        assert result.detail["sharpness"] >= MIN_SHARPNESS
        assert MIN_BRIGHTNESS <= result.detail["brightness"] <= MAX_BRIGHTNESS
