import { err, ok, Result } from 'neverthrow';
import { db } from '../database/db.ts';
import { BillStatus } from '../models/bill.model.ts';
import {
    ANALYTICS_BRAND_TABLE,
    ANALYTICS_COMPANY_TABLE,
    ANALYTICS_PRODUCT_TABLE,
    AdminAnalyticsDashboardView,
    AnalyticsBrand,
    AnalyticsFilterSummary,
    AnalyticsCompany,
    AnalyticsFilters,
    AnalyticsProduct,
    BILL_ITEMS_TABLE,
    BillAnalyticsSnapshot,
    BrandDistributionRow,
    CategoryInsightRow,
    CompanyDistributionRow,
    DailyUploadStat,
    DrilldownFilters,
    DrilldownRow,
    GeographyDistributionFilters,
    GeographyDistributionRow,
    ItemScanRow,
    PaginationMeta,
    ProductDistributionRow,
    SalesTrendPoint,
    SyncedBillItem,
    UpsertCompanyInput,
    UpsertProductInput,
    UserActivityPoint,
} from '../models/admin.analytics.model.ts';
import {
    calculatePagination,
    formatCompanyName,
    inferCompanyType,
    percentage,
    pickAnalyticsFilters,
    slugify,
    toNumber,
} from '../utils/admin.analytics.utils.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('@admin.analytics.repository');

const DEFAULT_ANALYTICS_STATUSES: BillStatus[] = ['verified'];
const BILL_DATE_EXPR = `COALESCE(b.bill_date, DATE(b.created_at))`;

type QueryPagination<T> = {
    filters: AnalyticsFilterSummary;
    rows: T[];
    pagination: PaginationMeta;
};

function buildBillConditions(
    filters: AnalyticsFilters,
    params: (string | number)[],
    options?: {
        defaultStatuses?: BillStatus[];
        searchColumns?: string[];
        companyColumn?: string;
        brandColumn?: string;
        productColumn?: string;
    }
): string[] {
    const conditions: string[] = [];

    if (filters.date_from) {
        conditions.push(`${BILL_DATE_EXPR} >= ?`);
        params.push(filters.date_from);
    }
    if (filters.date_to) {
        conditions.push(`${BILL_DATE_EXPR} <= ?`);
        params.push(filters.date_to);
    }
    if (filters.region) {
        conditions.push(`b.region = ?`);
        params.push(filters.region);
    }
    if (filters.state) {
        conditions.push(`b.state = ?`);
        params.push(filters.state);
    }
    if (filters.city) {
        conditions.push(`b.city = ?`);
        params.push(filters.city);
    }
    if (filters.area) {
        conditions.push(`b.area = ?`);
        params.push(filters.area);
    }

    if (filters.company_id && options?.companyColumn) {
        conditions.push(`${options.companyColumn} = ?`);
        params.push(filters.company_id);
    }
    if (filters.brand_id && options?.brandColumn) {
        conditions.push(`${options.brandColumn} = ?`);
        params.push(filters.brand_id);
    }
    if (filters.product_id && options?.productColumn) {
        conditions.push(`${options.productColumn} = ?`);
        params.push(filters.product_id);
    }

    const statuses = filters.statuses && filters.statuses.length > 0
        ? filters.statuses
        : options?.defaultStatuses;
    if (statuses && statuses.length > 0) {
        conditions.push(`b.status IN (${statuses.map(() => '?').join(', ')})`);
        params.push(...statuses);
    }

    if (filters.search && options?.searchColumns && options.searchColumns.length > 0) {
        const like = `%${filters.search}%`;
        conditions.push(`(${options.searchColumns.map(column => `${column} LIKE ?`).join(' OR ')})`);
        for (let i = 0; i < options.searchColumns.length; i++) {
            params.push(like);
        }
    }

    return conditions;
}

function normalizePagination(page: number, limit: number, total: number): PaginationMeta {
    return calculatePagination(page, limit, total);
}

class AdminAnalyticsRepositoryImpl {

