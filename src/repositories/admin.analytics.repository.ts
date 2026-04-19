import { err, ok, Result } from 'neverthrow';
import { RowDataPacket } from 'mysql2';
import { db } from '../database/db.ts';
import {
    AdminAnalyticsDashboardView,
    AdminAnalyticsBrandDistributionDbRow,
    AdminAnalyticsCategoryInsightDbRow,
    AdminAnalyticsCompanyDistributionDbRow,
    AdminAnalyticsCountRow,
    AdminAnalyticsDailyUploadRow,
    AdminAnalyticsDashboardBillRow,
    AdminAnalyticsDrilldownDbRow,
    AnalyticsFilters,
    AnalyticsListResponse,
    BrandDistributionRow,
    CategoryInsightRow,
    CompanyDistributionRow,
    DailyUploadStat,
    DrilldownFilters,
    DrilldownRow,
    GeographyDistributionFilters,
    GeographyDistributionRow,
    AdminAnalyticsGeographyDistributionDbRow,
    ItemScanRow,
    ProductDistributionRow,
    SalesTrendPoint,
    AdminAnalyticsItemScanDbRow,
    AdminAnalyticsProductDistributionDbRow,
    AdminAnalyticsRealtimeBillRow,
    AdminAnalyticsRealtimeItemRow,
    AdminAnalyticsSalesTrendDbRow,
    AdminAnalyticsTotalSalesRow,
    AdminAnalyticsUserActivityDbRow,
    UserActivityPoint,
    FraudStatsView,
    ReportsSummaryView,
} from '../models/admin.analytics.model.ts';

export interface IAdminAnalyticsRepository {
    getDashboard(filters: AnalyticsFilters): Promise<Result<AdminAnalyticsDashboardView, RequestError>>;
    getCompanyDistribution(filters: AnalyticsFilters): Promise<Result<AnalyticsListResponse<CompanyDistributionRow>, RequestError>>;
    getBrandDistribution(filters: AnalyticsFilters): Promise<Result<AnalyticsListResponse<BrandDistributionRow>, RequestError>>;
    getProductDistribution(filters: AnalyticsFilters): Promise<Result<AnalyticsListResponse<ProductDistributionRow>, RequestError>>;
    getGeographyDistribution(filters: GeographyDistributionFilters): Promise<Result<AnalyticsListResponse<GeographyDistributionRow>, RequestError>>;
    getItemScans(filters: AnalyticsFilters): Promise<Result<AnalyticsListResponse<ItemScanRow>, RequestError>>;
    getCompanyProducts(companyId: number, filters: DrilldownFilters): Promise<Result<AnalyticsListResponse<DrilldownRow>, RequestError>>;
    getBrandProducts(brandId: number, filters: DrilldownFilters): Promise<Result<AnalyticsListResponse<DrilldownRow>, RequestError>>;
    getProductCompanies(productId: number, filters: DrilldownFilters): Promise<Result<AnalyticsListResponse<DrilldownRow>, RequestError>>;
    getFraudStats(): Promise<Result<FraudStatsView, RequestError>>;
    getReportsSummary(): Promise<Result<ReportsSummaryView, RequestError>>;
}
import { BillStatus } from '../models/bill.model.ts';
import {
    buildRegionCaseExpression,
    calculatePagination,
    percentage,
    pickAnalyticsFilters,
    toNumber,
} from '../utils/admin.analytics.utils.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('@admin.analytics.repository');

const DEFAULT_ANALYTICS_STATUSES: BillStatus[] = ['verified'];

type SqlParam = string | number;

function merchantNameExpr(billAlias = 'b'): string {
    return `NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(${billAlias}.extracted_data, '$.merchant_name'))), '')`;
}

function stateExpr(billAlias = 'b'): string {
    return `NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(${billAlias}.extracted_data, '$.delivery_state'))), '')`;
}

function cityExpr(billAlias = 'b'): string {
    return `NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(${billAlias}.extracted_data, '$.delivery_city'))), '')`;
}

function areaExpr(billAlias = 'b'): string {
    return `NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(${billAlias}.extracted_data, '$.delivery_area'))), '')`;
}

function regionExpr(billAlias = 'b'): string {
    return buildRegionCaseExpression(`LOWER(COALESCE(${stateExpr(billAlias)}, ''))`);
}

function billDateExpr(billAlias = 'b'): string {
    return `COALESCE(
        ${billAlias}.bill_date,
        STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(${billAlias}.extracted_data, '$.order_date')), '%Y-%m-%d'),
        DATE(${billAlias}.created_at)
    )`;
}

function companyNameExpr(billAlias = 'b'): string {
    return `CASE
        WHEN NULLIF(TRIM(${billAlias}.platform), '') IS NOT NULL
            THEN CONCAT(UPPER(LEFT(TRIM(${billAlias}.platform), 1)), SUBSTRING(LOWER(TRIM(${billAlias}.platform)), 2))
        ELSE COALESCE(${merchantNameExpr(billAlias)}, 'Unknown')
    END`;
}

function companyKeyExpr(billAlias = 'b'): string {
    return `LOWER(TRIM(COALESCE(NULLIF(${billAlias}.platform, ''), ${merchantNameExpr(billAlias)}, 'unknown')))`;
}

