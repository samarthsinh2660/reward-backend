import { Router, Request, Response, NextFunction } from 'express';
import z from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.ts';
import validateRequest from '../middleware/validate-request.middleware.ts';
import { errorHandler } from '../middleware/error.middleware.ts';
import { successResponse } from '../utils/response.ts';
import { BILL_STATUSES, BillStatus } from '../models/bill.model.ts';
import {
    ANALYTICS_GEOGRAPHY_GROUPS,
    AnalyticsFilters,
    DrilldownFilters,
    GeographyDistributionFilters,
} from '../models/admin.analytics.model.ts';
import {
    getAdminAnalyticsDashboard,
    getBrandDistribution,
    getBrandProducts,
    getCompanyDistribution,
    getCompanyProducts,
    getGeographyDistribution,
    getItemScans,
    getProductCompanies,
    getProductDistribution,
} from '../controller/admin.analytics.controller.ts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const SCHEMA = {
    LIST: z.object({
        date_from: z.string().regex(ISO_DATE).optional(),
        date_to: z.string().regex(ISO_DATE).optional(),
        region: z.string().max(100).optional(),
        state: z.string().max(100).optional(),
        city: z.string().max(100).optional(),
        area: z.string().max(100).optional(),
        company_id: z.coerce.number().int().min(1).optional(),
        brand_id: z.coerce.number().int().min(1).optional(),
        product_id: z.coerce.number().int().min(1).optional(),
        search: z.string().max(120).optional(),
        statuses: z.string().max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
    GEOGRAPHY: z.object({
        date_from: z.string().regex(ISO_DATE).optional(),
        date_to: z.string().regex(ISO_DATE).optional(),
        region: z.string().max(100).optional(),
        state: z.string().max(100).optional(),
        city: z.string().max(100).optional(),
        area: z.string().max(100).optional(),
        company_id: z.coerce.number().int().min(1).optional(),
        brand_id: z.coerce.number().int().min(1).optional(),
        product_id: z.coerce.number().int().min(1).optional(),
        statuses: z.string().max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        group_by: z.enum(ANALYTICS_GEOGRAPHY_GROUPS).default('city'),
    }),
    ID_PARAM: z.object({
        id: z.coerce.number().int().min(1),
    }),
};

function parseStatuses(raw: string | undefined): BillStatus[] | undefined {
    if (!raw) return undefined;
    const statuses = raw
        .split(',')
        .map(value => value.trim())
        .filter(value => (BILL_STATUSES as readonly string[]).includes(value)) as BillStatus[];
    return statuses.length > 0 ? statuses : undefined;
}

function toAnalyticsFilters(query: z.infer<typeof SCHEMA.LIST>): AnalyticsFilters {
    return {
        ...query,
        statuses: parseStatuses(query.statuses),
    };
}

function toDrilldownFilters(query: z.infer<typeof SCHEMA.LIST>): DrilldownFilters {
    return {
        ...query,
        statuses: parseStatuses(query.statuses),
    };
}

function toGeographyFilters(query: z.infer<typeof SCHEMA.GEOGRAPHY>): GeographyDistributionFilters {
    return {
        ...query,
        statuses: parseStatuses(query.statuses),
    };
}

const adminAnalyticsRouter = Router();

adminAnalyticsRouter.use(authenticate, requireAdmin);

adminAnalyticsRouter.get(
    '/dashboard',
    validateRequest({ query: SCHEMA.LIST }),
    async function (req: Request, res: Response, next: NextFunction) {
        const filters = toAnalyticsFilters(SCHEMA.LIST.parse(req.query));
        const result = await getAdminAnalyticsDashboard(filters);
        result.match(
            (data) => res.json(successResponse(data, 'Admin analytics dashboard fetched')),
            (error) => next(error)
        );
    }
);

adminAnalyticsRouter.get(
    '/company-distribution',
    validateRequest({ query: SCHEMA.LIST }),
    async function (req: Request, res: Response, next: NextFunction) {
        const filters = toAnalyticsFilters(SCHEMA.LIST.parse(req.query));
        const result = await getCompanyDistribution(filters);
        result.match(
            (data) => res.json(successResponse(data, 'Company distribution fetched')),
            (error) => next(error)
        );
    }
);

adminAnalyticsRouter.get(
    '/brand-distribution',
    validateRequest({ query: SCHEMA.LIST }),
    async function (req: Request, res: Response, next: NextFunction) {
        const filters = toAnalyticsFilters(SCHEMA.LIST.parse(req.query));
        const result = await getBrandDistribution(filters);
        result.match(
            (data) => res.json(successResponse(data, 'Brand distribution fetched')),
            (error) => next(error)
        );
    }
);

adminAnalyticsRouter.get(
    '/product-distribution',
    validateRequest({ query: SCHEMA.LIST }),
    async function (req: Request, res: Response, next: NextFunction) {
        const filters = toAnalyticsFilters(SCHEMA.LIST.parse(req.query));
        const result = await getProductDistribution(filters);
        result.match(
            (data) => res.json(successResponse(data, 'Product distribution fetched')),
            (error) => next(error)
        );
    }
);

adminAnalyticsRouter.get(
    '/geography-distribution',
    validateRequest({ query: SCHEMA.GEOGRAPHY }),
    async function (req: Request, res: Response, next: NextFunction) {
        const filters = toGeographyFilters(SCHEMA.GEOGRAPHY.parse(req.query));
        const result = await getGeographyDistribution(filters);
        result.match(
            (data) => res.json(successResponse(data, 'Geography distribution fetched')),
            (error) => next(error)
        );
    }
);

adminAnalyticsRouter.get(
    '/item-scans',
    validateRequest({ query: SCHEMA.LIST }),
    async function (req: Request, res: Response, next: NextFunction) {
        const filters = toAnalyticsFilters(SCHEMA.LIST.parse(req.query));
        const result = await getItemScans(filters);
        result.match(
            (data) => res.json(successResponse(data, 'Item scans fetched')),
            (error) => next(error)
        );
    }
);

adminAnalyticsRouter.get(
    '/companies/:id/products',
    validateRequest({ params: SCHEMA.ID_PARAM, query: SCHEMA.LIST }),
    async function (req: Request, res: Response, next: NextFunction) {
        const filters = toDrilldownFilters(SCHEMA.LIST.parse(req.query));
        const result = await getCompanyProducts(Number(req.params.id), filters);
        result.match(
            (data) => res.json(successResponse(data, 'Company products fetched')),
            (error) => next(error)
        );
    }
);

adminAnalyticsRouter.get(
    '/brands/:id/products',
    validateRequest({ params: SCHEMA.ID_PARAM, query: SCHEMA.LIST }),
    async function (req: Request, res: Response, next: NextFunction) {
        const filters = toDrilldownFilters(SCHEMA.LIST.parse(req.query));
        const result = await getBrandProducts(Number(req.params.id), filters);
        result.match(
            (data) => res.json(successResponse(data, 'Brand products fetched')),
            (error) => next(error)
        );
    }
);

adminAnalyticsRouter.get(
    '/products/:id/companies',
    validateRequest({ params: SCHEMA.ID_PARAM, query: SCHEMA.LIST }),
    async function (req: Request, res: Response, next: NextFunction) {
        const filters = toDrilldownFilters(SCHEMA.LIST.parse(req.query));
        const result = await getProductCompanies(Number(req.params.id), filters);
        result.match(
            (data) => res.json(successResponse(data, 'Product companies fetched')),
            (error) => next(error)
        );
    }
);

adminAnalyticsRouter.use(errorHandler);

export default adminAnalyticsRouter;
