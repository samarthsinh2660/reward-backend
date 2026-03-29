"""
Shared fixtures for the bill-processor test suite.

Sets up required environment variables and provides reusable image factories.
All env vars must be set before importing main.py (load_dotenv does not override existing vars).
"""
import io
import json
import os
import tempfile

import numpy as np
import pytest
from PIL import Image


# ── Environment setup (must run before app import) ────────────────────────────

@pytest.fixture(scope="session", autouse=True)
def setup_env(tmp_path_factory):
    """
    Create a fake Google credentials JSON file and set all required env vars.
    Runs once per test session before any test or fixture that imports main.py.
    """
    tmp_dir = tmp_path_factory.mktemp("credentials")
    creds_path = str(tmp_dir / "vision.json")
    with open(creds_path, "w") as f:
        json.dump({"type": "service_account", "project_id": "test"}, f)

    os.environ.setdefault("OPENAI_API_KEY", "test-key-not-real")
    os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", creds_path)
    yield


# ── Image factories ───────────────────────────────────────────────────────────

def make_jpeg_bytes(
    width: int = 800,
    height: int = 800,
    pattern: str = "sharp",
    brightness: int = 128,
) -> bytes:
    """
    Generate a synthetic JPEG image as bytes for testing.

    pattern:
      'sharp'   → checkerboard (high Laplacian variance)
      'uniform' → solid grey  (Laplacian variance ≈ 0, looks blurry to OpenCV)
    brightness: 0–255 grey value for 'uniform' pattern
    """
    if pattern == "sharp":
        arr = np.zeros((height, width, 3), dtype=np.uint8)
        arr[::2, ::2] = 255     # white pixels on even rows/cols → high contrast
    else:
        arr = np.full((height, width, 3), brightness, dtype=np.uint8)

    img = Image.fromarray(arr, "RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def make_png_bytes(width: int = 800, height: int = 800) -> bytes:
    arr = np.zeros((height, width, 3), dtype=np.uint8)
    arr[::2, ::2] = 255
    img = Image.fromarray(arr, "RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def sharp_jpeg():
    return make_jpeg_bytes(pattern="sharp")


@pytest.fixture
def small_jpeg():
    return make_jpeg_bytes(width=200, height=200, pattern="sharp")


@pytest.fixture
def blurry_jpeg():
    return make_jpeg_bytes(pattern="uniform", brightness=128)


@pytest.fixture
def dark_jpeg():
    return make_jpeg_bytes(pattern="uniform", brightness=10)


@pytest.fixture
def bright_jpeg():
    return make_jpeg_bytes(pattern="uniform", brightness=250)