function brandNameExpr(itemAlias = 'jt'): string {
    return `COALESCE(NULLIF(TRIM(${itemAlias}.brand_name), ''), 'Unbranded')`;
}

function brandKeyExpr(itemAlias = 'jt'): string {
    return `LOWER(TRIM(COALESCE(NULLIF(${itemAlias}.brand_name, ''), 'Unbranded')))`;
}

function productNameExpr(itemAlias = 'jt'): string {
    return `COALESCE(NULLIF(TRIM(${itemAlias}.product_name_raw), ''), 'Unknown Product')`;
}

function productKeyExpr(itemAlias = 'jt'): string {
    return `LOWER(TRIM(CONCAT(COALESCE(NULLIF(${itemAlias}.brand_name, ''), 'unbranded'), '::', COALESCE(NULLIF(${itemAlias}.product_name_raw, ''), 'Unknown Product'))))`;
}

function categoryExpr(itemAlias = 'jt'): string {
    return `COALESCE(NULLIF(TRIM(${itemAlias}.category_l1), ''), 'Uncategorized')`;
}

function quantityExpr(itemAlias = 'jt'): string {
    return `COALESCE(${itemAlias}.quantity, 1)`;
}

function lineAmountExpr(itemAlias = 'jt'): string {
    return `COALESCE(
        ${itemAlias}.total_price,
        CASE
            WHEN ${itemAlias}.unit_price IS NOT NULL AND ${itemAlias}.quantity IS NOT NULL
                THEN ${itemAlias}.unit_price * ${itemAlias}.quantity
            ELSE 0
        END,
        0
    )`;
}

function dimensionIdExpr(keyExpr: string): string {
    return `CAST(CONV(SUBSTRING(SHA2(${keyExpr}, 256), 1, 12), 16, 10) AS UNSIGNED)`;
}

function companyIdExpr(billAlias = 'b'): string {
    return dimensionIdExpr(companyKeyExpr(billAlias));
}

function brandIdExpr(itemAlias = 'jt'): string {
    return dimensionIdExpr(brandKeyExpr(itemAlias));
}

function productIdExpr(itemAlias = 'jt'): string {
    return dimensionIdExpr(productKeyExpr(itemAlias));
}

function itemScanIdExpr(billAlias = 'b', itemAlias = 'jt'): string {
    return dimensionIdExpr(`CONCAT(${billAlias}.id, ':', ${itemAlias}.item_index)`);
}

function itemsTableExpr(billAlias = 'b', itemAlias = 'jt'): string {
    return `JSON_TABLE(
        COALESCE(JSON_EXTRACT(${billAlias}.extracted_data, '$.items'), JSON_ARRAY()),
        '$[*]' COLUMNS (
            item_index FOR ORDINALITY,
            product_name_raw VARCHAR(255) PATH '$.name' NULL ON EMPTY,
            brand_name VARCHAR(255) PATH '$.brand' NULL ON EMPTY,
            category_l1 VARCHAR(100) PATH '$.category' NULL ON EMPTY,
            quantity DECIMAL(10, 2) PATH '$.quantity' NULL ON EMPTY,
            unit_price DECIMAL(10, 2) PATH '$.unit_price' NULL ON EMPTY,
            total_price DECIMAL(10, 2) PATH '$.total_price' NULL ON EMPTY
        )
    ) ${itemAlias}`;
}

function itemsJoin(billAlias = 'b', itemAlias = 'jt'): string {
    return `
        INNER JOIN ${itemsTableExpr(billAlias, itemAlias)}
    `;
}

