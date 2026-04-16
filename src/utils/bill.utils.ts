import crypto from 'crypto';
import { BillPlatform } from '../models/bill.model.ts';

export function toPlatform(raw: string | null | undefined): BillPlatform {
    return (raw ?? 'unknown').toLowerCase().trim() || 'unknown';
}

// ── GSTIN checksum validation ─────────────────────────────────────────────────
// GSTIN = 2-digit state + 10-char PAN + entity number + 'Z' + checksum (15 chars total)
// Checksum algorithm: weighted sum mod 36 over positions 1-14, mapped to alphanumeric char.

const _GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const _GSTIN_RE    = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function isValidGSTIN(gstin: string): boolean {
    const g = gstin.toUpperCase().trim();
    if (!_GSTIN_RE.test(g)) return false;
    let sum = 0;
    for (let i = 0; i < 14; i++) {
        const val     = _GSTIN_CHARS.indexOf(g[i]);
        const product = val * (i % 2 === 0 ? 1 : 2);   // weights: 1,2,1,2...
        sum += Math.floor(product / 36) + (product % 36);
    }
    return _GSTIN_CHARS[sum % 36] === g[14];
}

// ── PDF metadata fingerprint ──────────────────────────────────────────────────
// Extracts CreationDate + Producer + Author from raw PDF bytes (no library needed —
// these fields appear as plain text in the cross-reference stream or document catalog).
// Returns null if no metadata found (e.g. scanned images saved as PDF).

export function extractPdfMetadataHash(buffer: Buffer): string | null {
    // Scan only the first 64 KB — metadata is always near the start
    const text = buffer.toString('latin1', 0, Math.min(buffer.length, 65_536));
    const creationDate = text.match(/\/CreationDate\s*\(([^)]+)\)/)?.[1] ?? null;
    const producer     = text.match(/\/Producer\s*\(([^)]+)\)/)?.[1]     ?? null;
    const author       = text.match(/\/Author\s*\(([^)]+)\)/)?.[1]       ?? null;

    if (!creationDate && !producer && !author) return null;

    return crypto
        .createHash('sha256')
        .update([creationDate, producer, author].filter(Boolean).join('|'))
        .digest('hex');
}

// ── Platform email / FSSAI consistency ───────────────────────────────────────
// Known legitimate sender domains and FSSAI prefixes per supported platform.
// Used to catch bills where the platform label was tampered
// (e.g. a Blinkit bill made to look like a Swiggy bill).

const _PLATFORM_SIGNATURES: Record<string, { domains: string[]; fssai_prefix?: string }> = {
    zomato: {
        domains:      ['zomato.com'],
        fssai_prefix: '13',   // Zomato FSSAI — state code 13 (Haryana HO)
    },
    swiggy: {
        // invoicing@swiggy.in (Instamart) and support@swiggy.com (food delivery)
        domains: ['swiggy.com', 'bundl.com', 'swiggy.in'],
        // No fssai_prefix — Swiggy is a marketplace; seller FSSAI varies by region/state
    },
    zepto: {
        domains:      ['zeptonow.com', 'kiranakart.com'],
        fssai_prefix: '27',   // Zepto FSSAI — state code 27 (Maharashtra HO)
    },
    blinkit: {
        domains:      ['blinkit.com', 'grofers.com'],
        fssai_prefix: '08',   // Blinkit FSSAI — state code 08 (Rajasthan HO)
    },
    bbnow: {
        // BB Now (BigBasket Now) — Innovative Retail Concepts Pvt Ltd
        domains: ['bigbasket.com', 'bbnow.com'],
        // No fssai_prefix — BB holds a central FSSAI license (prefix '00'), not state-specific
    },
    instamart: {
        // Swiggy Instamart — same Swiggy corporate entity, invoicing@swiggy.in
        domains: ['swiggy.in', 'swiggy.com'],
        // No fssai_prefix — sellers (Swinsta and 3rd parties) have varied FSSAI state codes
    },
};

/**
 * Returns extra fraud score points if the bill's fbo_email or fssai_license
 * does not match the detected platform.
 * Returns 0 if platform unknown or fields are null (no penalty for missing data).
 */
export function platformConsistencyPenalty(
    platform: string | null,
    fboEmail: string | null,
    fssaiLicense: string | null,
): number {
    if (!platform) return 0;
    const sig = _PLATFORM_SIGNATURES[platform.toLowerCase()];
    if (!sig) return 0;

    let penalty = 0;

    // Email domain check — if present, its domain must be in the allowed list
    if (fboEmail) {
        const domain = fboEmail.split('@')[1]?.toLowerCase() ?? '';
        if (!sig.domains.some(d => domain === d || domain.endsWith('.' + d))) {
            penalty += 25;
        }
    }

    // FSSAI prefix check — if present, must start with expected state code
    if (fssaiLicense && sig.fssai_prefix) {
        if (!fssaiLicense.trim().startsWith(sig.fssai_prefix)) {
            penalty += 15;
        }
    }

    return penalty;
}
