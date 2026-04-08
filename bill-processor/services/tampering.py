import io
import logging
import struct
from PIL import Image, ExifTags
import pypdf

from config import TAMPERING_CONFIDENCE_THRESHOLD  # noqa: F401 — re-exported for fraud.py

logger = logging.getLogger(__name__)


class TamperingResult:
    def __init__(self, confidence: float, points: list[str]):
        self.confidence = confidence    # 0.0 – 1.0
        self.points = points            # human-readable reason codes


def check_tampering(file_bytes: bytes) -> TamperingResult:
    """
    Heuristic tampering detection using EXIF metadata and JPEG structure.
    Returns a confidence score (0.0 = clean, 1.0 = very likely tampered).

    Score contributions:
      +0.25  — no EXIF at all (screenshots and web-downloaded images have no camera EXIF)
      +0.20  — EXIF present but camera make/model stripped
      +0.20  — editing software detected in EXIF (Photoshop, GIMP, Snapseed, etc.)
      +0.15  — 4+ JPEG APP segments (re-saved/re-encoded multiple times after editing)
      +0.20  — image smaller than 600×600 px (suspicious for a real phone photo)
    """
    reasons: list[str] = []
    score = 0.0

    try:
        img = Image.open(io.BytesIO(file_bytes))
        exif = _get_exif(img)

        if exif is None:
            score += 0.25
            reasons.append("no_exif_metadata")
        else:
            if not exif.get("Make") and not exif.get("Model"):
                score += 0.20
                reasons.append("exif_camera_fields_missing")

            software = (exif.get("Software") or "").lower()
            if _is_editing_software(software):
                score += 0.20
                reasons.append(f"editing_software_detected:{software}")

        if _is_jpeg(file_bytes):
            app_count = _count_jpeg_app_segments(file_bytes)
            if app_count >= 4:
                score += 0.15
                reasons.append(f"multiple_jpeg_app_segments:{app_count}")

        w, h = img.size
        if w < 600 or h < 600:
            score += 0.20
            reasons.append(f"suspicious_small_dimensions:{w}x{h}")

    except Exception as e:
        logger.warning(f"Tampering check error ({type(e).__name__}): {e}")
        score += 0.10
        reasons.append("image_inspection_failed")

    result = TamperingResult(confidence=round(min(score, 1.0), 3), points=reasons)
    logger.info(f"Tampering result: confidence={result.confidence} reasons={reasons}")
    return result


def check_pdf_tampering(file_bytes: bytes) -> TamperingResult:
    """
    Lightweight PDF tampering heuristics using metadata and object structure.
    Returns a confidence score (0.0 = clean, 1.0 = likely tampered).
    """
    reasons: list[str] = []
    score = 0.0

    try:
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))

        if reader.is_encrypted:
            score += 0.15
            reasons.append("pdf_encrypted")

        metadata = reader.metadata or {}
        producer = str(metadata.get("/Producer", "")).lower()
        creator = str(metadata.get("/Creator", "")).lower()
        suspicious_tools = (
            "photoshop", "gimp", "illustrator", "canva",
            "acrobat", "pdf editor", "smallpdf", "ilovepdf",
        )
        if any(tool in producer for tool in suspicious_tools) or any(tool in creator for tool in suspicious_tools):
            score += 0.25
            reasons.append("pdf_edited_by_known_tool")

        modified_date = str(metadata.get("/ModDate", ""))
        created_date = str(metadata.get("/CreationDate", ""))
        if modified_date and created_date and modified_date != created_date:
            score += 0.15
            reasons.append("pdf_modified_after_creation")

        root = reader.trailer.get("/Root")
        if root and "/Names" in root:
            names = root.get("/Names")
            if names and "/EmbeddedFiles" in names:
                score += 0.20
                reasons.append("pdf_contains_embedded_files")

        # Invoice PDFs should never need JavaScript actions.
        if root and ("/OpenAction" in root or "/AA" in root):
            score += 0.30
            reasons.append("pdf_contains_script_or_auto_action")

    except Exception as e:
        logger.warning(f"PDF tampering check error ({type(e).__name__}): {e}")
        score += 0.10
        reasons.append("pdf_inspection_failed")

    result = TamperingResult(confidence=round(min(score, 1.0), 3), points=reasons)
    logger.info(f"PDF tampering result: confidence={result.confidence} reasons={reasons}")
    return result


# ── Private helpers ───────────────────────────────────────────────────────────

def _get_exif(img: Image.Image) -> dict | None:
    """
    Return a tag-name → value dict from PIL EXIF data, or None if absent.
    Uses `getexif()` (Pillow 6+) — replaces the deprecated private `_getexif()`.
    """
    try:
        exif = img.getexif()        # IFDDictionary; never returns None
        if not exif:                # empty = no EXIF embedded
            return None
        return {
            ExifTags.TAGS.get(k, str(k)): v
            for k, v in exif.items()
        }
    except Exception:
        return None


_EDITING_KEYWORDS = (
    "photoshop", "gimp", "lightroom", "snapseed", "picsart",
    "pixlr", "canva", "preview", "paint.net", "affinity",
    "adobe", "darktable", "rawtherapee",
)


def _is_editing_software(software_str: str) -> bool:
    return any(kw in software_str for kw in _EDITING_KEYWORDS)


def _is_jpeg(data: bytes) -> bool:
    return data[:2] == b"\xff\xd8"


def _count_jpeg_app_segments(data: bytes) -> int:
    """Count JPEG APP0–APP15 markers. High count implies re-encoding after editing."""
    count = 0
    i = 0
    while i < len(data) - 1:
        if data[i] == 0xFF:
            marker = data[i + 1]
            if 0xE0 <= marker <= 0xEF:
                count += 1
            if marker not in (0xD8, 0xD9, 0x01) and i + 3 < len(data):
                seg_len = struct.unpack(">H", data[i + 2: i + 4])[0]
                i += 2 + seg_len
                continue
        i += 1
    return count
