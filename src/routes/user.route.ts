import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireAuth } from '../middleware/auth.middleware.ts';
import { errorHandler } from '../middleware/error.middleware.ts';
import { successResponse } from '../utils/response.ts';
import { getMyProfileSummary, getWalletSummary } from '../controller/user.controller.ts';

const userRouter = Router();

// ─── GET /api/users/me/summary ───────────────────────────────────────────────
userRouter.get(
    '/me/summary',
    authenticate,
    requireAuth,
    async function (_req: Request, res: Response, next: NextFunction) {
        const result = await getMyProfileSummary(_req.user!.id);
        result.match(
            (data) => res.json(successResponse(data, 'Profile summary fetched successfully')),
            (error) => next(error)
        );
    }
);

// ─── GET /api/users/me/wallet ────────────────────────────────────────────────
userRouter.get(
    '/me/wallet',
    authenticate,
    requireAuth,
    async function (_req: Request, res: Response, next: NextFunction) {
        const result = await getWalletSummary(_req.user!.id);
        result.match(
            (data) => res.json(successResponse(data, 'Wallet summary fetched')),
            (error) => next(error)
        );
    }
);

userRouter.use(errorHandler);
export default userRouter;
