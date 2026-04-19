import { RowDataPacket } from 'mysql2';
import { BillStatus } from './bill.model.ts';

export const ANALYTICS_GEOGRAPHY_GROUPS = ['region', 'state', 'city', 'area'] as const;
export type AnalyticsGeographyGroup = typeof ANALYTICS_GEOGRAPHY_GROUPS[number];

export type AnalyticsFilters = {
    date_from?: string;
    date_to?: string;
    region?: string;
    state?: string;
    city?: string;
    area?: string;
    company_id?: number;
    brand_id?: number;
    product_id?: number;
    search?: string;
    page: number;
    limit: number;
    statuses?: BillStatus[];
};

export type GeographyDistributionFilters = AnalyticsFilters & {
    group_by: AnalyticsGeographyGroup;
};

export type DrilldownFilters = AnalyticsFilters & {
    company_id?: number;
    brand_id?: number;
    product_id?: number;
};

export type AnalyticsFilterSummary = {
    date_from: string | null;
    date_to: string | null;
    region: string | null;
    state: string | null;
    city: string | null;
    area: string | null;
    company_id: number | null;
    brand_id: number | null;
    product_id: number | null;
    search: string | null;
    statuses: BillStatus[] | null;
};

export type PaginationMeta = {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
};

export type AnalyticsListResponse<T> = {
    filters: AnalyticsFilterSummary;
    rows: T[];
    pagination: PaginationMeta;
};

export type DailyUploadStat = {
    period_label: string;
    uploads_count: number;
    verified_count: number;
    rejected_count: number;
    pending_count: number;
};

export type CompanyDistributionRow = {
    company_id: number | null;
    company_name: string;
    bill_count: number;
    item_scan_count: number;
    total_quantity: number;
    total_sales_amount: number;
    share_pct: number;
};

export type BrandDistributionRow = {
    brand_id: number | null;
    brand_name: string;
    scan_count: number;
    total_quantity: number;
    total_sales_amount: number;
    company_count: number;
    product_count: number;
    share_pct: number;
};

export type ProductDistributionRow = {
    product_id: number | null;
    product_name: string;
    brand_name: string | null;
    category_l1: string | null;
    scan_count: number;
    total_quantity: number;
    total_sales_amount: number;
    company_count: number;
};

export type CategoryInsightRow = {
    category_l1: string;
    scan_count: number;
    total_quantity: number;
    total_sales_amount: number;
    product_count: number;
    brand_count: number;
};

export type SalesTrendPoint = {
    period: string;
    actual_revenue: number;
    bill_count: number;
    item_scan_count: number;
    active_users: number;
};

export type UserActivityPoint = {
    period: string;
    active_users: number;
    uploading_users: number;
    avg_uploads_per_user: number;
};

export type GeographyDistributionRow = {
    geography_label: string;
    bill_count: number;
    item_scan_count: number;
    total_quantity: number;
    total_sales_amount: number;
    company_count: number;
    brand_count: number;
    product_count: number;
};

export type ItemScanRow = {
    bill_item_id: number;
    bill_id: number;
    user_id: number;
    company_id: number | null;
    company_name: string;
    brand_id: number | null;
    brand_name: string | null;
    product_id: number | null;
    product_name: string | null;
    product_name_raw: string;
    category_l1: string | null;
    quantity: number | null;
    unit_price: number | null;
    line_amount: number;
    city: string | null;
    area: string | null;
    bill_date: string | null;
    bill_status: BillStatus;
};

export type DrilldownRow = {
    id: number | null;
    name: string;
    bill_count: number;
    scan_count: number;
    total_quantity: number;
    total_sales_amount: number;
};

export type AdminAnalyticsDashboardView = {
    filters: AnalyticsFilterSummary;
    bill_analytics: {
        total_bills_uploaded: number;
        valid_bills_count: number;
        invalid_bills_count: number;
        valid_bills_pct: number;
        invalid_bills_pct: number;
        pending_bills_count: number;
        daily_upload_statistics: DailyUploadStat[];
    };
    brand_analytics: {
        company_purchase_analysis: CompanyDistributionRow[];
        top_performing_brands: BrandDistributionRow[];
        sales_trends: SalesTrendPoint[];
    };
    product_analytics: {
        product_frequency_analysis: ProductDistributionRow[];
        category_wise_insights: CategoryInsightRow[];
    };
    graphical_insights: {
        realtime_dashboard: {
            uploads_last_24h: number;
            verified_last_24h: number;
            sales_last_24h: number;
            active_users_last_7d: number;
        };
        sales_trends: SalesTrendPoint[];
        user_activity_graphs: UserActivityPoint[];
    };
};

