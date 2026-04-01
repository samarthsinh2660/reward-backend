import { BILL_PROCESSOR_URL } from '../config/env.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';
import { BillPlatform } from '../models/bill.model.ts';

const logger = createLogger('@bill-processor.service');

// ── Response types from FastAPI /process endpoint ─────────────────────────────

export type BillExtractedData = {
    platform: BillPlatform | null;
    order_id: string | null;
    order_date: string | null;          // YYYY-MM-DD
    merchant_name: string | null;
    total_amount: number | null;
    subtotal: number | null;
    delivery_fee: number | null;
    discount: number | null;
    taxes: number | null;
    items: BillLineItem[];
    currency: string;
    raw_text_snippet: string | null;
};

export type BillLineItem = {
    name: string;
    quantity: number | null;
    unit_price: number | null;
    total_price: number | null;
};

export type BillFraudSignals = {
    tampering_confidence: number;
    tampering_points: number;
    rule_violations: string[];
    rule_violation_points: number;
    fraud_score: number;
};

export type BillProcessorSuccess = {
    status: 'success';
    extracted_data: BillExtractedData;
    image_hash: string;   // SHA-256 (returned by FastAPI but we compute our own — used as cross-check)
    phash: string;        // perceptual hash (16-char hex)
    fraud_signals: BillFraudSignals;
};

export type BillProcessorFailure = {
    status: 'failed';
    reason: string;       // quality_low | ocr_failed | parse_failed | invalid_file
    message: string;      // user-facing message
};

export type BillProcessorResponse = BillProcessorSuccess | BillProcessorFailure;

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Forwards a bill image to the FastAPI bill-processor service.
 * Uses native fetch + FormData (Node 18+).
 * Returns the raw FastAPI response or a service-unavailable error.
 */
export async function callBillProcessor(
    fileBuffer: Buffer,
    mimetype: string,
    originalname: string
): Promise<{ ok: true; data: BillProcessorResponse } | { ok: false; error: RequestError }> {
    try {
        const form = new FormData();
        form.append(
            'file',
            new Blob([fileBuffer as unknown as ArrayBuffer], { type: mimetype }),
            originalname
        );

        const response = await fetch(`${BILL_PROCESSOR_URL}/process`, {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(30_000),   // 30 s timeout
        });

        const data = (await response.json()) as BillProcessorResponse;
        return { ok: true, data };
    } catch (error) {
        logger.error('Bill processor call failed', error);
        return { ok: false, error: ERRORS.BILL_PROCESSOR_UNAVAILABLE };
    }
}