    async upsertCompany(input: UpsertCompanyInput): Promise<Result<number | null, RequestError>> {
        try {
            const platformCode = slugify(input.platform ?? input.merchant_name ?? 'unknown') || 'unknown';
            const companyName = formatCompanyName(input.platform, input.merchant_name);
            const companyType = inferCompanyType(input.platform);

            await db.query(
                `INSERT INTO ${ANALYTICS_COMPANY_TABLE} (platform_code, company_name, company_type)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    company_name = VALUES(company_name),
                    company_type = VALUES(company_type),
                    updated_at = CURRENT_TIMESTAMP`,
                [platformCode, companyName, companyType]
            );

            const [rows] = await db.query<AnalyticsCompany[]>(
                `SELECT id, platform_code, company_name, company_type, active_status
                 FROM ${ANALYTICS_COMPANY_TABLE}
                 WHERE platform_code = ?
                 LIMIT 1`,
                [platformCode]
            );

            return ok(rows[0]?.id ?? null);
        } catch (error) {
            logger.error('Error upserting analytics company', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async upsertBrand(brandName: string): Promise<Result<number | null, RequestError>> {
        try {
            await db.query(
                `INSERT INTO ${ANALYTICS_BRAND_TABLE} (brand_name)
                 VALUES (?)
                 ON DUPLICATE KEY UPDATE brand_name = VALUES(brand_name), updated_at = CURRENT_TIMESTAMP`,
                [brandName]
            );

            const [rows] = await db.query<AnalyticsBrand[]>(
                `SELECT id, brand_name
                 FROM ${ANALYTICS_BRAND_TABLE}
                 WHERE brand_name = ?
                 LIMIT 1`,
                [brandName]
            );

            return ok(rows[0]?.id ?? null);
        } catch (error) {
            logger.error('Error upserting analytics brand', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async upsertProduct(input: UpsertProductInput): Promise<Result<number | null, RequestError>> {
        try {
            const productKey = slugify(`${input.brand_name ?? 'generic'}-${input.normalized_name}`);
            const productName = input.normalized_name || input.raw_name;

            await db.query(
                `INSERT INTO ${ANALYTICS_PRODUCT_TABLE}
                    (product_key, product_name, normalized_name, brand_id, category_l1, category_l2, unit_type, pack_size)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    product_name = VALUES(product_name),
                    normalized_name = VALUES(normalized_name),
                    brand_id = VALUES(brand_id),
                    category_l1 = VALUES(category_l1),
                    category_l2 = VALUES(category_l2),
                    unit_type = VALUES(unit_type),
                    pack_size = VALUES(pack_size),
                    updated_at = CURRENT_TIMESTAMP`,
                [
                    productKey,
                    productName,
                    input.normalized_name,
                    input.brand_id,
                    input.category_l1,
                    input.category_l2,
                    input.unit_type,
                    input.pack_size,
                ]
            );

            const [rows] = await db.query<AnalyticsProduct[]>(
                `SELECT id, product_key, product_name, normalized_name, brand_id, category_l1, category_l2, unit_type, pack_size
                 FROM ${ANALYTICS_PRODUCT_TABLE}
                 WHERE product_key = ?
                 LIMIT 1`,
                [productKey]
            );

            return ok(rows[0]?.id ?? null);
        } catch (error) {
            logger.error('Error upserting analytics product', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async updateBillAnalyticsSnapshot(
        billId: number,
        snapshot: BillAnalyticsSnapshot
    ): Promise<Result<void, RequestError>> {
        try {
            await db.query(
                `UPDATE bills
                 SET company_id = ?, merchant_name = ?, region = ?, state = ?, city = ?, area = ?, postal_code = ?
                 WHERE id = ?`,
                [
                    snapshot.company_id,
                    snapshot.merchant_name,
                    snapshot.region,
                    snapshot.state,
                    snapshot.city,
                    snapshot.area,
                    snapshot.postal_code,
                    billId,
                ]
            );
            return ok(undefined);
        } catch (error) {
            logger.error('Error updating bill analytics snapshot', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async replaceBillItems(
        billId: number,
        items: SyncedBillItem[]
    ): Promise<Result<void, RequestError>> {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(`DELETE FROM ${BILL_ITEMS_TABLE} WHERE bill_id = ?`, [billId]);

            for (const item of items) {
                await connection.query(
                    `INSERT INTO ${BILL_ITEMS_TABLE}
                        (bill_id, company_id, brand_id, product_id, product_name_raw, product_name_normalized,
                         category_l1, category_l2, quantity, unit_type, unit_price, line_amount,
                         currency_code, city, area, bill_date)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        billId,
                        item.company_id,
                        item.brand_id,
                        item.product_id,
                        item.product_name_raw,
                        item.product_name_normalized,
                        item.category_l1,
                        item.category_l2,
                        item.quantity,
                        item.unit_type,
                        item.unit_price,
                        item.line_amount,
                        item.currency_code,
                        item.city,
                        item.area,
                        item.bill_date,
                    ]
                );
            }

            await connection.commit();
            return ok(undefined);
        } catch (error) {
            await connection.rollback();
            logger.error('Error replacing analytics bill items', error);
            return err(ERRORS.DATABASE_ERROR);
        } finally {
            connection.release();
        }
    }

    async getDashboard(filters: AnalyticsFilters): Promise<Result<AdminAnalyticsDashboardView, RequestError>> {
        try {
            const billParams: (string | number)[] = [];
            const billConditions = buildBillConditions(filters, billParams);
            const billWhere = billConditions.length > 0 ? `WHERE ${billConditions.join(' AND ')}` : '';

            const [billRows] = await db.query<any[]>(
                `SELECT
                    COUNT(*) AS total_bills_uploaded,
                    SUM(CASE WHEN b.status = 'verified' THEN 1 ELSE 0 END) AS valid_bills_count,
                    SUM(CASE WHEN b.status IN ('rejected', 'failed') THEN 1 ELSE 0 END) AS invalid_bills_count,
                    SUM(CASE WHEN b.status = 'pending' THEN 1 ELSE 0 END) AS pending_bills_count
                 FROM bills b
                 ${billWhere}`,
                billParams
            );
            const billSummary = billRows[0] ?? {};
            const totalBills = toNumber(billSummary.total_bills_uploaded);
            const validBills = toNumber(billSummary.valid_bills_count);
            const invalidBills = toNumber(billSummary.invalid_bills_count);

            const [dailyRows] = await db.query<any[]>(
                `SELECT
                    DATE_FORMAT(DATE(b.created_at), '%Y-%m-%d') AS period_label,
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

            const companyPurchaseResult = await this.getCompanyDistribution({
                ...filters,
                page: 1,
                limit: 10,
            });
            if (companyPurchaseResult.isErr()) return err(companyPurchaseResult.error);

            const brandResult = await this.getBrandDistribution({
                ...filters,
                page: 1,
                limit: 10,
            });
            if (brandResult.isErr()) return err(brandResult.error);

            const productResult = await this.getProductDistribution({
                ...filters,
                page: 1,
                limit: 10,
            });
            if (productResult.isErr()) return err(productResult.error);

            const categoryParams: (string | number)[] = [];
            const categoryConditions = buildBillConditions(
                filters,
                categoryParams,
                {
                    defaultStatuses: DEFAULT_ANALYTICS_STATUSES,
                }
            );
            const categoryWhere = categoryConditions.length > 0 ? `WHERE ${categoryConditions.join(' AND ')}` : '';

            const [categoryRows] = await db.query<any[]>(
                `SELECT
                    COALESCE(NULLIF(bi.category_l1, ''), 'Uncategorized') AS category_l1,
                    COUNT(*) AS scan_count,
                    COALESCE(SUM(COALESCE(bi.quantity, 1)), 0) AS total_quantity,
                    COALESCE(SUM(bi.line_amount), 0) AS total_sales_amount,
                    COUNT(DISTINCT bi.product_id) AS product_count,
                    COUNT(DISTINCT bi.brand_id) AS brand_count
                 FROM ${BILL_ITEMS_TABLE} bi
                 INNER JOIN bills b ON b.id = bi.bill_id
                 ${categoryWhere}
                 GROUP BY COALESCE(NULLIF(bi.category_l1, ''), 'Uncategorized')
                 ORDER BY total_sales_amount DESC
                 LIMIT 10`,
                categoryParams
            );

            const [trendRows] = await db.query<any[]>(
                `SELECT
                    DATE_FORMAT(${BILL_DATE_EXPR}, '%Y-%m-%d') AS period,
                    COALESCE(SUM(bi.line_amount), 0) AS actual_revenue,
                    COUNT(DISTINCT b.id) AS bill_count,
                    COUNT(*) AS item_scan_count,
                    COUNT(DISTINCT b.user_id) AS active_users
                 FROM ${BILL_ITEMS_TABLE} bi
                 INNER JOIN bills b ON b.id = bi.bill_id
                 ${categoryWhere}
                 GROUP BY DATE_FORMAT(${BILL_DATE_EXPR}, '%Y-%m-%d')
                 ORDER BY period ASC
                 LIMIT 30`,
                categoryParams
            );

            const realtimeBillParams: (string | number)[] = [];
            const realtimeConditions = buildBillConditions(filters, realtimeBillParams);
            const realtimeWhere = realtimeConditions.length > 0 ? `WHERE ${realtimeConditions.join(' AND ')}` : '';

            const [realtimeBillRows] = await db.query<any[]>(
                `SELECT
                    SUM(CASE WHEN b.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) AS uploads_last_24h,
                    SUM(CASE WHEN b.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND b.status = 'verified' THEN 1 ELSE 0 END) AS verified_last_24h,
                    COUNT(DISTINCT CASE WHEN b.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN b.user_id END) AS active_users_last_7d
                 FROM bills b
                 ${realtimeWhere}`,
                realtimeBillParams
            );

            const realtimeItemParams: (string | number)[] = [];
            const realtimeItemConditions = buildBillConditions(
                filters,
                realtimeItemParams,
                { defaultStatuses: DEFAULT_ANALYTICS_STATUSES }
            );
            realtimeItemConditions.push(`b.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`);
            const realtimeItemWhere = `WHERE ${realtimeItemConditions.join(' AND ')}`;

            const [realtimeItemRows] = await db.query<any[]>(
                `SELECT COALESCE(SUM(bi.line_amount), 0) AS sales_last_24h
                 FROM ${BILL_ITEMS_TABLE} bi
                 INNER JOIN bills b ON b.id = bi.bill_id
                 ${realtimeItemWhere}`,
                realtimeItemParams
            );

            const [userActivityRows] = await db.query<any[]>(
                `SELECT
                    DATE_FORMAT(DATE(b.created_at), '%Y-%m-%d') AS period,
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

            const response: AdminAnalyticsDashboardView = {
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
                    company_purchase_analysis: companyPurchaseResult.value.rows,
                    top_performing_brands: brandResult.value.rows,
                    sales_trends: trendRows.map<SalesTrendPoint>((row) => ({
                        period: row.period,
                        actual_revenue: toNumber(row.actual_revenue),
                        bill_count: toNumber(row.bill_count),
                        item_scan_count: toNumber(row.item_scan_count),
                        active_users: toNumber(row.active_users),
                    })),
                },
                product_analytics: {
                    product_frequency_analysis: productResult.value.rows,
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
                    sales_trends: trendRows.map<SalesTrendPoint>((row) => ({
                        period: row.period,
                        actual_revenue: toNumber(row.actual_revenue),
                        bill_count: toNumber(row.bill_count),
                        item_scan_count: toNumber(row.item_scan_count),
                        active_users: toNumber(row.active_users),
                    })),
                    user_activity_graphs: userActivityRows.map<UserActivityPoint>((row) => ({
                        period: row.period,
                        active_users: toNumber(row.active_users),
                        uploading_users: toNumber(row.uploading_users),
                        avg_uploads_per_user: toNumber(row.avg_uploads_per_user),
                    })),
                },
            };

            return ok(response);
        } catch (error) {
            logger.error('Error building admin analytics dashboard', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getCompanyDistribution(
        filters: AnalyticsFilters
    ): Promise<Result<QueryPagination<CompanyDistributionRow>, RequestError>> {
        try {
            const params: (string | number)[] = [];
            const conditions = buildBillConditions(
                filters,
                params,
                {
                    defaultStatuses: DEFAULT_ANALYTICS_STATUSES,
                    searchColumns: ['c.company_name', 'b.merchant_name'],
                    companyColumn: 'bi.company_id',
                }
            );
            const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            const offset = (filters.page - 1) * filters.limit;

            const baseQuery = `
                SELECT
                    bi.company_id AS company_id,
                    COALESCE(c.company_name, b.merchant_name, 'Unknown') AS company_name,
                    COUNT(DISTINCT bi.bill_id) AS bill_count,
                    COUNT(*) AS item_scan_count,
                    COALESCE(SUM(COALESCE(bi.quantity, 1)), 0) AS total_quantity,
                    COALESCE(SUM(bi.line_amount), 0) AS total_sales_amount
                FROM ${BILL_ITEMS_TABLE} bi
                INNER JOIN bills b ON b.id = bi.bill_id
                LEFT JOIN ${ANALYTICS_COMPANY_TABLE} c ON c.id = bi.company_id
                ${where}
                GROUP BY bi.company_id, COALESCE(c.company_name, b.merchant_name, 'Unknown')
            `;

            const [rows] = await db.query<any[]>(
                `${baseQuery}
                 ORDER BY total_sales_amount DESC, item_scan_count DESC
                 LIMIT ? OFFSET ?`,
                [...params, filters.limit, offset]
            );

            const [countRows] = await db.query<any[]>(
                `SELECT COUNT(*) AS total FROM (${baseQuery}) company_groups`,
                params
            );
            const total = toNumber(countRows[0]?.total);
            const totalSales = rows.reduce((sum, row) => sum + toNumber(row.total_sales_amount), 0);

            return ok({
                filters: pickAnalyticsFilters(filters),
                rows: rows.map<CompanyDistributionRow>((row) => ({
                    company_id: row.company_id ? Number(row.company_id) : null,
                    company_name: row.company_name,
                    bill_count: toNumber(row.bill_count),
                    item_scan_count: toNumber(row.item_scan_count),
                    total_quantity: toNumber(row.total_quantity),
                    total_sales_amount: toNumber(row.total_sales_amount),
                    share_pct: percentage(toNumber(row.total_sales_amount), totalSales),
                })),
                pagination: normalizePagination(filters.page, filters.limit, total),
            });
        } catch (error) {
            logger.error('Error fetching company distribution', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getBrandDistribution(
        filters: AnalyticsFilters
    ): Promise<Result<QueryPagination<BrandDistributionRow>, RequestError>> {
        try {
            const params: (string | number)[] = [];
            const conditions = buildBillConditions(
                filters,
                params,
                {
                    defaultStatuses: DEFAULT_ANALYTICS_STATUSES,
                    searchColumns: ['br.brand_name', 'p.product_name'],
                    companyColumn: 'bi.company_id',
                    brandColumn: 'bi.brand_id',
                }
            );
            const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            const offset = (filters.page - 1) * filters.limit;

            const baseQuery = `
                SELECT
                    bi.brand_id AS brand_id,
                    COALESCE(br.brand_name, 'Unbranded') AS brand_name,
                    COUNT(*) AS scan_count,
                    COALESCE(SUM(COALESCE(bi.quantity, 1)), 0) AS total_quantity,
                    COALESCE(SUM(bi.line_amount), 0) AS total_sales_amount,
                    COUNT(DISTINCT bi.company_id) AS company_count,
                    COUNT(DISTINCT bi.product_id) AS product_count
                FROM ${BILL_ITEMS_TABLE} bi
                INNER JOIN bills b ON b.id = bi.bill_id
                LEFT JOIN ${ANALYTICS_BRAND_TABLE} br ON br.id = bi.brand_id
                LEFT JOIN ${ANALYTICS_PRODUCT_TABLE} p ON p.id = bi.product_id
                ${where}
                GROUP BY bi.brand_id, COALESCE(br.brand_name, 'Unbranded')
            `;

            const [rows] = await db.query<any[]>(
                `${baseQuery}
                 ORDER BY total_sales_amount DESC, scan_count DESC
                 LIMIT ? OFFSET ?`,
                [...params, filters.limit, offset]
            );
            const [countRows] = await db.query<any[]>(
                `SELECT COUNT(*) AS total FROM (${baseQuery}) brand_groups`,
                params
            );
            const total = toNumber(countRows[0]?.total);
            const totalSales = rows.reduce((sum, row) => sum + toNumber(row.total_sales_amount), 0);

            return ok({
                filters: pickAnalyticsFilters(filters),
                rows: rows.map<BrandDistributionRow>((row) => ({
                    brand_id: row.brand_id ? Number(row.brand_id) : null,
                    brand_name: row.brand_name,
                    scan_count: toNumber(row.scan_count),
                    total_quantity: toNumber(row.total_quantity),
                    total_sales_amount: toNumber(row.total_sales_amount),
                    company_count: toNumber(row.company_count),
                    product_count: toNumber(row.product_count),
                    share_pct: percentage(toNumber(row.total_sales_amount), totalSales),
                })),
                pagination: normalizePagination(filters.page, filters.limit, total),
            });
        } catch (error) {
            logger.error('Error fetching brand distribution', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getProductDistribution(
        filters: AnalyticsFilters
    ): Promise<Result<QueryPagination<ProductDistributionRow>, RequestError>> {
        try {
            const params: (string | number)[] = [];
            const conditions = buildBillConditions(
                filters,
                params,
                {
                    defaultStatuses: DEFAULT_ANALYTICS_STATUSES,
                    searchColumns: ['p.product_name', 'bi.product_name_raw', 'br.brand_name'],
                    companyColumn: 'bi.company_id',
                    brandColumn: 'bi.brand_id',
                    productColumn: 'bi.product_id',
                }
            );
            const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            const offset = (filters.page - 1) * filters.limit;

            const baseQuery = `
                SELECT
                    bi.product_id AS product_id,
                    COALESCE(p.product_name, bi.product_name_normalized, bi.product_name_raw) AS product_name,
                    br.brand_name AS brand_name,
                    COALESCE(bi.category_l1, p.category_l1) AS category_l1,
                    COUNT(*) AS scan_count,
                    COALESCE(SUM(COALESCE(bi.quantity, 1)), 0) AS total_quantity,
                    COALESCE(SUM(bi.line_amount), 0) AS total_sales_amount,
                    COUNT(DISTINCT bi.company_id) AS company_count
                FROM ${BILL_ITEMS_TABLE} bi
                INNER JOIN bills b ON b.id = bi.bill_id
                LEFT JOIN ${ANALYTICS_PRODUCT_TABLE} p ON p.id = bi.product_id
                LEFT JOIN ${ANALYTICS_BRAND_TABLE} br ON br.id = bi.brand_id
                ${where}
                GROUP BY bi.product_id, COALESCE(p.product_name, bi.product_name_normalized, bi.product_name_raw), br.brand_name, COALESCE(bi.category_l1, p.category_l1)
            `;

            const [rows] = await db.query<any[]>(
                `${baseQuery}
                 ORDER BY scan_count DESC, total_sales_amount DESC
                 LIMIT ? OFFSET ?`,
                [...params, filters.limit, offset]
            );
            const [countRows] = await db.query<any[]>(
                `SELECT COUNT(*) AS total FROM (${baseQuery}) product_groups`,
                params
            );
            const total = toNumber(countRows[0]?.total);

            return ok({
                filters: pickAnalyticsFilters(filters),
                rows: rows.map<ProductDistributionRow>((row) => ({
                    product_id: row.product_id ? Number(row.product_id) : null,
                    product_name: row.product_name,
                    brand_name: row.brand_name ?? null,
                    category_l1: row.category_l1 ?? null,
                    scan_count: toNumber(row.scan_count),
                    total_quantity: toNumber(row.total_quantity),
                    total_sales_amount: toNumber(row.total_sales_amount),
                    company_count: toNumber(row.company_count),
                })),
                pagination: normalizePagination(filters.page, filters.limit, total),
            });
        } catch (error) {
            logger.error('Error fetching product distribution', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getGeographyDistribution(
        filters: GeographyDistributionFilters
    ): Promise<Result<QueryPagination<GeographyDistributionRow>, RequestError>> {
        try {
            const columnMap: Record<GeographyDistributionFilters['group_by'], string> = {
                region: `COALESCE(b.region, 'Unknown')`,
                state: `COALESCE(b.state, 'Unknown')`,
                city: `COALESCE(b.city, 'Unknown')`,
                area: `COALESCE(b.area, 'Unknown')`,
            };
            const geographyExpr = columnMap[filters.group_by];

            const params: (string | number)[] = [];
            const conditions = buildBillConditions(
                filters,
                params,
                {
                    defaultStatuses: DEFAULT_ANALYTICS_STATUSES,
                    companyColumn: 'bi.company_id',
                    brandColumn: 'bi.brand_id',
                    productColumn: 'bi.product_id',
                }
            );
            const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            const offset = (filters.page - 1) * filters.limit;

            const baseQuery = `
                SELECT
                    ${geographyExpr} AS geography_label,
                    COUNT(DISTINCT bi.bill_id) AS bill_count,
                    COUNT(*) AS item_scan_count,
                    COALESCE(SUM(COALESCE(bi.quantity, 1)), 0) AS total_quantity,
                    COALESCE(SUM(bi.line_amount), 0) AS total_sales_amount,
                    COUNT(DISTINCT bi.company_id) AS company_count,
                    COUNT(DISTINCT bi.brand_id) AS brand_count,
                    COUNT(DISTINCT bi.product_id) AS product_count
                FROM ${BILL_ITEMS_TABLE} bi
                INNER JOIN bills b ON b.id = bi.bill_id
                ${where}
                GROUP BY ${geographyExpr}
            `;

            const [rows] = await db.query<any[]>(
                `${baseQuery}
                 ORDER BY total_sales_amount DESC, item_scan_count DESC
                 LIMIT ? OFFSET ?`,
                [...params, filters.limit, offset]
            );
            const [countRows] = await db.query<any[]>(
                `SELECT COUNT(*) AS total FROM (${baseQuery}) geography_groups`,
                params
            );
            const total = toNumber(countRows[0]?.total);

            return ok({
                filters: pickAnalyticsFilters(filters),
                rows: rows.map<GeographyDistributionRow>((row) => ({
                    geography_label: row.geography_label,
                    bill_count: toNumber(row.bill_count),
                    item_scan_count: toNumber(row.item_scan_count),
                    total_quantity: toNumber(row.total_quantity),
                    total_sales_amount: toNumber(row.total_sales_amount),
                    company_count: toNumber(row.company_count),
                    brand_count: toNumber(row.brand_count),
                    product_count: toNumber(row.product_count),
                })),
                pagination: normalizePagination(filters.page, filters.limit, total),
            });
        } catch (error) {
            logger.error('Error fetching geography distribution', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getItemScans(
        filters: AnalyticsFilters
    ): Promise<Result<QueryPagination<ItemScanRow>, RequestError>> {
        try {
            const params: (string | number)[] = [];
            const conditions = buildBillConditions(
                filters,
                params,
                {
                    defaultStatuses: DEFAULT_ANALYTICS_STATUSES,
                    searchColumns: ['p.product_name', 'bi.product_name_raw', 'br.brand_name', 'c.company_name', 'CAST(b.id AS CHAR)'],
                    companyColumn: 'bi.company_id',
                    brandColumn: 'bi.brand_id',
                    productColumn: 'bi.product_id',
                }
            );
            const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            const offset = (filters.page - 1) * filters.limit;

            const [rows] = await db.query<any[]>(
                `SELECT
                    bi.id AS bill_item_id,
                    bi.bill_id AS bill_id,
                    b.user_id AS user_id,
                    bi.company_id AS company_id,
                    COALESCE(c.company_name, b.merchant_name, 'Unknown') AS company_name,
                    bi.brand_id AS brand_id,
                    br.brand_name AS brand_name,
                    bi.product_id AS product_id,
                    COALESCE(p.product_name, bi.product_name_normalized, bi.product_name_raw) AS product_name,
                    bi.product_name_raw AS product_name_raw,
                    bi.category_l1 AS category_l1,
                    bi.quantity AS quantity,
                    bi.unit_price AS unit_price,
                    bi.line_amount AS line_amount,
                    COALESCE(b.city, bi.city) AS city,
                    COALESCE(b.area, bi.area) AS area,
                    DATE_FORMAT(COALESCE(bi.bill_date, ${BILL_DATE_EXPR}), '%Y-%m-%d') AS bill_date,
                    b.status AS bill_status
                 FROM ${BILL_ITEMS_TABLE} bi
                 INNER JOIN bills b ON b.id = bi.bill_id
                 LEFT JOIN ${ANALYTICS_COMPANY_TABLE} c ON c.id = bi.company_id
                 LEFT JOIN ${ANALYTICS_BRAND_TABLE} br ON br.id = bi.brand_id
                 LEFT JOIN ${ANALYTICS_PRODUCT_TABLE} p ON p.id = bi.product_id
                 ${where}
                 ORDER BY COALESCE(bi.bill_date, ${BILL_DATE_EXPR}) DESC, bi.id DESC
                 LIMIT ? OFFSET ?`,
                [...params, filters.limit, offset]
            );

            const [countRows] = await db.query<any[]>(
                `SELECT COUNT(*) AS total
                 FROM ${BILL_ITEMS_TABLE} bi
                 INNER JOIN bills b ON b.id = bi.bill_id
                 LEFT JOIN ${ANALYTICS_COMPANY_TABLE} c ON c.id = bi.company_id
                 LEFT JOIN ${ANALYTICS_BRAND_TABLE} br ON br.id = bi.brand_id
                 LEFT JOIN ${ANALYTICS_PRODUCT_TABLE} p ON p.id = bi.product_id
                 ${where}`,
                params
            );
            const total = toNumber(countRows[0]?.total);

            return ok({
                filters: pickAnalyticsFilters(filters),
                rows: rows.map<ItemScanRow>((row) => ({
                    bill_item_id: Number(row.bill_item_id),
                    bill_id: Number(row.bill_id),
                    user_id: Number(row.user_id),
                    company_id: row.company_id ? Number(row.company_id) : null,
                    company_name: row.company_name,
                    brand_id: row.brand_id ? Number(row.brand_id) : null,
                    brand_name: row.brand_name ?? null,
                    product_id: row.product_id ? Number(row.product_id) : null,
                    product_name: row.product_name ?? null,
                    product_name_raw: row.product_name_raw,
                    category_l1: row.category_l1 ?? null,
                    quantity: row.quantity !== null ? Number(row.quantity) : null,
                    unit_price: row.unit_price !== null ? Number(row.unit_price) : null,
                    line_amount: toNumber(row.line_amount),
                    city: row.city ?? null,
                    area: row.area ?? null,
                    bill_date: row.bill_date ?? null,
                    bill_status: row.bill_status as BillStatus,
                })),
                pagination: normalizePagination(filters.page, filters.limit, total),
            });
        } catch (error) {
            logger.error('Error fetching item scans', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getCompanyProducts(
        companyId: number,
        filters: DrilldownFilters
    ): Promise<Result<QueryPagination<DrilldownRow>, RequestError>> {
        return this.getGroupedDrilldown(
            { ...filters, company_id: companyId },
            'product',
            'bi.product_id',
            `COALESCE(p.product_name, bi.product_name_normalized, bi.product_name_raw)`
        );
    }

    async getBrandProducts(
        brandId: number,
        filters: DrilldownFilters
    ): Promise<Result<QueryPagination<DrilldownRow>, RequestError>> {
        return this.getGroupedDrilldown(
            { ...filters, brand_id: brandId },
            'product',
            'bi.product_id',
            `COALESCE(p.product_name, bi.product_name_normalized, bi.product_name_raw)`
        );
    }

    async getProductCompanies(
        productId: number,
        filters: DrilldownFilters
    ): Promise<Result<QueryPagination<DrilldownRow>, RequestError>> {
        return this.getGroupedDrilldown(
            { ...filters, product_id: productId },
            'company',
            'bi.company_id',
            `COALESCE(c.company_name, b.merchant_name, 'Unknown')`
        );
    }

    private async getGroupedDrilldown(
        filters: DrilldownFilters,
        type: 'company' | 'product',
        idColumn: string,
        nameExpr: string
    ): Promise<Result<QueryPagination<DrilldownRow>, RequestError>> {
        try {
            const params: (string | number)[] = [];
            const conditions = buildBillConditions(
                filters,
                params,
                {
                    defaultStatuses: DEFAULT_ANALYTICS_STATUSES,
                    searchColumns: type === 'company'
                        ? ['c.company_name', 'b.merchant_name']
                        : ['p.product_name', 'bi.product_name_raw'],
                    companyColumn: 'bi.company_id',
                    brandColumn: 'bi.brand_id',
                    productColumn: 'bi.product_id',
                }
            );
            const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            const offset = (filters.page - 1) * filters.limit;

            const baseQuery = `
                SELECT
                    ${idColumn} AS id,
                    ${nameExpr} AS name,
                    COUNT(DISTINCT bi.bill_id) AS bill_count,
                    COUNT(*) AS scan_count,
                    COALESCE(SUM(COALESCE(bi.quantity, 1)), 0) AS total_quantity,
                    COALESCE(SUM(bi.line_amount), 0) AS total_sales_amount
                FROM ${BILL_ITEMS_TABLE} bi
                INNER JOIN bills b ON b.id = bi.bill_id
                LEFT JOIN ${ANALYTICS_COMPANY_TABLE} c ON c.id = bi.company_id
                LEFT JOIN ${ANALYTICS_PRODUCT_TABLE} p ON p.id = bi.product_id
                ${where}
                GROUP BY ${idColumn}, ${nameExpr}
            `;

            const [rows] = await db.query<any[]>(
                `${baseQuery}
                 ORDER BY total_sales_amount DESC, scan_count DESC
                 LIMIT ? OFFSET ?`,
                [...params, filters.limit, offset]
            );
            const [countRows] = await db.query<any[]>(
                `SELECT COUNT(*) AS total FROM (${baseQuery}) drilldown_groups`,
                params
            );
            const total = toNumber(countRows[0]?.total);

            return ok({
                filters: pickAnalyticsFilters(filters),
                rows: rows.map<DrilldownRow>((row) => ({
                    id: row.id ? Number(row.id) : null,
                    name: row.name,
                    bill_count: toNumber(row.bill_count),
                    scan_count: toNumber(row.scan_count),
                    total_quantity: toNumber(row.total_quantity),
                    total_sales_amount: toNumber(row.total_sales_amount),
                })),
                pagination: normalizePagination(filters.page, filters.limit, total),
            });
        } catch (error) {
            logger.error('Error fetching analytics drilldown', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }
}

export const AdminAnalyticsRepository = new AdminAnalyticsRepositoryImpl();
