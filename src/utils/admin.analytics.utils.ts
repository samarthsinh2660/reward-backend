import { AnalyticsFilters } from '../models/admin.analytics.model.ts';

const INDIAN_REGION_BY_STATE: Record<string, string> = {
    'andhra pradesh': 'South',
    'arunachal pradesh': 'North East',
    assam: 'North East',
    bihar: 'East',
    chhattisgarh: 'Central',
    goa: 'West',
    gujarat: 'West',
    haryana: 'North',
    'himachal pradesh': 'North',
    jharkhand: 'East',
    karnataka: 'South',
    kerala: 'South',
    'madhya pradesh': 'Central',
    maharashtra: 'West',
    manipur: 'North East',
    meghalaya: 'North East',
    mizoram: 'North East',
    nagaland: 'North East',
    odisha: 'East',
    punjab: 'North',
    rajasthan: 'North',
    sikkim: 'North East',
    'tamil nadu': 'South',
    telangana: 'South',
    tripura: 'North East',
    uttarakhand: 'North',
    'uttar pradesh': 'North',
    'west bengal': 'East',
    delhi: 'North',
    chandigarh: 'North',
};

export function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

export function normalizePlatformCode(value: string | null | undefined): string {
    return normalizeWhitespace((value ?? 'unknown').toLowerCase()) || 'unknown';
}

export function normalizeBrandName(value: string | null | undefined): string | null {
    if (!value) return null;
    const normalized = normalizeWhitespace(value);
    return normalized.length > 0 ? normalized : null;
}

export function normalizeProductName(value: string): string {
    return normalizeWhitespace(
        value
            .replace(/[|]+/g, ' ')
            .replace(/[_]+/g, ' ')
            .replace(/[^\w\s.%/-]/g, ' ')
    );
}

export function slugify(value: string): string {
    return normalizeWhitespace(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function extractPackSize(value: string): string | null {
    const match = value.match(/(\d+(?:\.\d+)?)\s?(kg|g|gm|ml|l|ltr|litre|litres|pcs|pc|piece|pack|pk)/i);
    return match ? `${match[1]}${match[2].toLowerCase()}` : null;
}

export function inferUnitType(productName: string, quantity: number | null): string | null {
    const lower = productName.toLowerCase();
    if (/\b(kg|g|gm)\b/.test(lower)) return 'weight';
    if (/\b(ml|l|ltr|litre|litres)\b/.test(lower)) return 'volume';
    if (/\b(pcs|pc|piece|pieces|pack|pk)\b/.test(lower)) return 'piece';
    if (quantity && Number.isFinite(quantity) && quantity > 0) return 'unit';
    return null;
}

export function inferRegion(state: string | null | undefined, city: string | null | undefined): string | null {
    const normalizedState = normalizeWhitespace((state ?? '').toLowerCase());
    if (normalizedState && INDIAN_REGION_BY_STATE[normalizedState]) {
        return INDIAN_REGION_BY_STATE[normalizedState];
    }
    if (city) return normalizeWhitespace(city);
    return null;
}

export function formatCompanyName(platform: string | null | undefined, merchantName: string | null | undefined): string {
    const platformCode = normalizePlatformCode(platform);
    if (platformCode !== 'unknown') {
        return platformCode
            .split(/[-_\s]+/)
            .filter(Boolean)
            .map(token => token.charAt(0).toUpperCase() + token.slice(1))
            .join(' ');
    }
    return merchantName ? normalizeWhitespace(merchantName) : 'Unknown';
}

export function inferCompanyType(platform: string | null | undefined): string {
    const code = normalizePlatformCode(platform);
    if (['blinkit', 'zepto'].includes(code)) return 'quick_commerce';
    if (['swiggy', 'zomato'].includes(code)) return 'food_delivery';
    return 'merchant';
}

export function parseJsonObject<T>(value: unknown): T | null {
    if (!value) return null;
    if (typeof value === 'object') return value as T;
    if (typeof value !== 'string') return null;
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
}

export function toNumber(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function percentage(part: number, total: number): number {
    if (total <= 0) return 0;
    return Number(((part / total) * 100).toFixed(2));
}

export function calculatePagination(page: number, limit: number, total: number) {
    return {
        page,
        limit,
        total,
        total_pages: total > 0 ? Math.ceil(total / limit) : 0,
    };
}

export function pickAnalyticsFilters(filters: AnalyticsFilters) {
    return {
        date_from: filters.date_from ?? null,
        date_to: filters.date_to ?? null,
        region: filters.region ?? null,
        state: filters.state ?? null,
        city: filters.city ?? null,
        area: filters.area ?? null,
        company_id: filters.company_id ?? null,
        brand_id: filters.brand_id ?? null,
        product_id: filters.product_id ?? null,
        search: filters.search ?? null,
        statuses: filters.statuses ?? null,
    };
}
