"""
Central config module — single source of truth for all env vars.
All other modules import from here. Never call os.getenv() elsewhere.
"""
import os
from dotenv import load_dotenv

load_dotenv()

# ── External API credentials ──────────────────────────────────────────────────
OPENAI_API_KEY: str                    = os.environ.get("OPENAI_API_KEY", "")
GOOGLE_APPLICATION_CREDENTIALS: str   = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")

# ── File upload limits ────────────────────────────────────────────────────────
MAX_FILE_SIZE_BYTES: int               = 20 * 1024 * 1024   # 20 MB
ALLOWED_CONTENT_TYPES: frozenset[str] = frozenset({
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "application/pdf",
    "application/octet-stream",
})

# ── OCR quality thresholds ────────────────────────────────────────────────────
OCR_MIN_CONFIDENCE: float  = 0.60

# ── Image quality thresholds ─────────────────────────────────────────────────
MIN_SHARPNESS: float       = 80.0
MIN_BRIGHTNESS: float      = 40.0
MAX_BRIGHTNESS: float      = 250.0
MIN_WIDTH_PX: int          = 400
MIN_HEIGHT_PX: int         = 400

# ── Platform registry ─────────────────────────────────────────────────────────
# Every supported food/grocery delivery platform in lowercase.
# Add here when onboarding a new platform — parser.py and SQL comment must match.
ALLOWED_PLATFORMS: frozenset[str] = frozenset({
    "swiggy",
    "zomato",
    "zepto",
    "blinkit",
})

# ── Fraud score thresholds ────────────────────────────────────────────────────
TAMPERING_CONFIDENCE_THRESHOLD: float = 0.70