function whereClause(conditions: string[]): string {
    return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

// Reuse the same date/location/status filters across both bill-level and item-level analytics queries.
function appendCommonBillConditions(
    filters: AnalyticsFilters,
    params: SqlParam[],
    conditions: string[],
    defaultStatuses?: BillStatus[]
): void {
    if (filters.date_from) {
        conditions.push(`${billDateExpr()} >= ?`);
        params.push(filters.date_from);
    }
    if (filters.date_to) {
        conditions.push(`${billDateExpr()} <= ?`);
        params.push(filters.date_to);
    }
    if (filters.region) {
        conditions.push(`${regionExpr()} = ?`);
        params.push(filters.region);
    }
    if (filters.state) {
        conditions.push(`${stateExpr()} = ?`);
        params.push(filters.state);
    }
    if (filters.city) {
        conditions.push(`${cityExpr()} = ?`);
        params.push(filters.city);
    }
    if (filters.area) {
        conditions.push(`${areaExpr()} = ?`);
        params.push(filters.area);
    }

    const statuses = filters.statuses && filters.statuses.length > 0
        ? filters.statuses
        : defaultStatuses;
    if (statuses && statuses.length > 0) {
        conditions.push(`b.status IN (${statuses.map(() => '?').join(', ')})`);
        params.push(...statuses);
    }
}

// Bill-level queries aggregate from bills first.
// Brand/product filters therefore use EXISTS against extracted item rows.
function buildBillLevelConditions(
    filters: AnalyticsFilters,
    params: SqlParam[],
    includeDimensionFilters = false,
    defaultStatuses?: BillStatus[]
): string[] {
    const conditions: string[] = [];
    appendCommonBillConditions(filters, params, conditions, defaultStatuses);

    if (!includeDimensionFilters) {
        return conditions;
    }

    if (filters.company_id) {
        conditions.push(`${companyIdExpr()} = ?`);
        params.push(filters.company_id);
    }
    if (filters.brand_id) {
        conditions.push(`
            EXISTS (
                SELECT 1
                FROM ${itemsTableExpr('b', 'jt_filter')}
                WHERE ${brandIdExpr('jt_filter')} = ?
            )
        `);
        params.push(filters.brand_id);
    }
    if (filters.product_id) {
        conditions.push(`
            EXISTS (
                SELECT 1
                FROM ${itemsTableExpr('b', 'jt_filter')}
                WHERE ${productIdExpr('jt_filter')} = ?
            )
        `);
        params.push(filters.product_id);
    }

    return conditions;
}

// Item-level queries already join extracted item rows,
// so brand/product/search filters apply directly on the joined dataset.
function buildItemLevelConditions(
    filters: AnalyticsFilters,
    params: SqlParam[],
    defaultStatuses?: BillStatus[],
    searchColumns: string[] = []
): string[] {
    const conditions: string[] = [];
    appendCommonBillConditions(filters, params, conditions, defaultStatuses);

    if (filters.company_id) {
        conditions.push(`${companyIdExpr()} = ?`);
        params.push(filters.company_id);
    }
    if (filters.brand_id) {
        conditions.push(`${brandIdExpr()} = ?`);
        params.push(filters.brand_id);
    }
    if (filters.product_id) {
        conditions.push(`${productIdExpr()} = ?`);
        params.push(filters.product_id);
    }
    if (filters.search && searchColumns.length > 0) {
        const like = `%${filters.search}%`;
        conditions.push(`(${searchColumns.map((column) => `${column} LIKE ?`).join(' OR ')})`);
        for (let index = 0; index < searchColumns.length; index++) {
            params.push(like);
        }
    }

    return conditions;
}

function buildAnalyticsList<T>(filters: AnalyticsFilters, rows: T[], pagination: AnalyticsListResponse<T>['pagination']): AnalyticsListResponse<T> {
    return {
        filters: pickAnalyticsFilters(filters),
        rows,
        pagination,
    };
}

class AdminAnalyticsRepositoryImpl implements IAdminAnalyticsRepository {
    async getDashboard(filters: AnalyticsFilters): Promise<Result<AdminAnalyticsDashboardView, RequestError>> {
        try {
            const billParams: SqlParam[] = [];
            const billWhere = whereClause(
                    buildBillLevelConditions(filters, billParams, true)
                );

            const [billRows] = await db.query<AdminAnalyticsDashboardBillRow[]>(
                `SELECT
                    COUNT(*) AS total_bills_uploaded,
                    SUM(CASE WHEN b.status = 'verified' THEN 1 ELSE 0 END) AS valid_bills_count,
                    SUM(CASE WHEN b.status IN ('rejected', 'failed') THEN 1 ELSE 0 END) AS invalid_bills_count,
                    SUM(CASE WHEN b.status = 'pending' THEN 1 ELSE 0 END) AS pending_bills_count
                 FROM bills b
                 ${billWhere}`,
                billParams
            );

            const [dailyRows] = await db.query<AdminAnalyticsDailyUploadRow[]>(
                `SELECT
                    DATE(b.created_at) AS period_label,
                    COUNT(*) AS uploads_count,
                    SUM(CASE WHEN b.status = 'verified' THEN 1 ELSE 0 END) AS verified_count,
                    SUM(CASE WHEN b.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
                    SUM(CASE WHEN b.status = 'pending' THEN 1 ELSE 0 END) AS pending_count
                 FROM bills b
                 ${billWhere}
                 GROUP BY DATE(b.created_at)
                 ORDER BY DATE(b.created_at) ASC
                 LIMIT 30`,
                billParams
            );

            const companyDistributionResult = await this.getCompanyDistribution({
                ...filters,
                page: 1,
                limit: 10,
            });
            if (companyDistributionResult.isErr()) return err(companyDistributionResult.error);

            const brandDistributionResult = await this.getBrandDistribution({
                ...filters,
                page: 1,
                limit: 10,
            });
            if (brandDistributionResult.isErr()) return err(brandDistributionResult.error);

            const productDistributionResult = await this.getProductDistribution({
                ...filters,
                page: 1,
                limit: 10,
            });
            if (productDistributionResult.isErr()) return err(productDistributionResult.error);

            const itemParams: SqlParam[] = [];
            const itemWhere = whereClause(
                    buildItemLevelConditions(filters, itemParams, DEFAULT_ANALYTICS_STATUSES)
                );

            const [categoryRows] = await db.query<AdminAnalyticsCategoryInsightDbRow[]>(
                `SELECT
                    ${categoryExpr()} AS category_l1,
                    COUNT(*) AS scan_count,
                    COALESCE(SUM(${quantityExpr()}), 0) AS total_quantity,
                    COALESCE(SUM(${lineAmountExpr()}), 0) AS total_sales_amount,
                    COUNT(DISTINCT ${productIdExpr()}) AS product_count,
                    COUNT(DISTINCT ${brandIdExpr()}) AS brand_count
                 FROM bills b
                 ${itemsJoin()}
                 ${itemWhere}
                 GROUP BY ${categoryExpr()}
                 ORDER BY total_sales_amount DESC
                 LIMIT 10`,
                itemParams
            );

            const [trendRows] = await db.query<AdminAnalyticsSalesTrendDbRow[]>(
                `SELECT
                    DATE(b.created_at) AS period,
                    COALESCE(SUM(${lineAmountExpr()}), 0) AS actual_revenue,
                    COUNT(DISTINCT b.id) AS bill_count,
                    COUNT(*) AS item_scan_count,
                    COUNT(DISTINCT b.user_id) AS active_users
                 FROM bills b
                 ${itemsJoin()}
                 ${itemWhere}
                 GROUP BY DATE(b.created_at)
                 ORDER BY DATE(b.created_at) ASC
                 LIMIT 30`,
                itemParams
            );

            const realtimeBillParams: SqlParam[] = [];
            const realtimeBillWhere = whereClause(
                    buildBillLevelConditions(filters, realtimeBillParams, true)
                );

            const [realtimeBillRows] = await db.query<AdminAnalyticsRealtimeBillRow[]>(
                `SELECT
                    SUM(CASE WHEN b.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) AS uploads_last_24h,
                    SUM(CASE WHEN b.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND b.status = 'verified' THEN 1 ELSE 0 END) AS verified_last_24h,
                    COUNT(DISTINCT CASE WHEN b.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN b.user_id END) AS active_users_last_7d
                 FROM bills b
                 ${realtimeBillWhere}`,
                realtimeBillParams
            );

            const realtimeItemParams: SqlParam[] = [];
            const realtimeItemConditions = buildItemLevelConditions(filters, realtimeItemParams, DEFAULT_ANALYTICS_STATUSES);
            realtimeItemConditions.push(`b.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`);
            const realtimeItemWhere = whereClause(realtimeItemConditions);

            const [realtimeItemRows] = await db.query<AdminAnalyticsRealtimeItemRow[]>(
                `SELECT COALESCE(SUM(${lineAmountExpr()}), 0) AS sales_last_24h
                 FROM bills b
                 ${itemsJoin()}
                 ${realtimeItemWhere}`,
                realtimeItemParams
            );

            const [userActivityRows] = await db.query<AdminAnalyticsUserActivityDbRow[]>(
                `SELECT
                    DATE(b.created_at) AS period,
                    COUNT(DISTINCT b.user_id) AS active_users,
                    COUNT(DISTINCT b.user_id) AS uploading_users,
                    ROUND(COUNT(*) / NULLIF(COUNT(DISTINCT b.user_id), 0), 2) AS avg_uploads_per_user
                 FROM bills b
                 ${billWhere}
                 GROUP BY DATE(b.created_at)
                 ORDER BY DATE(b.created_at) ASC
                 LIMIT 30`,
                billParams
            );

            const billSummary = billRows[0] ?? ({} as AdminAnalyticsDashboardBillRow);
            const totalBills = toNumber(billSummary.total_bills_uploaded);
            const validBills = toNumber(billSummary.valid_bills_count);
            const invalidBills = toNumber(billSummary.invalid_bills_count);
            const salesTrendPoints = trendRows.map<SalesTrendPoint>((row) => ({
                period: row.period,
                actual_revenue: toNumber(row.actual_revenue),
                bill_count: toNumber(row.bill_count),
                item_scan_count: toNumber(row.item_scan_count),
                active_users: toNumber(row.active_users),
            }));

            return ok({
                filters: pickAnalyticsFilters(filters),
                bill_analytics: {
                    total_bills_uploaded: totalBills,
                    valid_bills_count: validBills,
                    invalid_bills_count: invalidBills,
                    valid_bills_pct: percentage(validBills, totalBills),
                    invalid_bills_pct: percentage(invalidBills, totalBills),
                    pending_bills_count: toNumber(billSummary.pending_bills_count),
                    daily_upload_statistics: dailyRows.map<DailyUploadStat>((row) => ({
                        period_label: row.period_label,
                        uploads_count: toNumber(row.uploads_count),
                        verified_count: toNumber(row.verified_count),
                        rejected_count: toNumber(row.rejected_count),
                        pending_count: toNumber(row.pending_count),
                    })),
                },
                brand_analytics: {
                    company_purchase_analysis: companyDistributionResult.value.rows,
                    top_performing_brands: brandDistributionResult.value.rows,
                    sales_trends: salesTrendPoints,
                },
                product_analytics: {
                    product_frequency_analysis: productDistributionResult.value.rows,
                    category_wise_insights: categoryRows.map<CategoryInsightRow>((row) => ({
                        category_l1: row.category_l1,
                        scan_count: toNumber(row.scan_count),
                        total_quantity: toNumber(row.total_quantity),
                        total_sales_amount: toNumber(row.total_sales_amount),
                        product_count: toNumber(row.product_count),
                        brand_count: toNumber(row.brand_count),
                    })),
                },
                graphical_insights: {
                    realtime_dashboard: {
                        uploads_last_24h: toNumber(realtimeBillRows[0]?.uploads_last_24h),
                        verified_last_24h: toNumber(realtimeBillRows[0]?.verified_last_24h),
                        sales_last_24h: toNumber(realtimeItemRows[0]?.sales_last_24h),
                        active_users_last_7d: toNumber(realtimeBillRows[0]?.active_users_last_7d),
                    },
                    sales_trends: salesTrendPoints,
                    user_activity_graphs: userActivityRows.map<UserActivityPoint>((row) => ({
                        period: row.period,
                        active_users: toNumber(row.active_users),
                        uploading_users: toNumber(row.uploading_users),
                        avg_uploads_per_user: toNumber(row.avg_uploads_per_user),
                    })),
                },
            });
        } catch (error) {
            logger.error('Error fetching admin analytics dashboard', error as Error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getCompanyDistribution(
        filters: AnalyticsFilters
    ): Promise<Result<AnalyticsListResponse<CompanyDistributionRow>, RequestError>> {
        try {
            const params: SqlParam[] = [];
            const conditions = buildItemLevelConditions(
                filters,
                params,
                DEFAULT_ANALYTICS_STATUSES,
                ['CAST(b.id AS CHAR)', companyNameExpr(), brandNameExpr(), productNameExpr()]
            );
            const baseQuery = `
                SELECT
                    ${companyIdExpr()} AS company_id,
                    ${companyNameExpr()} AS company_name,
                    COUNT(DISTINCT b.id) AS bill_count,
                    COUNT(*) AS item_scan_count,
                    COALESCE(SUM(${quantityExpr()}), 0) AS total_quantity,
                    COALESCE(SUM(${lineAmountExpr()}), 0) AS total_sales_amount
                FROM bills b
                ${itemsJoin()}
                ${whereClause(conditions)}
                GROUP BY ${companyIdExpr()}, ${companyNameExpr()}
            `;

            const rows = await this.runPagedQuery<AdminAnalyticsCompanyDistributionDbRow>(baseQuery, params, filters, 'ORDER BY total_sales_amount DESC, item_scan_count DESC');
            const total = await this.countGroupedRows(baseQuery, params);
            const totalSales = await this.sumGroupedSales(baseQuery, params);

            return ok(buildAnalyticsList(
                filters,
                rows.map<CompanyDistributionRow>((row) => ({
                    company_id: row.company_id !== null ? Number(row.company_id) : null,
                    company_name: row.company_name,
                    bill_count: toNumber(row.bill_count),
                    item_scan_count: toNumber(row.item_scan_count),
                    total_quantity: toNumber(row.total_quantity),
                    total_sales_amount: toNumber(row.total_sales_amount),
                    share_pct: percentage(toNumber(row.total_sales_amount), totalSales),
                })),
                calculatePagination(filters.page, filters.limit, total)
            ));
        } catch (error) {
            logger.error('Error fetching company distribution', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getBrandDistribution(
        filters: AnalyticsFilters
    ): Promise<Result<AnalyticsListResponse<BrandDistributionRow>, RequestError>> {
        try {
            const params: SqlParam[] = [];
            const conditions = buildItemLevelConditions(
                filters,
                params,
                DEFAULT_ANALYTICS_STATUSES,
                ['CAST(b.id AS CHAR)', companyNameExpr(), brandNameExpr(), productNameExpr()]
            );
            const baseQuery = `
                SELECT
                    ${brandIdExpr()} AS brand_id,
                    ${brandNameExpr()} AS brand_name,
                    COUNT(*) AS scan_count,
                    COALESCE(SUM(${quantityExpr()}), 0) AS total_quantity,
                    COALESCE(SUM(${lineAmountExpr()}), 0) AS total_sales_amount,
                    COUNT(DISTINCT ${companyIdExpr()}) AS company_count,
                    COUNT(DISTINCT ${productIdExpr()}) AS product_count
                FROM bills b
                ${itemsJoin()}
                ${whereClause(conditions)}
                GROUP BY ${brandIdExpr()}, ${brandNameExpr()}
            `;

            const rows = await this.runPagedQuery<AdminAnalyticsBrandDistributionDbRow>(baseQuery, params, filters, 'ORDER BY total_sales_amount DESC, scan_count DESC');
            const total = await this.countGroupedRows(baseQuery, params);
            const totalSales = await this.sumGroupedSales(baseQuery, params);

            return ok(buildAnalyticsList(
                filters,
                rows.map<BrandDistributionRow>((row) => ({
                    brand_id: row.brand_id !== null ? Number(row.brand_id) : null,
                    brand_name: row.brand_name,
                    scan_count: toNumber(row.scan_count),
                    total_quantity: toNumber(row.total_quantity),
                    total_sales_amount: toNumber(row.total_sales_amount),
                    company_count: toNumber(row.company_count),
                    product_count: toNumber(row.product_count),
                    share_pct: percentage(toNumber(row.total_sales_amount), totalSales),
                })),
                calculatePagination(filters.page, filters.limit, total)
            ));
        } catch (error) {
            logger.error('Error fetching brand distribution', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getProductDistribution(
        filters: AnalyticsFilters
    ): Promise<Result<AnalyticsListResponse<ProductDistributionRow>, RequestError>> {
        try {
            const params: SqlParam[] = [];
            const conditions = buildItemLevelConditions(
                filters,
                params,
                DEFAULT_ANALYTICS_STATUSES,
                ['CAST(b.id AS CHAR)', companyNameExpr(), brandNameExpr(), productNameExpr()]
            );
            const baseQuery = `
                SELECT
                    ${productIdExpr()} AS product_id,
                    ${productNameExpr()} AS product_name,
                    ${brandNameExpr()} AS brand_name,
                    ${categoryExpr()} AS category_l1,
                    COUNT(*) AS scan_count,
                    COALESCE(SUM(${quantityExpr()}), 0) AS total_quantity,
                    COALESCE(SUM(${lineAmountExpr()}), 0) AS total_sales_amount,
                    COUNT(DISTINCT ${companyIdExpr()}) AS company_count
                FROM bills b
                ${itemsJoin()}
                ${whereClause(conditions)}
                GROUP BY ${productIdExpr()}, ${productNameExpr()}, ${brandNameExpr()}, ${categoryExpr()}
            `;

            const rows = await this.runPagedQuery<AdminAnalyticsProductDistributionDbRow>(baseQuery, params, filters, 'ORDER BY scan_count DESC, total_sales_amount DESC');
            const total = await this.countGroupedRows(baseQuery, params);

            return ok(buildAnalyticsList(
                filters,
                rows.map<ProductDistributionRow>((row) => ({
                    product_id: row.product_id !== null ? Number(row.product_id) : null,
                    product_name: row.product_name,
                    brand_name: row.brand_name ?? null,
                    category_l1: row.category_l1 ?? null,
                    scan_count: toNumber(row.scan_count),
                    total_quantity: toNumber(row.total_quantity),
                    total_sales_amount: toNumber(row.total_sales_amount),
                    company_count: toNumber(row.company_count),
                })),
                calculatePagination(filters.page, filters.limit, total)
            ));
        } catch (error) {
            logger.error('Error fetching product distribution', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getGeographyDistribution(
        filters: GeographyDistributionFilters
    ): Promise<Result<AnalyticsListResponse<GeographyDistributionRow>, RequestError>> {
        try {
            const geographyMap: Record<GeographyDistributionFilters['group_by'], string> = {
                region: regionExpr(),
                state: `COALESCE(${stateExpr()}, 'Unknown')`,
                city: `COALESCE(${cityExpr()}, 'Unknown')`,
                area: `COALESCE(${areaExpr()}, 'Unknown')`,
            };
            const geographyLabelExpr = geographyMap[filters.group_by];

            const params: SqlParam[] = [];
            const conditions = buildItemLevelConditions(filters, params, DEFAULT_ANALYTICS_STATUSES);
            const baseQuery = `
                SELECT
                    ${geographyLabelExpr} AS geography_label,
                    COUNT(DISTINCT b.id) AS bill_count,
                    COUNT(*) AS item_scan_count,
                    COALESCE(SUM(${quantityExpr()}), 0) AS total_quantity,
                    COALESCE(SUM(${lineAmountExpr()}), 0) AS total_sales_amount,
                    COUNT(DISTINCT ${companyIdExpr()}) AS company_count,
                    COUNT(DISTINCT ${brandIdExpr()}) AS brand_count,
                    COUNT(DISTINCT ${productIdExpr()}) AS product_count
                FROM bills b
                ${itemsJoin()}
                ${whereClause(conditions)}
                GROUP BY ${geographyLabelExpr}
            `;

            const rows = await this.runPagedQuery<AdminAnalyticsGeographyDistributionDbRow>(baseQuery, params, filters, 'ORDER BY total_sales_amount DESC, item_scan_count DESC');
            const total = await this.countGroupedRows(baseQuery, params);

            return ok(buildAnalyticsList(
                filters,
                rows.map<GeographyDistributionRow>((row) => ({
                    geography_label: row.geography_label,
                    bill_count: toNumber(row.bill_count),
                    item_scan_count: toNumber(row.item_scan_count),
                    total_quantity: toNumber(row.total_quantity),
                    total_sales_amount: toNumber(row.total_sales_amount),
                    company_count: toNumber(row.company_count),
                    brand_count: toNumber(row.brand_count),
                    product_count: toNumber(row.product_count),
                })),
                calculatePagination(filters.page, filters.limit, total)
            ));
        } catch (error) {
            logger.error('Error fetching geography distribution', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getItemScans(
        filters: AnalyticsFilters
    ): Promise<Result<AnalyticsListResponse<ItemScanRow>, RequestError>> {
        try {
            const params: SqlParam[] = [];
            const conditions = buildItemLevelConditions(
                filters,
                params,
                DEFAULT_ANALYTICS_STATUSES,
                ['CAST(b.id AS CHAR)', companyNameExpr(), brandNameExpr(), productNameExpr()]
            );
            const baseQuery = `
                SELECT
                    ${itemScanIdExpr()} AS bill_item_id,
                    b.id AS bill_id,
                    b.user_id AS user_id,
                    ${companyIdExpr()} AS company_id,
                    ${companyNameExpr()} AS company_name,
                    ${brandIdExpr()} AS brand_id,
                    ${brandNameExpr()} AS brand_name,
                    ${productIdExpr()} AS product_id,
                    ${productNameExpr()} AS product_name,
                    ${productNameExpr()} AS product_name_raw,
                    ${categoryExpr()} AS category_l1,
                    jt.quantity AS quantity,
                    jt.unit_price AS unit_price,
                    ${lineAmountExpr()} AS line_amount,
                    ${cityExpr()} AS city,
                    ${areaExpr()} AS area,
                    DATE_FORMAT(${billDateExpr()}, '%Y-%m-%d') AS bill_date,
                    b.status AS bill_status
                FROM bills b
                ${itemsJoin()}
                ${whereClause(conditions)}
            `;

            const rows = await this.runPagedQuery<AdminAnalyticsItemScanDbRow>(
                baseQuery,
                params,
                filters,
                `ORDER BY ${billDateExpr()} DESC, b.id DESC, jt.item_index DESC`
            );
            const total = await this.countGroupedRows(`SELECT 1 AS total_marker FROM (${baseQuery}) item_scans`, params);

            return ok(buildAnalyticsList(
                filters,
                rows.map<ItemScanRow>((row) => ({
                    bill_item_id: Number(row.bill_item_id),
                    bill_id: Number(row.bill_id),
                    user_id: Number(row.user_id),
                    company_id: row.company_id !== null ? Number(row.company_id) : null,
                    company_name: row.company_name,
                    brand_id: row.brand_id !== null ? Number(row.brand_id) : null,
                    brand_name: row.brand_name ?? null,
                    product_id: row.product_id !== null ? Number(row.product_id) : null,
                    product_name: row.product_name ?? null,
                    product_name_raw: row.product_name_raw,
                    category_l1: row.category_l1 ?? null,
                    quantity: row.quantity !== null ? Number(row.quantity) : null,
                    unit_price: row.unit_price !== null ? Number(row.unit_price) : null,
                    line_amount: toNumber(row.line_amount),
                    city: row.city ?? null,
                    area: row.area ?? null,
                    bill_date: row.bill_date ?? null,
                    bill_status: row.bill_status,
                })),
                calculatePagination(filters.page, filters.limit, total)
            ));
        } catch (error) {
            logger.error('Error fetching item scans', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getCompanyProducts(
        companyId: number,
        filters: DrilldownFilters
    ): Promise<Result<AnalyticsListResponse<DrilldownRow>, RequestError>> {
        return this.getDrilldownRows(
            { ...filters, company_id: companyId },
            productIdExpr(),
            productNameExpr(),
            ['CAST(b.id AS CHAR)', brandNameExpr(), productNameExpr()]
        );
    }

    async getBrandProducts(
        brandId: number,
        filters: DrilldownFilters
    ): Promise<Result<AnalyticsListResponse<DrilldownRow>, RequestError>> {
        return this.getDrilldownRows(
            { ...filters, brand_id: brandId },
            productIdExpr(),
            productNameExpr(),
            ['CAST(b.id AS CHAR)', brandNameExpr(), productNameExpr()]
        );
    }

    async getProductCompanies(
        productId: number,
        filters: DrilldownFilters
    ): Promise<Result<AnalyticsListResponse<DrilldownRow>, RequestError>> {
        return this.getDrilldownRows(
            { ...filters, product_id: productId },
            companyIdExpr(),
            companyNameExpr(),
            ['CAST(b.id AS CHAR)', companyNameExpr()]
        );
    }

    private async getDrilldownRows(
        filters: DrilldownFilters,
        idExpr: string,
        nameExpr: string,
        searchColumns: string[]
    ): Promise<Result<AnalyticsListResponse<DrilldownRow>, RequestError>> {
        try {
            const params: SqlParam[] = [];
            const conditions = buildItemLevelConditions(filters, params, DEFAULT_ANALYTICS_STATUSES, searchColumns);
            const baseQuery = `
                SELECT
                    ${idExpr} AS id,
                    ${nameExpr} AS name,
                    COUNT(DISTINCT b.id) AS bill_count,
                    COUNT(*) AS scan_count,
                    COALESCE(SUM(${quantityExpr()}), 0) AS total_quantity,
                    COALESCE(SUM(${lineAmountExpr()}), 0) AS total_sales_amount
                FROM bills b
                ${itemsJoin()}
                ${whereClause(conditions)}
                GROUP BY ${idExpr}, ${nameExpr}
            `;

            const rows = await this.runPagedQuery<AdminAnalyticsDrilldownDbRow>(baseQuery, params, filters, 'ORDER BY total_sales_amount DESC, scan_count DESC');
            const total = await this.countGroupedRows(baseQuery, params);

            return ok(buildAnalyticsList(
                filters,
                rows.map<DrilldownRow>((row) => ({
                    id: row.id !== null ? Number(row.id) : null,
                    name: row.name,
                    bill_count: toNumber(row.bill_count),
                    scan_count: toNumber(row.scan_count),
                    total_quantity: toNumber(row.total_quantity),
                    total_sales_amount: toNumber(row.total_sales_amount),
                })),
                calculatePagination(filters.page, filters.limit, total)
            ));
        } catch (error) {
            logger.error('Error fetching analytics drilldown', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    private async runPagedQuery<T extends RowDataPacket>(
        baseQuery: string,
        params: SqlParam[],
        filters: AnalyticsFilters,
        orderByClause: string
    ): Promise<T[]> {
        const offset = (filters.page - 1) * filters.limit;
        const [rows] = await db.query<T[]>(
            `${baseQuery}
             ${orderByClause}
             LIMIT ? OFFSET ?`,
            [...params, filters.limit, offset]
        );
        return rows;
    }

    async getFraudStats(): Promise<Result<FraudStatsView, RequestError>> {
        try {
            const [[row]] = await db.query<any[]>(`
                SELECT
                    COUNT(*) AS total_bills,
                    SUM(CASE WHEN fraud_score > 80  THEN 1 ELSE 0 END) AS high_risk,
                    SUM(CASE WHEN fraud_score > 49 AND fraud_score <= 80 THEN 1 ELSE 0 END) AS medium_risk,
                    SUM(CASE WHEN fraud_score <= 49 THEN 1 ELSE 0 END) AS low_risk,
                    SUM(CASE WHEN status = 'pending' AND fraud_score > 0 THEN 1 ELSE 0 END) AS review_queue_count,
                    ROUND(COALESCE(AVG(CASE WHEN fraud_score > 80 THEN fraud_score ELSE NULL END), 0)) AS avg_high_score
                FROM bills
            `);
            const total  = toNumber(row.total_bills);
            const high   = toNumber(row.high_risk);
            const medium = toNumber(row.medium_risk);
            const low    = toNumber(row.low_risk);
            return ok({
                total_bills:        total,
                high_risk:          high,
                medium_risk:        medium,
                low_risk:           low,
                review_queue_count: toNumber(row.review_queue_count),
                avg_high_score:     toNumber(row.avg_high_score),
                high_pct:   total > 0 ? Math.round((high   / total) * 100) : 0,
                medium_pct: total > 0 ? Math.round((medium / total) * 100) : 0,
                low_pct:    total > 0 ? Math.round((low    / total) * 100) : 0,
                safe_pct:   total > 0 ? parseFloat(((total - high) / total * 100).toFixed(1)) : 0,
            });
        } catch (error) {
            logger.error('Error fetching fraud stats', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getReportsSummary(): Promise<Result<ReportsSummaryView, RequestError>> {
        try {
            const [[bills]] = await db.query<any[]>(`
                SELECT
                    COUNT(*) AS total,
                    SUM(status = 'verified') AS valid_count,
                    SUM(status = 'rejected') AS invalid_count
                FROM bills
            `);
            const [[cashback]] = await db.query<any[]>(`
                SELECT
                    COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) AS total_credited,
                    COALESCE(SUM(CASE WHEN type = 'debit'  THEN amount ELSE 0 END), 0) AS total_debited
                FROM cashback_transactions
            `);
            const [[referral]] = await db.query<any[]>(`
                SELECT COUNT(*) AS total_referrals, COALESCE(SUM(coins_awarded), 0) AS total_coins
                FROM referral_transactions
            `);
            const [[active]] = await db.query<any[]>(`
                SELECT COUNT(DISTINCT user_id) AS active_users
                FROM bills
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            `);

            const total       = toNumber(bills.total);
            const validCount  = toNumber(bills.valid_count);
            const invalidCount = toNumber(bills.invalid_count);
            const credited    = toNumber(cashback.total_credited);
            const debited     = toNumber(cashback.total_debited);

            return ok({
                bill_analytics: {
                    total_bills_uploaded: total,
                    valid_bills_count:    validCount,
                    invalid_bills_count:  invalidCount,
                    valid_bills_pct:   total > 0 ? parseFloat((validCount   / total * 100).toFixed(1)) : 0,
                    invalid_bills_pct: total > 0 ? parseFloat((invalidCount / total * 100).toFixed(1)) : 0,
                },
                cashback_ledger: {
                    total_credited:  credited,
                    total_debited:   debited,
                    net_outstanding: parseFloat((credited - debited).toFixed(2)),
                },
                referral_programme: {
                    total_referrals:     toNumber(referral.total_referrals),
                    total_coins_awarded: toNumber(referral.total_coins),
                },
                active_users_7d: toNumber(active.active_users),
            });
        } catch (error) {
            logger.error('Error fetching reports summary', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    private async countGroupedRows(baseQuery: string, params: SqlParam[]): Promise<number> {
        const [rows] = await db.query<AdminAnalyticsCountRow[]>(
            `SELECT COUNT(*) AS total FROM (${baseQuery}) analytics_groups`,
            params
        );
        return toNumber(rows[0]?.total);
    }

    private async sumGroupedSales(baseQuery: string, params: SqlParam[]): Promise<number> {
        const [rows] = await db.query<AdminAnalyticsTotalSalesRow[]>(
            `SELECT COALESCE(SUM(total_sales_amount), 0) AS total_sales_amount FROM (${baseQuery}) analytics_groups`,
            params
        );
        return toNumber(rows[0]?.total_sales_amount);
    }
}

export const AdminAnalyticsRepository = new AdminAnalyticsRepositoryImpl();
