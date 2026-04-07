import time
import io

from google.cloud import vision
import logging

import config
from config import OCR_MIN_CONFIDENCE

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_RETRY_DELAY = 1.5   # seconds between attempts
_PDF_TYPES = {"application/pdf", "application/octet-stream"}


class OCRResult:
    def __init__(self, passed: bool, text: str = "", reason: str = "", message: str = ""):
        self.passed = passed
        self.text = text
        self.reason = reason
        self.message = message


def _extract_pdf_text(file_bytes: bytes) -> OCRResult:
    """Extract embedded text from a PDF using pypdf — no API call needed."""
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        pages_text = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                pages_text.append(t)
        full_text = "\n".join(pages_text).strip()
        if not full_text or len(full_text) < 20:
            return OCRResult(
                False, "", "ocr_failed",
                "Could not extract text from PDF. The file may be a scanned image — please upload as a photo instead.",
            )
        logger.info(f"PDF text extraction OK — {len(full_text)} chars from {len(reader.pages)} page(s)")
        return OCRResult(True, full_text)
    except Exception as e:
        logger.error(f"PDF text extraction failed ({type(e).__name__}): {e}")
        return OCRResult(False, "", "ocr_failed", f"PDF read error: {e}")


def run_ocr(file_bytes: bytes, content_type: str = "") -> OCRResult:
    """
    For PDFs: extract embedded text via pypdf (no Vision API).
    For images: send to Google Vision API with up to 3 retries.
    """
    if content_type.lower() in _PDF_TYPES:
        return _extract_pdf_text(file_bytes)

    last_exception: Exception | None = None

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            client = vision.ImageAnnotatorClient()
            image = vision.Image(content=file_bytes)
            response = client.document_text_detection(image=image)

            # Hard API error (wrong credentials, quota exceeded, etc.) — no point retrying
            if response.error.message:
                return OCRResult(
                    False, "", "ocr_failed",
                    f"Vision API error: {response.error.message}",
                )

            full_text = response.full_text_annotation.text

            # Content issue — retrying won't help
            if not full_text or len(full_text.strip()) < 20:
                return OCRResult(
                    False, "", "ocr_failed",
                    "Could not read text from your bill. Please upload a clearer image.",
                )

            pages = response.full_text_annotation.pages
            if pages:
                confidences = [
                    block.confidence
                    for page in pages
                    for block in page.blocks
                    if block.confidence > 0
                ]
                if confidences:
                    avg_confidence = sum(confidences) / len(confidences)
                    # Low confidence is a content issue — retrying won't help
                    if avg_confidence < OCR_MIN_CONFIDENCE:
                        return OCRResult(
                            False, "", "ocr_failed",
                            f"Bill text is not clear enough (confidence: {avg_confidence:.0%}). "
                            "Please upload a sharper image.",
                        )

            return OCRResult(True, full_text.strip())

        except Exception as e:
            last_exception = e
            if attempt < _MAX_RETRIES:
                time.sleep(_RETRY_DELAY)

    return OCRResult(
        False, "", "ocr_failed",
        "OCR service unavailable. Please try again.",
    )
