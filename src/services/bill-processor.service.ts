import { BILL_PROCESSOR_URL } from '../config/env.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';
import { BillPlatform } from '../models/bill.model.ts';

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
// Runs in Node after FastAPI responds — no FastAPI changes needed.

// Known Indian FMCG / grocery brands (sorted longest-first so "Kwality Walls" matches before "Kwality")
const KNOWN_BRANDS = [
    'Kwality Walls', 'Brooke Bond', 'Mother Dairy', 'Jain Dairy', 'Lay\'s',
    'Kellogg\'s', 'Haldiram\'s', 'Nature Fresh', 'Paper Boat', 'Too Yumm',
    'True Elements', 'Minute Maid', 'Mountain Dew', 'Hide & Seek',
    'Amul', 'Nestle', 'Nestlé', 'Tata', 'Britannia', 'Parle', 'Dabur',
    'Marico', 'Godrej', 'Kurkure', 'Maggi', 'Bingo', 'Sunfeast', 'Yippee',
    'Aashirvaad', 'Aashirvad', 'Fortune', 'Saffola', 'Sundrop', 'Patanjali',
    'Everest', 'MDH', 'Haldirams', 'Bikaji', 'Bikanervala', 'Govardhan',
    'Heritage', 'Epigamia', 'Oreo', 'Cadbury', 'Mondelez', 'KitKat', 'Munch',
    'Snickers', 'Galaxy', 'Nutella', 'Ferrero', 'Pringles', 'Doritos',
    'Nescafe', 'Bru', 'Lipton', 'Horlicks', 'Bournvita', 'Complan',
    'Tropicana', 'Real', 'Pepsi', 'Coca-Cola', 'Sprite', 'Fanta', '7Up',
    'Red Bull', 'Monster', 'McCain', 'Knorr', 'Kissan', 'Heinz', 'Quaker',
    'Yogabar', 'RiteBite', 'Soulfull', 'Wingreens', 'Prataap', 'Bikano',
    'Chitale', 'MTR', 'ITC', 'Go', 'Saras', 'Sumul', 'Nandini', 'Aavin',
].sort((a, b) => b.length - a.length);

/**
 * Extract brand from a product name.
 * Strategy: match against known brands list first (longest match wins),
 * then fall back to the first word of the product name.
 */
function extractBrand(productName: string): string | null {
    if (!productName) return null;
    const lower = productName.toLowerCase();
    for (const brand of KNOWN_BRANDS) {
        if (lower.startsWith(brand.toLowerCase())) return brand;
    }
    // Fallback: first word (most Indian products lead with brand name)
    const firstWord = productName.split(/[\s|,(-]/)[0].trim();
    return firstWord.length > 1 ? firstWord : null;
}

// HSN chapter (first 2 digits) → category
const HSN_CATEGORY: Record<string, string> = {
    '01': 'Meat & Poultry',
    '02': 'Meat & Poultry',
    '03': 'Fish & Seafood',
    '04': 'Dairy & Eggs',
    '07': 'Vegetables',
    '08': 'Fruits & Nuts',
    '09': 'Tea, Coffee & Spices',
    '10': 'Cereals & Grains',
    '11': 'Flour & Grain Products',
    '12': 'Oilseeds',
    '15': 'Oils & Fats',
    '16': 'Meat & Fish Preparations',
    '17': 'Sugar & Confectionery',
    '18': 'Cocoa & Chocolate',
    '19': 'Bakery & Cereals',
    '20': 'Packaged Fruits & Vegetables',
    '21': 'Snacks & Food Preparations',
    '22': 'Beverages',
    '24': 'Tobacco',
    '30': 'Medicines & Healthcare',
    '33': 'Personal Care',
    '34': 'Household Cleaning',
    '39': 'Household Plastics',
    '48': 'Stationery & Paper',
    '61': 'Clothing',
    '62': 'Clothing',
    '63': 'Home Textiles',
    '85': 'Electronics',
    '94': 'Furniture',
};

function extractCategory(hsnCode: string | null): string | null {
    if (!hsnCode) return null;
    const chapter = hsnCode.replace(/\s/g, '').slice(0, 2);
    return HSN_CATEGORY[chapter] ?? null;
}

/**
 * Enriches line items returned by FastAPI with brand and category fields.
 * Called in-process after a successful /process response.
 */
export function enrichLineItems(items: Omit<BillLineItem, 'brand' | 'category'>[]): BillLineItem[] {
    return items.map(item => ({
        ...item,
        brand:    extractBrand(item.name),
        category: extractCategory(item.hsn_code),
    }));
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
