import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

import config
from models.schemas import ProcessSuccessResponse, ProcessFailResponse
from utils.image import compute_sha256, compute_phash
from services.quality import check_quality
from services.ocr import run_ocr
from services.parser import parse_bill
from services.tampering import check_tampering
from services.fraud import compute_fraud_signals


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Fail fast on startup if required credentials are missing."""
    if not config.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY environment variable is not set")

    if not config.GOOGLE_APPLICATION_CREDENTIALS:
        raise RuntimeError("GOOGLE_APPLICATION_CREDENTIALS environment variable is not set")

    if not os.path.exists(config.GOOGLE_APPLICATION_CREDENTIALS):
        raise RuntimeError(
            f"Google credentials file not found: {config.GOOGLE_APPLICATION_CREDENTIALS!r}"
        )

    yield


app = FastAPI(
    title="Bill Processor",
    version="1.0.0",
    description="OCR + AI extraction pipeline for Indian food delivery bills",
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Return our standard ProcessFailResponse shape for FastAPI 422 validation errors."""
    errors = exc.errors()
    detail = "; ".join(
        f"{' → '.join(str(loc) for loc in e['loc'])}: {e['msg']}"
        for e in errors
    )
    return JSONResponse(
        status_code=422,
        content=ProcessFailResponse(
            reason="invalid_request",
            message=f"Request validation failed: {detail}",
        ).model_dump(),
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post(
    "/process",
    response_model=ProcessSuccessResponse,
    responses={
        400: {"model": ProcessFailResponse},
        422: {"model": ProcessFailResponse},
    },
)
async def process_bill(file: UploadFile = File(...)):
    """
    Full bill processing pipeline:
      1. File type + size validation
      2. Image quality check  (OpenCV — sharpness, brightness, resolution)
      3. OCR                  (Google Vision API)
      4. Structured parsing   (OpenAI gpt-4o-mini)
      5. Tampering detection  (EXIF metadata + JPEG structure)
      6. Fraud scoring        (rule-based point system)
    """

    # ── 1. File type validation ───────────────────────────────────────────────
    content_type = (file.content_type or "").lower().split(";")[0].strip()
    if content_type not in config.ALLOWED_CONTENT_TYPES:
        return _fail(
            400,
            "invalid_file",
            f"Unsupported file type '{content_type}'. Upload a JPEG, PNG, or WebP image.",
        )

    file_bytes = await file.read()

    # Empty check must come before size check
    if not file_bytes:
        return _fail(400, "invalid_file", "Uploaded file is empty.")

    if len(file_bytes) > config.MAX_FILE_SIZE_BYTES:
        mb = config.MAX_FILE_SIZE_BYTES // (1024 * 1024)
        return _fail(400, "invalid_file", f"File too large. Maximum allowed size is {mb} MB.")

    # ── 2. Hashes (cheap — run before any API calls) ─────────────────────────
    image_hash = compute_sha256(file_bytes)
    phash      = compute_phash(file_bytes)

    # ── 3. Quality gate ───────────────────────────────────────────────────────
    quality = check_quality(file_bytes)
    if not quality.passed:
        return _fail(400, quality.reason, quality.detail.get("error", "Image quality is too low."))

    # ── 4. OCR ────────────────────────────────────────────────────────────────
    ocr = run_ocr(file_bytes)
    if not ocr.passed:
        return _fail(400, ocr.reason, ocr.message)

    # ── 5. Structured parsing ─────────────────────────────────────────────────
    parsed = parse_bill(ocr.text)
    if not parsed.passed:
        return _fail(400, parsed.reason, parsed.message)

    # ── 6. Tampering detection ────────────────────────────────────────────────
    tampering = check_tampering(file_bytes)

    # ── 7. Fraud scoring ──────────────────────────────────────────────────────
    fraud_signals = compute_fraud_signals(parsed.data, tampering)

    return ProcessSuccessResponse(
        extracted_data=parsed.data,
        image_hash=image_hash,
        phash=phash,
        fraud_signals=fraud_signals,
    )


def _fail(status_code: int, reason: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ProcessFailResponse(reason=reason, message=message).model_dump(),
    )
