import { Router, Request, Response, NextFunction } from 'express';
import z from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.ts';
import validateRequest from '../middleware/validate-request.middleware.ts';
import { errorHandler } from '../middleware/error.middleware.ts';
import { successResponse } from '../utils/response.ts';
import { RewardConfigRepository } from '../repositories/reward_config.repository.ts';
import { BILL_STATUSES } from '../models/bill.model.ts';
import { adminListBills, adminApproveBill, adminRejectBill } from '../controller/bill.controller.ts';

const SCHEMA = {
    UPDATE_TIER: z.object({
        reward_min: z.number().positive().optional(),
        reward_max: z.number().positive().optional(),
        coin_min:   z.number().int().positive().optional(),
        coin_max:   z.number().int().positive().optional(),
        weight:     z.number().int().min(1).optional(),
        is_active:  z.boolean().optional(),
    }).refine(
        (d) => d.reward_min === undefined || d.reward_max === undefined || d.reward_min < d.reward_max,
        { message: 'reward_min must be less than reward_max' }
    ).refine(
        (d) => d.coin_min === undefined || d.coin_max === undefined || d.coin_min < d.coin_max,
        { message: 'coin_min must be less than coin_max' }
    ),

    UPDATE_LIMITS: z.object({
        daily_limit:   z.number().int().min(1).optional(),
        weekly_limit:  z.number().int().min(1).optional(),
        monthly_limit: z.number().int().min(1).optional(),
        pity_cap:      z.number().int().min(1).optional(),
    }),

    TIER_ID: z.object({
        id: z.coerce.number().int().min(1),
    }),

    BILL_LIST: z.object({
        limit:  z.coerce.number().int().min(1).max(100).default(20),
        before: z.coerce.number().int().optional(),
        status: z.enum(BILL_STATUSES).optional(),
    }),

    BILL_ID: z.object({
        id: z.coerce.number().int().min(1),
    }),

    REJECT_BILL: z.object({
        reason: z.string().min(1).max(500),
    }),
};

const adminRewardRouter = Router();

// All routes require admin authentication
adminRewardRouter.use(authenticate, requireAdmin);

// ─── GET /api/admin/reward-config ────────────────────────────────────────────
adminRewardRouter.get(
    '/reward-config',
    async function (_req: Request, res: Response, next: NextFunction) {
        const result = await RewardConfigRepository.getAllTiers();
        result.match(
            (data) => res.json(successResponse(data, 'Reward tiers fetched')),
            (error) => next(error)
        );
    }
);

// ─── PUT /api/admin/reward-config/:id ────────────────────────────────────────
adminRewardRouter.put(
    '/reward-config/:id',
    validateRequest({ params: SCHEMA.TIER_ID, body: SCHEMA.UPDATE_TIER }),
    async function (req: Request, res: Response, next: NextFunction) {
        const body = SCHEMA.UPDATE_TIER.parse(req.body);
        const result = await RewardConfigRepository.updateTier(Number(req.params.id), body);
        result.match(
            (data) => res.json(successResponse(data, 'Reward tier updated')),
            (error) => next(error)
        );
    }
);

// ─── GET /api/admin/upload-limits ────────────────────────────────────────────
adminRewardRouter.get(
    '/upload-limits',
    async function (_req: Request, res: Response, next: NextFunction) {
        const result = await RewardConfigRepository.getUploadLimits();
        result.match(
            (data) => res.json(successResponse(data, 'Upload limits fetched')),
            (error) => next(error)
        );
    }
);

// ─── PUT /api/admin/upload-limits ────────────────────────────────────────────
adminRewardRouter.put(
    '/upload-limits',
    validateRequest({ body: SCHEMA.UPDATE_LIMITS }),
    async function (req: Request, res: Response, next: NextFunction) {
        const body = SCHEMA.UPDATE_LIMITS.parse(req.body);
        const result = await RewardConfigRepository.updateUploadLimits(body);
        result.match(
            (data) => res.json(successResponse(data, 'Upload limits updated')),
            (error) => next(error)
        );
    }
);

// ─── GET /api/admin/bills ─────────────────────────────────────────────────────
adminRewardRouter.get(
    '/bills',
    validateRequest({ query: SCHEMA.BILL_LIST }),
    async function (req: Request, res: Response, next: NextFunction) {
        const query = SCHEMA.BILL_LIST.parse(req.query);
        const result = await adminListBills(query.limit, query.before, query.status);
        result.match(
            (data) => res.json(successResponse(data, 'Bills fetched')),
            (error) => next(error)
        );
    }
);

// ─── PATCH /api/admin/bills/:id/approve ──────────────────────────────────────
adminRewardRouter.patch(
    '/bills/:id/approve',
    validateRequest({ params: SCHEMA.BILL_ID }),
    async function (req: Request, res: Response, next: NextFunction) {
        const result = await adminApproveBill(Number(req.params.id));
        result.match(
            (data) => res.json(successResponse(data, 'Bill approved and reward assigned')),
            (error) => next(error)
        );
    }
);

// ─── PATCH /api/admin/bills/:id/reject ───────────────────────────────────────
adminRewardRouter.patch(
    '/bills/:id/reject',
    validateRequest({ params: SCHEMA.BILL_ID, body: SCHEMA.REJECT_BILL }),
    async function (req: Request, res: Response, next: NextFunction) {
        const body = SCHEMA.REJECT_BILL.parse(req.body);
        const result = await adminRejectBill(Number(req.params.id), body.reason);
        result.match(
            (data) => res.json(successResponse(data, 'Bill rejected')),
            (error) => next(error)
        );
    }
);

adminRewardRouter.use(errorHandler);
export default adminRewardRouter;
