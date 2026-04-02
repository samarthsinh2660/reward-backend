import logging
import cv2

from config import MIN_SHARPNESS, MIN_BRIGHTNESS, MAX_BRIGHTNESS, MIN_WIDTH_PX, MIN_HEIGHT_PX
from utils.image import bytes_to_cv2

logger = logging.getLogger(__name__)


class QualityResult:
    def __init__(self, passed: bool, reason: str = "", detail: dict | None = None):
        self.passed = passed
        self.reason = reason
        self.detail: dict = detail or {}


def check_quality(file_bytes: bytes) -> QualityResult:
    """
    OpenCV quality gate. Returns QualityResult with passed=True if the image
    is sharp, well-lit, and large enough for OCR to work reliably.
    """
    img = bytes_to_cv2(file_bytes)

    if img is None:
        logger.error("Quality check: could not decode image bytes with OpenCV")
        return QualityResult(False, "quality_low", {"error": "Could not decode image"})

    h, w = img.shape[:2]

    if w < MIN_WIDTH_PX or h < MIN_HEIGHT_PX:
        return QualityResult(
            False, "quality_low",
            {"error": f"Image too small ({w}×{h}). Minimum {MIN_WIDTH_PX}×{MIN_HEIGHT_PX} px required."},
        )

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
    if sharpness < MIN_SHARPNESS:
        return QualityResult(
            False, "quality_low",
            {"error": f"Image is too blurry (score: {sharpness:.1f}). Please retake in better light."},
        )

    brightness = gray.mean()
    if brightness < MIN_BRIGHTNESS:
        return QualityResult(
            False, "quality_low",
            {"error": f"Image is too dark (brightness: {brightness:.1f}). Please use better lighting."},
        )
    if brightness > MAX_BRIGHTNESS:
        return QualityResult(
            False, "quality_low",
            {"error": f"Image is overexposed (brightness: {brightness:.1f}). Avoid flash or direct light."},
        )

    detail = {"sharpness": round(sharpness, 2), "brightness": round(brightness, 2), "resolution": f"{w}x{h}"}
    logger.info(f"Quality OK: {detail}")
    return QualityResult(True, "", detail)
