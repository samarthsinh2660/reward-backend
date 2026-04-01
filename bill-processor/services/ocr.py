import base64
import io
import logging

import config

logger = logging.getLogger(__name__)


class OCRResult:
    def __init__(self, passed: bool, text: str = "", reason: str = "", message: str = ""):
        self.passed = passed
        self.text = text
        self.reason = reason
        self.message = message


def run_ocr(file_bytes: bytes, content_type: str = "") -> OCRResult:
    """
    Extract text from the uploaded file.
    - PDFs:   extract embedded text directly using pypdf (free, no API)
    - Images: OpenAI Vision gpt-4o (real OCR, replaces demo mock)
    """
    is_pdf = "pdf" in content_type or file_bytes[:4] == b"%PDF"

    if is_pdf:
        logger.info("OCR: PDF detected — using pypdf text extraction")
        return _extract_pdf_text(file_bytes)

    logger.info(f"OCR: image detected ({content_type}) — using OpenAI Vision")
    return _extract_image_text_via_vision(file_bytes, content_type)


# ── PDF: embedded text extraction ─────────────────────────────────────────────

def _extract_pdf_text(file_bytes: bytes) -> OCRResult:
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(file_bytes))
        pages_text = [page.extract_text() or "" for page in reader.pages]
        full_text = "\n".join(pages_text).strip()

        if not full_text or len(full_text) < 10:
            logger.warning("pypdf extracted no text — may be a scanned/image PDF")
            return OCRResult(
                False, "", "ocr_failed",
                "Could not extract text from this PDF. It may be a scanned image — please upload a photo instead.",
            )

        logger.info(f"pypdf extracted {len(full_text)} chars from PDF")
        return OCRResult(True, full_text)

    except Exception as e:
        logger.error(f"PDF text extraction failed ({type(e).__name__}): {e}")
        return OCRResult(False, "", "ocr_failed", f"Failed to read PDF: {e}")


# ── Images: OpenAI Vision ──────────────────────────────────────────────────────

def _extract_image_text_via_vision(file_bytes: bytes, mime_type: str) -> OCRResult:
    """
    Send the image to gpt-4o vision and extract all raw text.
    Returns plain text — the parser handles structuring it.
    """
    try:
        from openai import OpenAI

        # Normalise mime type for the data URI
        if not mime_type or mime_type == "application/octet-stream":
            mime_type = "image/jpeg"

        b64 = base64.standard_b64encode(file_bytes).decode()
        client = OpenAI(api_key=config.OPENAI_API_KEY)

        logger.info("Calling OpenAI Vision (gpt-4o) for image OCR...")
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{b64}",
                            "detail": "high",
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "Extract ALL text from this food delivery / grocery bill image. "
                            "Return ONLY the raw text exactly as it appears, preserving line breaks. "
                            "Do not summarize, interpret, or add any explanation."
                        ),
                    },
                ],
            }],
            max_tokens=2000,
        )

        text = (response.choices[0].message.content or "").strip()
        logger.info(f"OpenAI Vision extracted {len(text)} chars")

        if not text or len(text) < 10:
            return OCRResult(False, "", "ocr_failed", "Could not read text from this image. Please upload a clearer photo.")

        return OCRResult(True, text)

    except Exception as e:
        logger.error(f"OpenAI Vision failed ({type(e).__name__}): {e}")
        return OCRResult(
            False, "", "ocr_failed",
            "Could not read this image. Please upload a clearer photo or use a PDF bill.",
        )
