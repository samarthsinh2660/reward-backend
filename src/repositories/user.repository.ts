import { err, ok, Result } from 'neverthrow';
import { ResultSetHeader } from 'mysql2/promise';
import { db } from '../database/db.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';
import {
    User,
    OnboardUserData,
    USER_TABLE,
    UserProfileSummaryStats,
    createEmptyUserBillStatusCounts,
} from '../models/user.model.ts';
import { BILL_TABLE } from '../models/bill.model.ts';
import { CASHBACK_TRANSACTIONS_TABLE } from '../models/cashback_transaction.model.ts';

const logger = createLogger('@user.repository');

const SELECT_SAFE = `
    SELECT id, name, email, phone, gender, role, upi_id, wallet_balance,
           is_onboarded, is_active, pity_counter, referral_code, referred_by,
           coin_balance, created_at, updated_at
    FROM ${USER_TABLE}`;

export interface IUserRepository {
    findByEmail(email: string): Promise<Result<User | null, RequestError>>;
    findByEmailWithPassword(email: string): Promise<Result<User | null, RequestError>>;
    findById(id: number): Promise<Result<User, RequestError>>;
    findByReferralCode(code: string): Promise<Result<User | null, RequestError>>;
    create(email: string): Promise<Result<User, RequestError>>;
    onboard(id: number, data: OnboardUserData, generatedReferralCode: string): Promise<Result<User, RequestError>>;
    getProfileSummaryStats(id: number): Promise<Result<UserProfileSummaryStats, RequestError>>;
    addCoins(id: number, coins: number): Promise<Result<void, RequestError>>;
    incrementPityCounter(id: number): Promise<Result<void, RequestError>>;
    resetPityCounter(id: number): Promise<Result<void, RequestError>>;
}

class UserRepositoryImpl implements IUserRepository {

    async findByEmail(email: string): Promise<Result<User | null, RequestError>> {
        try {
            const [rows] = await db.query<User[]>(
                `${SELECT_SAFE} WHERE email = ?`,
                [email]
            );
            return ok(rows.length > 0 ? rows[0] : null);
        } catch (error) {
            logger.error('Error finding user by email', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async findByEmailWithPassword(email: string): Promise<Result<User | null, RequestError>> {
        try {
            const [rows] = await db.query<User[]>(
                `SELECT id, name, email, phone, gender, role, password_hash, upi_id, wallet_balance,
                        is_onboarded, is_active, pity_counter, referral_code, referred_by,
                        coin_balance, created_at, updated_at
                 FROM ${USER_TABLE} WHERE email = ?`,
                [email]
            );
            return ok(rows.length > 0 ? rows[0] : null);
        } catch (error) {
            logger.error('Error finding user by email (with password)', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async findById(id: number): Promise<Result<User, RequestError>> {
        try {
            const [rows] = await db.query<User[]>(
                `${SELECT_SAFE} WHERE id = ?`,
                [id]
            );
            if (rows.length === 0) return err(ERRORS.USER_NOT_FOUND);
            return ok(rows[0]);
        } catch (error) {
            logger.error('Error finding user by id', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async findByReferralCode(code: string): Promise<Result<User | null, RequestError>> {
        try {
            const [rows] = await db.query<User[]>(
                `SELECT id, name, email, role, referral_code, coin_balance FROM ${USER_TABLE} WHERE referral_code = ?`,
                [code]
            );
            return ok(rows.length > 0 ? rows[0] : null);
        } catch (error) {
            logger.error('Error finding user by referral code', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async create(email: string): Promise<Result<User, RequestError>> {
        try {
            const [result] = await db.query<ResultSetHeader>(
                `INSERT INTO ${USER_TABLE} (email) VALUES (?)`,
                [email]
            );
            return await this.findById(result.insertId);
        } catch (error) {
            logger.error('Error creating user', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async onboard(
        id: number,
        data: OnboardUserData,
        generatedReferralCode: string
    ): Promise<Result<User, RequestError>> {
        try {
            await db.query(
                `UPDATE ${USER_TABLE}
                 SET name = ?, gender = ?, is_onboarded = TRUE,
                     referral_code = ?, referred_by = ?
                 WHERE id = ?`,
                [
                    data.name,
                    data.gender ?? null,
                    generatedReferralCode,
                    data.referral_code_used ?? null,
                    id,
                ]
            );
            return await this.findById(id);
        } catch (error) {
            logger.error('Error onboarding user', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getProfileSummaryStats(id: number): Promise<Result<UserProfileSummaryStats, RequestError>> {
        try {
            const [rows] = await db.query<any[]>(
                `SELECT
                    COUNT(*) AS total_bills_uploaded,
                    SUM(status = 'queued') AS queued_count,
                    SUM(status = 'processing') AS processing_count,
                    SUM(status = 'verified') AS verified_count,
                    SUM(status = 'pending') AS pending_count,
                    SUM(status = 'rejected') AS rejected_count,
                    SUM(status = 'failed') AS failed_count,
                    COALESCE(SUM(CASE WHEN chest_opened = TRUE THEN coin_reward ELSE 0 END), 0) AS total_coins_earned
                 FROM ${BILL_TABLE}
                 WHERE user_id = ?`,
                [id]
            );

            const [cashbackRows] = await db.query<any[]>(
                `SELECT COALESCE(SUM(amount), 0) AS total_cashback_earned
                 FROM ${CASHBACK_TRANSACTIONS_TABLE}
                 WHERE user_id = ? AND type = 'credit'`,
                [id]
            );

            const billRow = rows[0] ?? {};
            const cashbackRow = cashbackRows[0] ?? {};
            const statusCounts = createEmptyUserBillStatusCounts();

            statusCounts.queued = Number(billRow.queued_count ?? 0);
            statusCounts.processing = Number(billRow.processing_count ?? 0);
            statusCounts.verified = Number(billRow.verified_count ?? 0);
            statusCounts.pending = Number(billRow.pending_count ?? 0);
            statusCounts.rejected = Number(billRow.rejected_count ?? 0);
            statusCounts.failed = Number(billRow.failed_count ?? 0);

            return ok({
                total_cashback_earned: Number(cashbackRow.total_cashback_earned ?? 0),
                total_coins_earned: Number(billRow.total_coins_earned ?? 0),
                total_bills_uploaded: Number(billRow.total_bills_uploaded ?? 0),
                status_counts: statusCounts,
            });
        } catch (error) {
            logger.error('Error fetching user profile summary stats', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async addCoins(id: number, coins: number): Promise<Result<void, RequestError>> {
        try {
            await db.query(
                `UPDATE ${USER_TABLE} SET coin_balance = coin_balance + ? WHERE id = ?`,
                [coins, id]
            );
            return ok(undefined);
        } catch (error) {
            logger.error('Error adding coins to user', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async incrementPityCounter(id: number): Promise<Result<void, RequestError>> {
        try {
            await db.query(
                `UPDATE ${USER_TABLE} SET pity_counter = pity_counter + 1 WHERE id = ?`,
                [id]
            );
            return ok(undefined);
        } catch (error) {
            logger.error('Error incrementing pity counter', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async resetPityCounter(id: number): Promise<Result<void, RequestError>> {
        try {
            await db.query(
                `UPDATE ${USER_TABLE} SET pity_counter = 0 WHERE id = ?`,
                [id]
            );
            return ok(undefined);
        } catch (error) {
            logger.error('Error resetting pity counter', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }
}

export const UserRepository = new UserRepositoryImpl();
