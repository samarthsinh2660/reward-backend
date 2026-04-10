import { err, ok, Result } from 'neverthrow';
import { UserRepository } from '../repositories/user.repository.ts';
import { CashbackTransactionRepository } from '../repositories/cashback_transaction.repository.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { generateOtp } from '../utils/otp.ts';
import { createLogger } from '../utils/logger.ts';
import { sendOtpEmail } from '../services/email.service.ts';
import { OTP_EXPIRY_SECONDS, NODE_ENV } from '../config/env.ts';
import {
    UserProfileSummaryView, UserView, WalletSummaryView,
    UpdateProfileData,
    toUserProfileSummaryView, toUserView,
} from '../models/user.model.ts';
import { CashbackTransaction } from '../models/cashback_transaction.model.ts';
import { EmailChangeEntry } from '../models/auth.model.ts';

const logger = createLogger('@user.controller');

// ── In-memory email-change OTP store (keyed by userId) ───────────────────────
const emailChangeStore = new Map<number, EmailChangeEntry>();

// ─── GET /api/users/me/summary ────────────────────────────────────────────────

export const getMyProfileSummary = async (
    userId: number
): Promise<Result<UserProfileSummaryView, RequestError>> => {
    const userResult = await UserRepository.findById(userId);
    if (userResult.isErr()) return err(userResult.error);

    const summaryResult = await UserRepository.getProfileSummaryStats(userId);
    if (summaryResult.isErr()) return err(summaryResult.error);

    return ok(toUserProfileSummaryView(userResult.value, summaryResult.value));
};

// ─── PATCH /api/users/me ──────────────────────────────────────────────────────

export const updateMyProfile = async (
    userId: number,
    data: UpdateProfileData
): Promise<Result<UserView, RequestError>> => {
    const result = await UserRepository.updateProfile(userId, data);
    if (result.isErr()) return err(result.error);
    return ok(toUserView(result.value));
};

// ─── POST /api/users/me/email/request ────────────────────────────────────────

export const requestEmailChange = async (
    userId: number,
    newEmail: string
): Promise<Result<{ message: string }, RequestError>> => {
    try {
        const existing = await UserRepository.findByEmail(newEmail.toLowerCase());
        if (existing.isErr()) return err(existing.error);
        if (existing.value && existing.value.id !== userId) return err(ERRORS.EMAIL_ALREADY_EXISTS);

        const code = generateOtp();
        emailChangeStore.set(userId, {
            newEmail:  newEmail.toLowerCase(),
            code,
            expiresAt: Date.now() + OTP_EXPIRY_SECONDS * 1000,
        });

        if (NODE_ENV !== 'production') {
            logger.info(`[DEV] Email-change OTP for user ${userId}: ${code}`);
        }

        try {
            await sendOtpEmail(newEmail, code);
        } catch (emailErr) {
            logger.error('Failed to send email-change OTP', emailErr as Error);
            if (NODE_ENV === 'production') return err(ERRORS.OTP_SEND_FAILED);
        }

        return ok({ message: 'OTP sent to new email' });
    } catch {
        return err(ERRORS.OTP_SEND_FAILED);
    }
};

// ─── POST /api/users/me/email/verify ─────────────────────────────────────────

export const verifyEmailChange = async (
    userId: number,
    otp: string
): Promise<Result<UserView, RequestError>> => {
    const entry = emailChangeStore.get(userId);
    if (!entry) return err(ERRORS.INVALID_OTP);

    if (Date.now() > entry.expiresAt) {
        emailChangeStore.delete(userId);
        return err(ERRORS.INVALID_OTP);
    }
    if (entry.code !== otp) return err(ERRORS.INVALID_OTP);

    emailChangeStore.delete(userId);

    const result = await UserRepository.updateEmail(userId, entry.newEmail);
    if (result.isErr()) return err(result.error);
    return ok(toUserView(result.value));
};

// ─── GET /api/users/me/wallet ─────────────────────────────────────────────────

export const getWalletSummary = async (
    userId: number
): Promise<Result<WalletSummaryView, RequestError>> => {
    const [userR, txR, dailyR, monthlyR] = await Promise.all([
        UserRepository.findById(userId),
        CashbackTransactionRepository.getByUserId(userId, 20),
        CashbackTransactionRepository.getDailyEarnings(userId, 30),
        CashbackTransactionRepository.getMonthlyTotal(userId),
    ]);

    if (userR.isErr())    return err(userR.error);
    if (txR.isErr())      return err(txR.error);
    if (dailyR.isErr())   return err(dailyR.error);
    if (monthlyR.isErr()) return err(monthlyR.error);

    const user = userR.value;

    return ok({
        wallet_balance: Number(user.wallet_balance),
        coin_balance:   Number(user.coin_balance),
        monthly_earned: monthlyR.value,
        recent_transactions: txR.value.map((t: CashbackTransaction) => ({
            id:          t.id,
            bill_id:     t.bill_id,
            amount:      Number(t.amount),
            type:        t.type,
            description: t.description,
            created_at:  t.created_at instanceof Date
                         ? t.created_at.toISOString()
                         : String(t.created_at),
        })),
        chart_data: dailyR.value,
    });
};
