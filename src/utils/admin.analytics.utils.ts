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

export function buildRegionCaseExpression(stateExpr: string): string {
    const clauses = Object.entries(INDIAN_REGION_BY_STATE)
        .map(([state, region]) => `WHEN ${stateExpr} = '${state}' THEN '${region}'`)
        .join(' ');
    return `CASE ${clauses} ELSE 'Unknown' END`;
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
