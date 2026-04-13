import { RowDataPacket } from 'mysql2';
import { BillStatus } from './bill.model.ts';

export const ANALYTICS_COMPANY_TABLE = 'analytics_companies';
export const ANALYTICS_BRAND_TABLE = 'analytics_brands';
export const ANALYTICS_PRODUCT_TABLE = 'analytics_products';
export const BILL_ITEMS_TABLE = 'bill_items';

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

export type UpsertCompanyInput = {
    platform: string | null;
    merchant_name: string | null;
};

export type UpsertProductInput = {
    raw_name: string;
    normalized_name: string;
    brand_id: number | null;
    brand_name: string | null;
    category_l1: string | null;
    category_l2: string | null;
    unit_type: string | null;
    pack_size: string | null;
};

export type BillAnalyticsSnapshot = {
    company_id: number | null;
    merchant_name: string | null;
    region: string | null;
    state: string | null;
    city: string | null;
    area: string | null;
    postal_code: string | null;
};

export type SyncedBillItem = {
    company_id: number | null;
    brand_id: number | null;
    product_id: number | null;
    product_name_raw: string;
    product_name_normalized: string | null;
    category_l1: string | null;
    category_l2: string | null;
    quantity: number | null;
    unit_type: string | null;
    unit_price: number | null;
    line_amount: number;
    currency_code: string;
    city: string | null;
    area: string | null;
    bill_date: string | null;
};

export interface AnalyticsCompany extends RowDataPacket {
    id: number;
    platform_code: string;
    company_name: string;
    company_type: string | null;
    active_status: number;
}

export interface AnalyticsBrand extends RowDataPacket {
    id: number;
    brand_name: string;
}

export interface AnalyticsProduct extends RowDataPacket {
    id: number;
    product_key: string;
    product_name: string;
    normalized_name: string;
    brand_id: number | null;
    category_l1: string | null;
    category_l2: string | null;
    unit_type: string | null;
    pack_size: string | null;
}

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

export type PaginationMeta = {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
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
