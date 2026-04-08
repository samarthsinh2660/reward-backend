import { Router, Request, Response, NextFunction } from 'express';
import z from 'zod';
import { authenticate, requireAuth } from '../middleware/auth.middleware.ts';
import validateRequest from '../middleware/validate-request.middleware.ts';
import { authLimiter } from '../middleware/ratelimit.middleware.ts';
import { errorHandler } from '../middleware/error.middleware.ts';
import { successResponse } from '../utils/response.ts';
import { sendOtp, verifyOtpDirect, onboardUser, getMe, refreshAccessToken } from '../controller/auth.controller.ts';
import { USER_GENDERS } from '../models/user.model.ts';

const SCHEMA = {
    SEND_OTP: z.object({
        email: z.string().email('Enter a valid email address'),
    }),
    VERIFY_OTP: z.object({
        email: z.string().email('Enter a valid email address'),
        otp:   z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
    }),
    ONBOARD: z.object({
        name:               z.string().min(1).max(150).trim(),
        gender:             z.enum(USER_GENDERS).optional(),
        referral_code_used: z.string().min(1).max(20).optional(),
    }),
    REFRESH: z.object({
        refresh_token: z.string().min(1),
    }),
};

const authRouter = Router();

// ─── POST /api/auth/send-otp ──────────────────────────────────────────────────
authRouter.post(
    '/send-otp',
    authLimiter,
    validateRequest({ body: SCHEMA.SEND_OTP }),
    async function (req: Request, res: Response, next: NextFunction) {
        const { email }: z.infer<typeof SCHEMA.SEND_OTP> = req.body;
        const result = await sendOtp(email);
        result.match(
            (data) => res.json(successResponse(data, 'OTP sent to your email')),
            (error) => next(error)
        );
    }
);

// ─── POST /api/auth/verify-otp ────────────────────────────────────────────────
authRouter.post(
    '/verify-otp',
    authLimiter,
    validateRequest({ body: SCHEMA.VERIFY_OTP }),
    async function (req: Request, res: Response, next: NextFunction) {
        const { email, otp }: z.infer<typeof SCHEMA.VERIFY_OTP> = req.body;
        const result = await verifyOtpDirect(email, otp);
        result.match(
            (data) => res.json(successResponse(data, 'OTP verified successfully')),
            (error) => next(error)
        );
    }
);

// ─── POST /api/auth/onboard ───────────────────────────────────────────────────
authRouter.post(
    '/onboard',
    authenticate,
    requireAuth,
    validateRequest({ body: SCHEMA.ONBOARD }),
    async function (req: Request, res: Response, next: NextFunction) {
        const body: z.infer<typeof SCHEMA.ONBOARD> = req.body;
        const result = await onboardUser(req.user!.id, {
            name:               body.name,
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

authRouter.use(errorHandler);
export default authRouter;
