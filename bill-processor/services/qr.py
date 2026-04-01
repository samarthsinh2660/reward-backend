"""
QR code extraction and validation for bill invoices.

Pipeline:
  1. Render the first page of the PDF (or use image directly) via PyMuPDF → numpy array
  2. Decode QR code(s) using OpenCV's built-in QRCodeDetector (no extra deps)
  3. Try to parse the decoded string as GST e-invoice JSON (IRP format)
  4. Cross-check QR fields against data extracted by the parser

GST IRN QR payload fields (IRP v1.01):
  SellerGstin, BuyerGstin, DocNo, DocDt, TotInvVal, ItemCnt, MainHsnCode, IRN, IssuDt
"""

import io
import json
import re
from typing import Optional

from models.schemas import QRValidation, ExtractedBillData


def decode_qr(file_bytes: bytes, content_type: str = "") -> Optional[str]:
    """
    Render the file to an image and decode the first QR code found.
    Returns the raw decoded string, or None if no QR found / error.
    """
    try:
        import cv2
        import numpy as np

        is_pdf = "pdf" in content_type or file_bytes[:4] == b"%PDF"

        if is_pdf:
            img_array = _pdf_to_image_array(file_bytes)
        else:
            arr = np.frombuffer(file_bytes, dtype=np.uint8)
            img_array = cv2.imdecode(arr, cv2.IMREAD_COLOR)

        if img_array is None:
            return None

        detector = cv2.QRCodeDetector()
        data, _, _ = detector.detectAndDecode(img_array)
        return data if data else None

    except Exception:
        return None


def validate_qr(
    file_bytes: bytes,
    content_type: str,
    extracted: ExtractedBillData,
) -> QRValidation:
    """
    Decode the QR code and cross-check its contents against extracted invoice data.
    """
    raw = decode_qr(file_bytes, content_type)

    if raw is None:
        return QRValidation(found=False, error="No QR code detected in the document")

    result = QRValidation(found=True, raw_data=raw[:500])  # cap stored length

    # ── Try GST e-invoice JSON format ─────────────────────────────────────────
    gst_data = _try_parse_gst_qr(raw)

    if gst_data:
        result.gstin = gst_data.get("SellerGstin")
        result.irn   = gst_data.get("IRN")

        # Cross-check order/invoice number
        qr_doc_no = str(gst_data.get("DocNo") or "").strip()
        if qr_doc_no and extracted.order_id:
            result.order_id_match = (
                qr_doc_no == extracted.order_id or
                extracted.order_id in qr_doc_no or
                qr_doc_no in extracted.order_id
            )

        # Cross-check total amount (allow ±1 rupee tolerance for rounding)
        qr_total = _to_float(gst_data.get("TotInvVal"))
        if qr_total is not None and extracted.total_amount is not None:
            result.amount_match = abs(qr_total - extracted.total_amount) <= 1.0

        # Cross-check date
        qr_date = _normalise_date(str(gst_data.get("DocDt") or ""))
        if qr_date and extracted.order_date:
            result.date_match = qr_date == extracted.order_date

    else:
        # Not GST format — try extracting key fields with regex from raw string
        # (some platforms use URL QRs or custom formats)
        result.order_id_match = _check_field_in_raw(extracted.order_id, raw)
        result.amount_match   = _check_amount_in_raw(extracted.total_amount, raw)

    return result


# ── Private helpers ───────────────────────────────────────────────────────────

def _pdf_to_image_array(file_bytes: bytes):
    """Render first page of PDF to a numpy BGR image array using PyMuPDF."""
    import fitz  # pymupdf
    import numpy as np

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    page = doc[0]
    # Render at 2x zoom for better QR detection on small codes
    mat = fitz.Matrix(2.0, 2.0)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    img_bytes = pix.tobytes("png")

    import cv2
    arr = np.frombuffer(img_bytes, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def _try_parse_gst_qr(raw: str) -> Optional[dict]:
    """
    GST IRP QR codes are JSON strings. Try to parse them.
    Also handles URL-encoded or slightly malformed variants.
    """
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        pass
    # Some QR codes are URL-like: key=value&key=value
    if "=" in raw and ("Gstin" in raw or "IRN" in raw or "DocNo" in raw):
        try:
            from urllib.parse import parse_qs
            qs = parse_qs(raw)
            return {k: v[0] for k, v in qs.items()}
        except Exception:
            pass
    return None


def _normalise_date(date_str: str) -> Optional[str]:
    """Convert DD/MM/YYYY or DD-MM-YYYY to YYYY-MM-DD."""
    m = re.search(r'(\d{2})[-/](\d{2})[-/](\d{4})', date_str)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    m = re.search(r'(\d{4})[-/](\d{2})[-/](\d{2})', date_str)
    if m:
        return m.group(0)
    return None


def _to_float(val) -> Optional[float]:
    try:
        return float(str(val).replace(',', '')) if val is not None else None
    except (TypeError, ValueError):
        return None


def _check_field_in_raw(field: Optional[str], raw: str) -> Optional[bool]:
    if not field:
        return None
    return field in raw


def _check_amount_in_raw(amount: Optional[float], raw: str) -> Optional[bool]:
    if amount is None:
        return None
    amount_str = f"{amount:.2f}"
    amount_int = str(int(amount))
    return amount_str in raw or amount_int in raw
