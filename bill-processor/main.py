import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

import config
from models.schemas import ProcessSuccessResponse, ProcessFailResponse
from utils.image import compute_sha256, compute_phash, compute_text_phash
from services.quality import check_quality
from services.ocr import run_ocr
from services.parser import parse_bill, parse_bill_pdf
from services.tampering import check_tampering, check_pdf_tampering
from services.fraud import compute_fraud_signals

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not config.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY environment variable is not set")
    logger.info("Bill processor started — OPENAI_API_KEY present")
    yield


app = FastAPI(
    title="Bill Processor",
    version="1.0.0",
    description="OCR + AI extraction pipeline for Indian food delivery bills",
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    detail = "; ".join(
        f"{' → '.join(str(loc) for loc in e['loc'])}: {e['msg']}"
        for e in errors
    )
    logger.warning(f"Request validation failed: {detail}")
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
    content_type = (file.content_type or "").lower().split(";")[0].strip()
    filename = file.filename or "unknown"
    logger.info(f"[1/6] Received file: {filename!r} content_type={content_type!r}")

    # ── 1. File type validation ───────────────────────────────────────────────
    if content_type not in config.ALLOWED_CONTENT_TYPES:
        logger.warning(f"[1/6] REJECTED — unsupported content_type={content_type!r}")
        return _fail(400, "invalid_file", f"Unsupported file type '{content_type}'. Upload a JPEG, PNG, WebP, or PDF.")

    file_bytes = await file.read()

    if not file_bytes:
        logger.warning("[1/6] REJECTED — empty file")
        return _fail(400, "invalid_file", "Uploaded file is empty.")

    size_kb = len(file_bytes) / 1024
    if len(file_bytes) > config.MAX_FILE_SIZE_BYTES:
        mb = config.MAX_FILE_SIZE_BYTES // (1024 * 1024)
        logger.warning(f"[1/6] REJECTED — file too large ({size_kb:.1f} KB)")
        return _fail(400, "invalid_file", f"File too large. Maximum allowed size is {mb} MB.")

    logger.info(f"[1/6] File accepted — {size_kb:.1f} KB")

    # ── 2. Hashes ─────────────────────────────────────────────────────────────
    is_pdf = content_type in ("application/pdf", "application/octet-stream")
    image_hash = compute_sha256(file_bytes)

    if is_pdf:
        # phash for PDFs is content-based — computed after OCR (text not available yet)
        phash: str | None = None
        logger.info(f"[2/6] PDF sha256={image_hash[:16]}... — content phash deferred to after OCR")
    else:
        phash = compute_phash(file_bytes)
        logger.info(f"[2/6] sha256={image_hash[:16]}... phash={phash}")

    # ── 3. Quality gate ───────────────────────────────────────────────────────
    if not is_pdf:
        logger.info("[3/6] Running image quality check...")
        quality = check_quality(file_bytes)
        if not quality.passed:
            logger.warning(f"[3/6] REJECTED — quality check failed: {quality.reason} — {quality.detail}")
            return _fail(400, quality.reason, quality.detail.get("error", "Image quality is too low."))
        logger.info(f"[3/6] Quality OK — {quality.detail}")
    else:
        logger.info("[3/6] Skipping quality check for PDF")

    # ── 4. OCR ────────────────────────────────────────────────────────────────
    logger.info("[4/6] Running OCR...")
    ocr = run_ocr(file_bytes, content_type=content_type)
    if not ocr.passed:
        logger.error(f"[4/6] OCR FAILED — reason={ocr.reason!r} message={ocr.message!r}")
        return _fail(400, ocr.reason, ocr.message)
    logger.info(f"[4/6] OCR OK — extracted {len(ocr.text)} chars")

    # PDF content phash — computed from normalised extracted text.
    # Catches re-downloaded copies of the same invoice (different file bytes, same content).
    # Node.js findByPhash() will reject it as a near-duplicate before fraud scoring runs.
    if is_pdf:
        phash = compute_text_phash(ocr.text)
        logger.info(f"[4/6] PDF content phash={phash}")

    # ── 5. Parsing ────────────────────────────────────────────────────────────
    # PDFs: classify first (is this a real food delivery bill?) then regex extraction.
    # Images: full OpenAI extraction (layout is unpredictable — regex not reliable).
    logger.info("[5/6] Running parser...")
    parsed = parse_bill_pdf(ocr.text) if is_pdf else parse_bill(ocr.text)
    if not parsed.passed:
        logger.error(f"[5/6] PARSE FAILED — reason={parsed.reason!r} message={parsed.message!r}")
        return _fail(400, parsed.reason, parsed.message)
    logger.info(
        f"[5/6] Parse OK — platform={parsed.data.platform!r} "
        f"order_id={parsed.data.order_id!r} total={parsed.data.total_amount} "
        f"items={len(parsed.data.items)}"
    )

    # ── 6. Tampering + Fraud ──────────────────────────────────────────────────
    logger.info("[6/6] Running tampering detection and fraud scoring...")
    tampering = check_pdf_tampering(file_bytes) if is_pdf else check_tampering(file_bytes)
    fraud_signals = compute_fraud_signals(parsed.data, tampering)
    logger.info(
        f"[6/6] Done — tampering_confidence={tampering.confidence} "
        f"fraud_score={fraud_signals.fraud_score} "
        f"violations={fraud_signals.rule_violations}"
    )

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
