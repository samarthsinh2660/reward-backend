import bcrypt from 'bcryptjs';
import { err, ok, Result } from 'neverthrow';
import { ERRORS, RequestError } from '../utils/error.ts';
import { UserRepository } from '../repositories/user.repository.ts';
import { UserView, OnboardUserData, toUserView } from '../models/user.model.ts';
import { createAuthToken, createRefreshToken, decodeRefreshToken, TokenData } from '../utils/jwt.ts';
import { LoginResponse } from '../types/login.ts';
import { createLogger } from '../utils/logger.ts';
import { sendOtpEmail } from '../services/email.service.ts';
import { OTP_EXPIRY_SECONDS, OTP_MAX_ATTEMPTS, NODE_ENV } from '../config/env.ts';
import { OtpEntry, SendOtpResponse, RefreshTokenResponse } from '../models/auth.model.ts';

const logger = createLogger('@auth.controller');

const REFERRAL_COINS = 50;

// ─── In-memory OTP store ──────────────────────────────────────────────────────
const otpStore = new Map<string, OtpEntry>();

function generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateReferralCode(userId: number): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return `${code}${userId}`;
}

// ─── POST /api/auth/send-otp ──────────────────────────────────────────────────

export const sendOtp = async (
    email: string
): Promise<Result<SendOtpResponse, RequestError>> => {
    try {
        const code = generateOtp();
        const expiresAt = Date.now() + OTP_EXPIRY_SECONDS * 1000;

        otpStore.set(email.toLowerCase(), { code, expiresAt, attempts: 0 });

        if (NODE_ENV !== 'production') {
            logger.info(`[DEV] OTP for ${email}: ${code}`);
        }

        try {
            await sendOtpEmail(email, code);
        } catch (emailErr) {
            logger.error('Failed to send OTP email', emailErr as Error);
            // In dev mode, OTP is logged — don't fail the request
            if (NODE_ENV === 'production') return err(ERRORS.OTP_SEND_FAILED);
        }

        return ok({ message: 'OTP sent to your email' });
    } catch (e) {
        logger.error('sendOtp error', e as Error);
        return err(ERRORS.OTP_SEND_FAILED);
    }
};

// ─── POST /api/auth/verify-otp ────────────────────────────────────────────────

export const verifyOtpDirect = async (
    email: string,
    otp: string
): Promise<Result<LoginResponse<UserView>, RequestError>> => {
    const key = email.toLowerCase();
    const entry = otpStore.get(key);

    if (!entry) return err(ERRORS.INVALID_OTP);
    if (Date.now() > entry.expiresAt) {
        otpStore.delete(key);
        return err(ERRORS.INVALID_OTP);
    }
    if (entry.attempts + 1 > OTP_MAX_ATTEMPTS) {
        otpStore.delete(key);
        return err(ERRORS.INVALID_OTP);
    }
    if (entry.code !== otp) {
        otpStore.set(key, { ...entry, attempts: entry.attempts + 1 });
        return err(ERRORS.INVALID_OTP);
    }

    otpStore.delete(key);

    let userResult = await UserRepository.findByEmail(key);
    if (userResult.isErr()) return err(userResult.error);

    let user = userResult.value;
    if (user && user.is_active === 0) return err(ERRORS.USER_BANNED);

    if (!user) {
        const created = await UserRepository.create(key);
        if (created.isErr()) return err(created.error);
        user = created.value;
    }

    const tokenData: TokenData = { id: user.id, is_admin: user.role === 'admin', email: user.email };
    const token         = createAuthToken(tokenData);
    const refresh_token = createRefreshToken(tokenData);

    logger.info(`User ${user.id} authenticated via email OTP (${key})`);
    const userView = toUserView(user);
    return ok({ token, refresh_token, email: userView.email, is_onboarded: userView.is_onboarded, user: userView });
};

// ─── POST /api/auth/onboard ───────────────────────────────────────────────────

export const onboardUser = async (
    userId: number,
    data: OnboardUserData
): Promise<Result<UserView, RequestError>> => {
    const existing = await UserRepository.findById(userId);
    if (existing.isErr()) return err(existing.error);

    if (existing.value.is_onboarded === 1) {
        return err(ERRORS.ALREADY_ONBOARDED);
    }

    let referrerId: number | null = null;
    if (data.referral_code_used) {
        const referrer = await UserRepository.findByReferralCode(data.referral_code_used);
        if (referrer.isErr()) return err(referrer.error);
        if (!referrer.value) return err(ERRORS.INVALID_REFERRAL_CODE);
        if (referrer.value.id === userId) return err(ERRORS.SELF_REFERRAL);
        referrerId = referrer.value.id;
    }

    const referralCode = generateReferralCode(userId);
    const updated = await UserRepository.onboard(userId, data, referralCode);
    if (updated.isErr()) return err(updated.error);

    if (referrerId) {
        const coinResult = await UserRepository.addCoins(referrerId, REFERRAL_COINS);
        if (coinResult.isErr()) {
            logger.error(`Failed to award referral coins to user ${referrerId}`);
        }
    }

    logger.info(`User ${userId} onboarded successfully`);
    return ok(toUserView(updated.value));
};

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

export const getMe = async (
    userId: number
): Promise<Result<UserView, RequestError>> => {
    const user = await UserRepository.findById(userId);
    if (user.isErr()) return err(user.error);
    return ok(toUserView(user.value));
};

// ─── POST /api/admin/auth/login ───────────────────────────────────────────────

export const loginAdmin = async (
    email: string,
    password: string
): Promise<Result<LoginResponse<UserView>, RequestError>> => {
    const userResult = await UserRepository.findByEmailWithPassword(email);
    if (userResult.isErr()) return err(userResult.error);

    const user = userResult.value;
    if (!user) return err(ERRORS.INVALID_CREDENTIALS);
    if (user.role !== 'admin') return err(ERRORS.NOT_AN_ADMIN);
    if (user.is_active === 0) return err(ERRORS.USER_BANNED);
    if (!user.password_hash) return err(ERRORS.NO_PASSWORD_SET);

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return err(ERRORS.INVALID_CREDENTIALS);

    const tokenData: TokenData = { id: user.id, is_admin: true, email: user.email };
    const token         = createAuthToken(tokenData);
    const refresh_token = createRefreshToken(tokenData);

    logger.info(`Admin ${user.id} logged in`);
    const userView = toUserView(user);
    return ok({ token, refresh_token, email: userView.email, is_onboarded: userView.is_onboarded, user: userView });
};

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────

export const refreshAccessToken = async (
    refreshToken: string
): Promise<Result<RefreshTokenResponse, RequestError>> => {
    try {
        const decoded = decodeRefreshToken(refreshToken);
        const newToken = createAuthToken({ id: decoded.id, is_admin: decoded.is_admin, email: decoded.email });
        return ok({ token: newToken });
    } catch {
        return err(ERRORS.INVALID_REFRESH_TOKEN);
    }
};