export interface AdminAnalyticsCountRow extends RowDataPacket {
    total: number | null;
}

export interface AdminAnalyticsTotalSalesRow extends RowDataPacket {
    total_sales_amount: number | null;
}

export interface AdminAnalyticsDashboardBillRow extends RowDataPacket {
    total_bills_uploaded: number | null;
    valid_bills_count: number | null;
    invalid_bills_count: number | null;
    pending_bills_count: number | null;
}

export interface AdminAnalyticsDailyUploadRow extends RowDataPacket {
    period_label: string;
    uploads_count: number | null;
    verified_count: number | null;
    rejected_count: number | null;
    pending_count: number | null;
}

export interface AdminAnalyticsCompanyDistributionDbRow extends RowDataPacket {
    company_id: number | string | null;
    company_name: string;
    bill_count: number | null;
    item_scan_count: number | null;
    total_quantity: number | null;
    total_sales_amount: number | null;
}

export interface AdminAnalyticsBrandDistributionDbRow extends RowDataPacket {
    brand_id: number | string | null;
    brand_name: string;
    scan_count: number | null;
    total_quantity: number | null;
    total_sales_amount: number | null;
    company_count: number | null;
    product_count: number | null;
}

export interface AdminAnalyticsProductDistributionDbRow extends RowDataPacket {
    product_id: number | string | null;
    product_name: string;
    brand_name: string | null;
    category_l1: string | null;
    scan_count: number | null;
    total_quantity: number | null;
    total_sales_amount: number | null;
    company_count: number | null;
}

export interface AdminAnalyticsCategoryInsightDbRow extends RowDataPacket {
    category_l1: string;
    scan_count: number | null;
    total_quantity: number | null;
    total_sales_amount: number | null;
    product_count: number | null;
    brand_count: number | null;
}

export interface AdminAnalyticsSalesTrendDbRow extends RowDataPacket {
    period: string;
    actual_revenue: number | null;
    bill_count: number | null;
    item_scan_count: number | null;
    active_users: number | null;
}

export interface AdminAnalyticsRealtimeBillRow extends RowDataPacket {
    uploads_last_24h: number | null;
    verified_last_24h: number | null;
    active_users_last_7d: number | null;
}

export interface AdminAnalyticsRealtimeItemRow extends RowDataPacket {
    sales_last_24h: number | null;
}

export interface AdminAnalyticsUserActivityDbRow extends RowDataPacket {
    period: string;
    active_users: number | null;
    uploading_users: number | null;
    avg_uploads_per_user: number | null;
}

export interface AdminAnalyticsGeographyDistributionDbRow extends RowDataPacket {
    geography_label: string;
    bill_count: number | null;
    item_scan_count: number | null;
    total_quantity: number | null;
    total_sales_amount: number | null;
    company_count: number | null;
    brand_count: number | null;
    product_count: number | null;
}

export interface AdminAnalyticsItemScanDbRow extends RowDataPacket {
    bill_item_id: number | string;
    bill_id: number;
    user_id: number;
    company_id: number | string | null;
    company_name: string;
    brand_id: number | string | null;
    brand_name: string | null;
    product_id: number | string | null;
    product_name: string | null;
    product_name_raw: string;
    category_l1: string | null;
    quantity: number | null;
    unit_price: number | null;
    line_amount: number | null;
    city: string | null;
    area: string | null;
    bill_date: string | null;
    bill_status: BillStatus;
}

export interface AdminAnalyticsDrilldownDbRow extends RowDataPacket {
    id: number | string | null;
    name: string;
    bill_count: number | null;
    scan_count: number | null;
    total_quantity: number | null;
    total_sales_amount: number | null;
}

// ── Fraud stats ───────────────────────────────────────────────────────────────

export type FraudStatsView = {
    total_bills:        number;
    high_risk:          number;
    medium_risk:        number;
    low_risk:           number;
    review_queue_count: number;
    avg_high_score:     number;
    high_pct:           number;
    medium_pct:         number;
    low_pct:            number;
    safe_pct:           number;
};

// ── Reports summary ───────────────────────────────────────────────────────────

export type ReportsSummaryView = {
    bill_analytics: {
        total_bills_uploaded: number;
        valid_bills_count:    number;
        invalid_bills_count:  number;
        valid_bills_pct:      number;
        invalid_bills_pct:    number;
    };
    cashback_ledger: {
        total_credited:  number;
        total_debited:   number;
        net_outstanding: number;
    };
    referral_programme: {
        total_referrals:     number;
        total_coins_awarded: number;
    };
    active_users_7d: number;
};

