import bcrypt from 'bcryptjs';
import { err, ok, Result } from 'neverthrow';
import { ERRORS, RequestError } from '../utils/error.ts';
import { UserRepository } from '../repositories/user.repository.ts';
import { UserView, OnboardUserData, toUserView } from '../models/user.model.ts';
import { createAuthToken, createRefreshToken, decodeRefreshToken, TokenData } from '../utils/jwt.ts';
import { LoginResponse } from '../types/login.ts';
import { createLogger } from '../utils/logger.ts';
import { verifyMsg91Token } from '../services/msg91.service.ts';

const logger = createLogger('@auth.controller');

const REFERRAL_COINS = 50; // coins awarded to referrer when their referral completes onboarding

function generateReferralCode(userId: number): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0,O,1,I)
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return `${code}${userId}`;
}

// Called after MSG91 OTP is verified client-side.
// Validates the MSG91 access token server-side, then finds or creates the user.
export const verifyOtp = async (
    phone: string,
    msg91AccessToken: string
): Promise<Result<LoginResponse<UserView>, RequestError>> => {
    // Verify with MSG91 API — rejects if token is forged or already used
    const tokenValid = await verifyMsg91Token(msg91AccessToken);
    if (!tokenValid) return err(ERRORS.INVALID_OTP);

    // Normalize phone: ensure it has country code prefix stored consistently
    const normalizedPhone = phone.startsWith('+') ? phone.slice(1) : phone;

    let userResult = await UserRepository.findByPhone(normalizedPhone);
    if (userResult.isErr()) return err(userResult.error);

    let user = userResult.value;

    if (user && user.is_active === 0) {
        return err(ERRORS.USER_BANNED);
    }

    // New user — create record
    if (!user) {
        const created = await UserRepository.create(normalizedPhone);
        if (created.isErr()) return err(created.error);
        user = created.value;
    }

    const tokenData: TokenData = {
        id: user.id,
        is_admin: user.role === 'admin',
        phone: user.phone,
    };

    const token = createAuthToken(tokenData);
    const refresh_token = createRefreshToken(tokenData);

    logger.info(`User ${user.id} authenticated (phone: ${normalizedPhone})`);

    return ok({ ...toUserView(user), token, refresh_token });
};

// Called once after OTP verify when is_onboarded is false.
export const onboardUser = async (
    userId: number,
    data: OnboardUserData
): Promise<Result<UserView, RequestError>> => {
    const existing = await UserRepository.findById(userId);
    if (existing.isErr()) return err(existing.error);

    if (existing.value.is_onboarded === 1) {
        return err(ERRORS.ALREADY_ONBOARDED);
    }

    // Validate referral code if provided
    let referrerId: number | null = null;
    if (data.referral_code_used) {
        const referrer = await UserRepository.findByReferralCode(data.referral_code_used);
        if (referrer.isErr()) return err(referrer.error);

        if (!referrer.value) {
            return err(ERRORS.INVALID_REFERRAL_CODE);
        }
        if (referrer.value.id === userId) {
            return err(ERRORS.SELF_REFERRAL);
        }
        referrerId = referrer.value.id;
    }

    const referralCode = generateReferralCode(userId);

    const updated = await UserRepository.onboard(userId, data, referralCode);
    if (updated.isErr()) return err(updated.error);

    // Award coins to referrer after successful onboard
    if (referrerId) {
        const coinResult = await UserRepository.addCoins(referrerId, REFERRAL_COINS);
        if (coinResult.isErr()) {
            // Non-fatal — log and continue. User is already onboarded.
            logger.error(`Failed to award referral coins to user ${referrerId}`);
        }
    }

    logger.info(`User ${userId} onboarded successfully`);
    return ok(toUserView(updated.value));
};

// GET /me — returns the authenticated user's profile
export const getMe = async (
    userId: number
): Promise<Result<UserView, RequestError>> => {
    const user = await UserRepository.findById(userId);
    if (user.isErr()) return err(user.error);
    return ok(toUserView(user.value));
};

// POST /admin/login — admin login with phone + password (web panel, no OTP SDK)
export const loginAdmin = async (
    phone: string,
    password: string
): Promise<Result<LoginResponse<UserView>, RequestError>> => {
    const userResult = await UserRepository.findByPhoneWithPassword(phone);
    if (userResult.isErr()) return err(userResult.error);

    const user = userResult.value;
    if (!user) return err(ERRORS.INVALID_CREDENTIALS);
    if (user.role !== 'admin') return err(ERRORS.NOT_AN_ADMIN);
    if (user.is_active === 0) return err(ERRORS.USER_BANNED);
    if (!user.password_hash) return err(ERRORS.NO_PASSWORD_SET);

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return err(ERRORS.INVALID_CREDENTIALS);

    const tokenData: TokenData = {
        id: user.id,
        is_admin: true,
        phone: user.phone,
    };

    const token = createAuthToken(tokenData);
    const refresh_token = createRefreshToken(tokenData);

    logger.info(`Admin ${user.id} logged in`);
    return ok({ ...toUserView(user), token, refresh_token });
};

// POST /refresh — issues a new access token from a valid refresh token
export const refreshAccessToken = async (
    refreshToken: string
): Promise<Result<{ token: string }, RequestError>> => {
    try {
        const decoded = decodeRefreshToken(refreshToken);
        const newToken = createAuthToken({
            id: decoded.id,
            is_admin: decoded.is_admin,
            phone: decoded.phone,
        });
        return ok({ token: newToken });
    } catch {
        return err(ERRORS.INVALID_REFRESH_TOKEN);
    }
};
