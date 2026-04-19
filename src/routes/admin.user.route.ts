import { Router, Request, Response, NextFunction } from 'express';
import z from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.ts';
import validateRequest from '../middleware/validate-request.middleware.ts';
import { errorHandler } from '../middleware/error.middleware.ts';
import { successResponse } from '../utils/response.ts';
import { listAdminUsers, toggleUserStatus } from '../controller/admin.user.controller.ts';

const SCHEMA = {
    LIST: z.object({
        page:   z.coerce.number().int().min(1).default(1),
        limit:  z.coerce.number().int().min(1).max(100).default(20),
        filter: z.enum(['all', 'active', 'blocked']).default('all'),
    }),

    USER_ID: z.object({
        id: z.coerce.number().int().min(1),
    }),

    SET_STATUS: z.object({
        is_active: z.boolean(),
    }),
};

const adminUserRouter = Router();

adminUserRouter.use(authenticate, requireAdmin);

// GET /api/admin/users
adminUserRouter.get(
    '/users',
    validateRequest({ query: SCHEMA.LIST }),
    async function (req: Request, res: Response, next: NextFunction) {
        const query = SCHEMA.LIST.parse(req.query);
        const result = await listAdminUsers(query.page, query.limit, query.filter);
        result.match(
            (data) => res.json(successResponse(data, 'Users fetched')),
            (error) => next(error)
        );
    }
);

// PATCH /api/admin/users/:id/status
adminUserRouter.patch(
    '/users/:id/status',
    validateRequest({ params: SCHEMA.USER_ID, body: SCHEMA.SET_STATUS }),
    async function (req: Request, res: Response, next: NextFunction) {
        const { id } = SCHEMA.USER_ID.parse(req.params);
        const { is_active } = SCHEMA.SET_STATUS.parse(req.body);
        const result = await toggleUserStatus(id, is_active);
        result.match(
            (data) => res.json(successResponse(data, `User ${is_active ? 'unblocked' : 'blocked'} successfully`)),
            (error) => next(error)
        );
    }
);

adminUserRouter.use(errorHandler);
export default adminUserRouter;
