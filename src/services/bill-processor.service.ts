import OpenAI from 'openai';
import { BILL_PROCESSOR_URL, OPENAI_API_KEY } from '../config/env.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';
import { BillPlatform } from '../models/bill.model.ts';
import { BrandRepository } from '../repositories/brand.repository.ts';

const logger = createLogger('@bill-processor.service');

// ── Response types from FastAPI /process endpoint ─────────────────────────────

export type BillExtractedData = {
    platform: string | null;
    is_supported_platform: boolean;
    order_id: string | null;
    order_date: string | null;          // YYYY-MM-DD
    merchant_name: string | null;
    seller_gstin: string | null;
    fssai_license: string | null;       // 14-digit FSSAI food business license number
    fbo_email: string | null;           // platform support email (e.g. support@zeptonow.com)
    customer_name: string | null;       // "Bill To" name
    total_amount: number | null;
    subtotal: number | null;
    delivery_fee: number | null;
    handling_fee: number | null;        // handling + late night + surge combined
    extra_charges: number | null;       // catch-all for unrecognised fee types
    coupon_code: string | null;         // promo code applied (e.g. "ZEPTOSAVE50")
    discount: number | null;
    taxes: number | null;
    items: BillLineItem[];
    currency: string;
    delivery_area: string | null;
    delivery_city: string | null;
    delivery_state: string | null;
    delivery_pincode: string | null;
    place_of_supply: string | null;
    raw_text_snippet: string | null;
};

export type BillLineItem = {
    name: string;
    hsn_code: string | null;
    quantity: number | null;
    unit_price: number | null;
    total_price: number | null;
    brand: string | null;       // extracted from product name
    category: string | null;    // derived from HSN code
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

// ── Brand & Category enrichment ───────────────────────────────────────────────
// DB-backed brand dictionary with GPT fallback for unknown brands.
// In-memory cache avoids a DB query on every item — refreshed every 5 minutes
// or immediately after a new GPT-discovered brand is saved.

let _brandCache: string[] | null = null;
let _brandCacheAt = 0;
const _BRAND_CACHE_TTL = 5 * 60 * 1000;   // 5 minutes

let _hsnCache: Record<string, string> | null = null;

let _openaiClient: OpenAI | null = null;
function _getOpenAI(): OpenAI {
    if (!_openaiClient) _openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
    return _openaiClient;
}

async function _getBrands(): Promise<string[]> {
    if (_brandCache && Date.now() - _brandCacheAt < _BRAND_CACHE_TTL) return _brandCache;
    const result = await BrandRepository.findAllNames();
    if (result.isOk()) {
        _brandCache = result.value;
        _brandCacheAt = Date.now();
    }
    return _brandCache ?? [];
}

async function _getHsnCategories(): Promise<Record<string, string>> {
    if (_hsnCache) return _hsnCache;
    const result = await BrandRepository.findAllHsnCategories();
    if (result.isOk()) _hsnCache = result.value;
    return _hsnCache ?? {};
}

const _GPT_BRAND_PROMPT = `You are a brand name extractor for Indian grocery and food delivery products.
Given a product name, identify and return the brand name.

Rules:
- Fresh vegetables, fruits, or unprocessed produce (tomatoes, bananas, spinach, onions, apples etc.) → brand: null
- Generic unbranded staples with no brand prefix (loose salt, sugar, atta in bulk) → brand: null
- Packaged or processed products → return only the brand name (e.g. "Parle", "Amul", "Mother Dairy")
- Multi-word brands must be returned in full (e.g. "Mother Dairy", "Paper Boat", "Kwality Walls")
- If uncertain, return null rather than guessing

Return ONLY valid JSON with no markdown: {"brand": "BrandName"} or {"brand": null}`;

/**
 * Ask GPT-4.1-mini for the brand name of an unknown product.
 * ~$0.000003 per call. Returns null for fresh produce and unbranded items.
 * Returns "Other" if GPT call fails entirely (network, quota etc.).
 */
async function _askGptForBrand(productName: string): Promise<string | null> {
    if (!OPENAI_API_KEY) return 'Other';
    try {
        const response = await _getOpenAI().chat.completions.create({
            model: 'gpt-4.1-mini',
            messages: [
                { role: 'system', content: _GPT_BRAND_PROMPT },
                { role: 'user', content: productName },
            ],
            max_tokens: 20,
            temperature: 0,
            response_format: { type: 'json_object' },
        });
        const raw = response.choices[0]?.message?.content ?? '{}';
        const parsed = JSON.parse(raw) as { brand?: string | null };
        const brand = parsed.brand && typeof parsed.brand === 'string' ? parsed.brand.trim() : null;
        return brand || null;   // null = GPT confirmed no brand (fresh produce / unbranded)
    } catch (error) {
        logger.warn(`GPT brand extraction failed for "${productName}" — falling back to "Other"`, error);
        return 'Other';         // GPT unavailable — don't leave brand empty
    }
}

async function _extractBrand(productName: string): Promise<string | null> {
    if (!productName) return null;
    const lower = productName.toLowerCase();
    const brands = await _getBrands();

    // 1. DB cache — prefix match, longest-first to avoid partial hits
    for (const brand of brands) {
        if (lower.startsWith(brand.toLowerCase())) return brand;
    }

    // 2. GPT fallback — only called for genuinely unknown brands
    const gptBrand = await _askGptForBrand(productName);
    if (gptBrand && gptBrand !== 'Other') {
        await BrandRepository.insert(gptBrand);
        _brandCache = null;   // invalidate so next call picks up new entry
        logger.info(`GPT discovered new brand: "${gptBrand}" from "${productName}"`);
    }
    return gptBrand;
}

async function _extractCategory(hsnCode: string | null): Promise<string | null> {
    if (!hsnCode) return null;
    const hsn = hsnCode.replace(/\s/g, '');
    const map = await _getHsnCategories();
    // Try 6-digit, 4-digit, then 2-digit chapter fallback
    return map[hsn.slice(0, 6)] ?? map[hsn.slice(0, 4)] ?? map[hsn.slice(0, 2)] ?? null;
}

/**
 * Enriches line items returned by FastAPI with brand and category fields.
 * Async — queries DB brand cache, falls back to GPT for unknown brands.
 */
export async function enrichLineItems(items: Omit<BillLineItem, 'brand' | 'category'>[]): Promise<BillLineItem[]> {
    return Promise.all(items.map(async item => ({
        ...item,
        brand:    await _extractBrand(item.name),
        category: await _extractCategory(item.hsn_code),
    })));
}

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
