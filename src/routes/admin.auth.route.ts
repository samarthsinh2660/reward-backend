import { Router, Request, Response, NextFunction } from 'express';
import z from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.ts';
import validateRequest from '../middleware/validate-request.middleware.ts';
import { authLimiter } from '../middleware/ratelimit.middleware.ts';
import { errorHandler } from '../middleware/error.middleware.ts';
import { successResponse } from '../utils/response.ts';
import { loginAdmin, getMe, refreshAccessToken, setupAdmin } from '../controller/auth.controller.ts';

const SCHEMA = {
    LOGIN: z.object({
        email: z.string().email('Enter a valid email address'),
        password: z.string().min(6),
    }),
    SETUP: z.object({
        name:     z.string().min(1).max(150),
        email:    z.string().email(),
        password: z.string().min(8),
    }),
    REFRESH: z.object({
        refresh_token: z.string().min(1),
    }),
};

const adminAuthRouter = Router();

// ─── POST /api/admin/auth/setup ──────────────────────────────────────────────
// Open — no auth required. Only succeeds if zero admins exist in the DB.
adminAuthRouter.post(
    '/setup',
    authLimiter,
    validateRequest({ body: SCHEMA.SETUP }),
    async function (req: Request, res: Response, next: NextFunction) {
        const body: z.infer<typeof SCHEMA.SETUP> = req.body;
        const result = await setupAdmin(body.name, body.email, body.password);
        result.match(
            (data) => res.status(201).json(successResponse(data, 'Admin account created')),
            (error) => next(error)
        );
    }
);

// ─── POST /api/admin/auth/login ───────────────────────────────────────────────
adminAuthRouter.post(
    '/login',
    authLimiter,
    validateRequest({ body: SCHEMA.LOGIN }),
    async function (req: Request, res: Response, next: NextFunction) {
        const body: z.infer<typeof SCHEMA.LOGIN> = req.body;
        const result = await loginAdmin(body.email, body.password);
        result.match(
            (data) => res.json(successResponse(data, 'Admin login successful')),
            (error) => next(error)
        );
    }
);

// ─── GET /api/admin/auth/me ───────────────────────────────────────────────────
adminAuthRouter.get(
    '/me',
    authenticate,
    requireAdmin,
    async function (req: Request, res: Response, next: NextFunction) {
        const result = await getMe(req.user!.id);
        result.match(
            (data) => res.json(successResponse(data, 'Profile fetched successfully')),
            (error) => next(error)
        );
    }
);

// ─── POST /api/admin/auth/refresh ─────────────────────────────────────────────
adminAuthRouter.post(
    '/refresh',
    validateRequest({ body: SCHEMA.REFRESH }),
    async function (req: Request, res: Response, next: NextFunction) {
        const body: z.infer<typeof SCHEMA.REFRESH> = req.body;
        const result = await refreshAccessToken(body.refresh_token);
        result.match(
            (data) => res.json(successResponse(data, 'Token refreshed successfully')),
            (error) => next(error)
        );
    }
);

// Must be the last line of every route file
adminAuthRouter.use(errorHandler);

export default adminAuthRouter;
