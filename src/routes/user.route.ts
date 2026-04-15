import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireAuth } from '../middleware/auth.middleware.ts';
import { errorHandler } from '../middleware/error.middleware.ts';
import { successResponse } from '../utils/response.ts';
import { getMyProfileSummary, getWalletSummary, updateMyProfile, requestEmailChange, verifyEmailChange } from '../controller/user.controller.ts';
import { USER_GENDERS } from '../models/user.model.ts';
import { BannerRepository } from '../repositories/banner.repository.ts';
import { toBannerView } from '../models/banner.model.ts';

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

// ─── PATCH /api/users/me ─────────────────────────────────────────────────────
userRouter.patch(
    '/me',
    authenticate,
    requireAuth,
    async function (_req: Request, res: Response, next: NextFunction) {
        const { name, phone, gender, upi_id } = _req.body as Record<string, unknown>;

        const data: Record<string, unknown> = {};
        if (name   !== undefined) data.name   = typeof name === 'string'   ? name.trim()   : null;
        if (phone  !== undefined) data.phone  = typeof phone === 'string'  ? phone.trim()  : null;
        if (upi_id !== undefined) data.upi_id = typeof upi_id === 'string' ? upi_id.trim() : null;
        if (gender !== undefined) {
            data.gender = (USER_GENDERS as readonly string[]).includes(gender as string)
                ? gender
                : null;
        }

        const result = await updateMyProfile(_req.user!.id, data);
        result.match(
            (user) => res.json(successResponse(user, 'Profile updated successfully')),
            (error) => next(error)
        );
    }
);

// ─── POST /api/users/me/email/request ────────────────────────────────────────
userRouter.post(
    '/me/email/request',
    authenticate,
    requireAuth,
    async function (_req: Request, res: Response, next: NextFunction) {
        const { new_email } = _req.body as { new_email?: string };
        if (!new_email || typeof new_email !== 'string') {
            return next({ statusCode: 400, message: 'new_email is required' });
        }
        const result = await requestEmailChange(_req.user!.id, new_email.trim());
        result.match(
            (data) => res.json(successResponse(data, data.message)),
            (error) => next(error)
        );
    }
);

// ─── POST /api/users/me/email/verify ─────────────────────────────────────────
userRouter.post(
    '/me/email/verify',
    authenticate,
    requireAuth,
    async function (_req: Request, res: Response, next: NextFunction) {
        const { otp } = _req.body as { otp?: string };
        if (!otp || typeof otp !== 'string') {
            return next({ statusCode: 400, message: 'otp is required' });
        }
        const result = await verifyEmailChange(_req.user!.id, otp.trim());
        result.match(
            (data) => res.json(successResponse(data, 'Email updated successfully')),
            (error) => next(error)
        );
    }
);

// ─── GET /api/users/banners ───────────────────────────────────────────────────
// Returns active banners for the home screen slider. No auth required.
userRouter.get(
    '/banners',
    async function (_req: Request, res: Response, next: NextFunction) {
        const result = await BannerRepository.findActive();
        result.match(
            (banners) => res.json(successResponse(banners.map(toBannerView), 'Banners fetched')),
            (error)   => next(error),
        );
    },
);

userRouter.use(errorHandler);
export default userRouter;
