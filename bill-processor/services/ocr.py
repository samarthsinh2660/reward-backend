from google.cloud import vision

from config import OCR_MIN_CONFIDENCE


class OCRResult:
    def __init__(self, passed: bool, text: str = "", reason: str = "", message: str = ""):
        self.passed = passed
        self.text = text
        self.reason = reason
        self.message = message


def run_ocr(file_bytes: bytes) -> OCRResult:
    """
    Send image to Google Vision API and extract raw text.
    GOOGLE_APPLICATION_CREDENTIALS env var points to the service account JSON.
    Returns OCRResult with passed=True and full extracted text on success.
    """
    try:
        client = vision.ImageAnnotatorClient()
        image = vision.Image(content=file_bytes)
        response = client.document_text_detection(image=image)

        if response.error.message:
            return OCRResult(
                False, "", "ocr_failed",
                f"Vision API error: {response.error.message}",
            )

        full_text = response.full_text_annotation.text

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
                if avg_confidence < OCR_MIN_CONFIDENCE:
                    return OCRResult(
                        False, "", "ocr_failed",
                        f"Bill text is not clear enough (confidence: {avg_confidence:.0%}). "
                        "Please upload a sharper image.",
                    )

        return OCRResult(True, full_text.strip())

    except Exception:
        return OCRResult(
            False, "", "ocr_failed",
            "OCR service unavailable. Please try again.",
        )
