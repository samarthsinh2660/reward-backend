import { Router, Request, Response, NextFunction } from 'express';
import z from 'zod';
import { authenticate, requireAuth } from '../middleware/auth.middleware.ts';
import validateRequest from '../middleware/validate-request.middleware.ts';
import { authLimiter } from '../middleware/ratelimit.middleware.ts';
import { errorHandler } from '../middleware/error.middleware.ts';
import { successResponse } from '../utils/response.ts';
import { verifyOtp, onboardUser, getMe, refreshAccessToken } from '../controller/auth.controller.ts';
import { USER_GENDERS } from '../models/user.model.ts';

const SCHEMA = {
    VERIFY_OTP: z.object({
        // Phone must include country code, no + (e.g. 919876543210)
        phone:        z.string().min(10).max(15).regex(/^\d+$/, 'Phone must be digits only'),
        // JWT access token returned by MSG91 widget after OTP is verified on device
        access_token: z.string().min(10),
    }),
    ONBOARD: z.object({
        name:               z.string().min(1).max(150).trim(),
        email:              z.string().email().optional(),
        gender:             z.enum(USER_GENDERS).optional(),
        referral_code_used: z.string().min(1).max(20).optional(),
    }),
    REFRESH: z.object({
        refresh_token: z.string().min(1),
    }),
};

const authRouter = Router();

// ─── POST /api/auth/verify ────────────────────────────────────────────────────
// Called by frontend after MSG91 OTP verified successfully on device.
// Finds or creates the user, returns JWT + user profile.
authRouter.post(
    '/verify',
    authLimiter,
    validateRequest({ body: SCHEMA.VERIFY_OTP }),
    async function (req: Request, res: Response, next: NextFunction) {
        const body: z.infer<typeof SCHEMA.VERIFY_OTP> = req.body;
        const result = await verifyOtp(body.phone, body.access_token);
        result.match(
            (data) => res.json(successResponse(data, 'OTP verified successfully')),
            (error) => next(error)
        );
    }
);

// ─── POST /api/auth/onboard ───────────────────────────────────────────────────
// Called once — on new user's first login, after verify, when is_onboarded is false.
authRouter.post(
    '/onboard',
    authenticate,
    requireAuth,
    validateRequest({ body: SCHEMA.ONBOARD }),
    async function (req: Request, res: Response, next: NextFunction) {
        const body: z.infer<typeof SCHEMA.ONBOARD> = req.body;
        const result = await onboardUser(req.user!.id, {
            name:               body.name,
            email:              body.email,
            gender:             body.gender,
            referral_code_used: body.referral_code_used,
        });
        result.match(
            (data) => res.json(successResponse(data, 'Onboarding complete')),
            (error) => next(error)
        );
    }
);

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
authRouter.get(
    '/me',
    authenticate,
    requireAuth,
    async function (req: Request, res: Response, next: NextFunction) {
        const result = await getMe(req.user!.id);
        result.match(
            (data) => res.json(successResponse(data, 'Profile fetched successfully')),
            (error) => next(error)
        );
    }
);

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
authRouter.post(
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
authRouter.use(errorHandler);

export default authRouter;
