import { Router, Request, Response, NextFunction } from 'express';
import z from 'zod';
import { authenticate, requireAuth } from '../middleware/auth.middleware.ts';
import validateRequest from '../middleware/validate-request.middleware.ts';
import { authLimiter } from '../middleware/ratelimit.middleware.ts';
import { errorHandler } from '../middleware/error.middleware.ts';
import { successResponse } from '../utils/response.ts';
import { verifyOtp, onboardUser, getMe, refreshAccessToken, sendOtp, verifyOtpDirect } from '../controller/auth.controller.ts';
import { USER_GENDERS } from '../models/user.model.ts';

const SCHEMA = {
    SEND_OTP: z.object({
        phone: z.string().min(10).max(15).regex(/^\d+$/, 'Phone must be digits only'),
    }),
    VERIFY_OTP_DIRECT: z.object({
        phone: z.string().min(10).max(15).regex(/^\d+$/, 'Phone must be digits only'),
        otp:   z.string().length(4).regex(/^\d{4}$/, 'OTP must be 4 digits'),
    }),
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

// ─── POST /api/auth/send-otp ──────────────────────────────────────────────────
// Sends OTP via MSG91 REST API. Works without the native SDK (Expo Go compatible).
authRouter.post(
    '/send-otp',
    authLimiter,
    validateRequest({ body: SCHEMA.SEND_OTP }),
    async function (req: Request, res: Response, next: NextFunction) {
        const { phone }: z.infer<typeof SCHEMA.SEND_OTP> = req.body;
        const result = await sendOtp(phone);
        result.match(
            (data) => res.json(successResponse(data, 'OTP sent successfully')),
            (error) => next(error)
        );
    }
);

// ─── POST /api/auth/verify-otp ────────────────────────────────────────────────
// Verifies OTP via MSG91 REST API, then finds/creates user. No native SDK needed.
authRouter.post(
    '/verify-otp',
    authLimiter,
    validateRequest({ body: SCHEMA.VERIFY_OTP_DIRECT }),
    async function (req: Request, res: Response, next: NextFunction) {
        const { phone, otp }: z.infer<typeof SCHEMA.VERIFY_OTP_DIRECT> = req.body;
        const result = await verifyOtpDirect(phone, otp);
        result.match(
            (data) => res.json(successResponse(data, 'OTP verified successfully')),
            (error) => next(error)
        );
    }
);

// ─── POST /api/auth/verify ────────────────────────────────────────────────────
// Legacy widget flow — kept for future dev-build support.
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

authRouter.use(errorHandler);
export default authRouter;
