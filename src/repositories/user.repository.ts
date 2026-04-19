import { err, ok, Result } from 'neverthrow';
import { ResultSetHeader } from 'mysql2/promise';
import { db } from '../database/db.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';
import {
    User,
    OnboardUserData,
    UpdateProfileData,
    USER_TABLE,
    UserProfileSummaryStats,
    AdminUserRow,
    createEmptyUserBillStatusCounts,
} from '../models/user.model.ts';
import { BILL_TABLE } from '../models/bill.model.ts';
import { CASHBACK_TRANSACTIONS_TABLE } from '../models/cashback_transaction.model.ts';
import { REFERRAL_TRANSACTIONS_TABLE } from '../models/referral_transaction.model.ts';

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
    updateProfile(id: number, data: UpdateProfileData): Promise<Result<User, RequestError>>;
    updateEmail(id: number, newEmail: string): Promise<Result<User, RequestError>>;
    getProfileSummaryStats(id: number): Promise<Result<UserProfileSummaryStats, RequestError>>;
    addCoins(id: number, coins: number): Promise<Result<void, RequestError>>;
    incrementPityCounter(id: number): Promise<Result<void, RequestError>>;
    resetPityCounter(id: number): Promise<Result<void, RequestError>>;
    insertReferralTransaction(referrerId: number, referredId: number, coinsAwarded: number): Promise<Result<void, RequestError>>;
    getAdminUsers(page: number, limit: number, filter: 'all' | 'active' | 'blocked'): Promise<Result<{ users: AdminUserRow[]; total: number }, RequestError>>;
    setUserActive(id: number, isActive: boolean): Promise<Result<void, RequestError>>;
    adminExists(): Promise<Result<boolean, RequestError>>;
    createAdmin(name: string, email: string, passwordHash: string): Promise<Result<User, RequestError>>;
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

    async updateProfile(id: number, data: UpdateProfileData): Promise<Result<User, RequestError>> {
        try {
            const fields: string[] = [];
            const values: unknown[] = [];

            if (data.name   !== undefined) { fields.push('name = ?');   values.push(data.name); }
            if (data.phone  !== undefined) { fields.push('phone = ?');  values.push(data.phone); }
            if (data.gender !== undefined) { fields.push('gender = ?'); values.push(data.gender); }
            if (data.upi_id !== undefined) { fields.push('upi_id = ?'); values.push(data.upi_id); }

            if (fields.length === 0) return await this.findById(id);

            values.push(id);
            await db.query(
                `UPDATE ${USER_TABLE} SET ${fields.join(', ')} WHERE id = ?`,
                values
            );
            return await this.findById(id);
        } catch (error) {
            logger.error('Error updating user profile', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async updateEmail(id: number, newEmail: string): Promise<Result<User, RequestError>> {
        try {
            const [existing] = await db.query<User[]>(
                `SELECT id FROM ${USER_TABLE} WHERE email = ?`, [newEmail.toLowerCase()]
            );
            if (existing.length > 0 && existing[0].id !== id) {
                return err(ERRORS.EMAIL_ALREADY_EXISTS);
            }
            await db.query(
                `UPDATE ${USER_TABLE} SET email = ? WHERE id = ?`,
                [newEmail.toLowerCase(), id]
            );
            return await this.findById(id);
        } catch (error) {
            logger.error('Error updating user email', error);
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

    async insertReferralTransaction(
        referrerId: number,
        referredId: number,
        coinsAwarded: number
    ): Promise<Result<void, RequestError>> {
        try {
            await db.query<ResultSetHeader>(
                `INSERT INTO ${REFERRAL_TRANSACTIONS_TABLE} (referrer_user_id, referred_user_id, coins_awarded) VALUES (?, ?, ?)`,
                [referrerId, referredId, coinsAwarded]
            );
            return ok(undefined);
        } catch (error) {
            logger.error('Error inserting referral transaction', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getAdminUsers(
        page: number,
        limit: number,
        filter: 'all' | 'active' | 'blocked'
    ): Promise<Result<{ users: AdminUserRow[]; total: number }, RequestError>> {
        try {
            const offset = (page - 1) * limit;
            const whereClause =
                filter === 'active'  ? 'WHERE u.is_active = 1' :
                filter === 'blocked' ? 'WHERE u.is_active = 0' :
                '';

            const [rows] = await db.query<any[]>(
                `SELECT
                    u.id, u.name, u.email,
                    u.is_active, u.created_at, u.wallet_balance,
                    COUNT(b.id)                                                         AS total_bills,
                    COALESCE(SUM(b.status = 'verified'), 0)                             AS verified_bills,
                    COALESCE(SUM(b.status = 'rejected'), 0)                             AS rejected_bills,
                    COALESCE(SUM(CASE WHEN b.status = 'verified' THEN b.reward_amount ELSE 0 END), 0) AS total_cashback,
                    COALESCE(MAX(b.fraud_score), 0)                                     AS max_fraud_score
                 FROM ${USER_TABLE} u
                 LEFT JOIN ${BILL_TABLE} b ON b.user_id = u.id
                 ${whereClause}
                 GROUP BY u.id
                 ORDER BY u.created_at DESC
                 LIMIT ? OFFSET ?`,
                [limit, offset]
            );

            const [[{ total }]] = await db.query<any[]>(
                `SELECT COUNT(*) AS total FROM ${USER_TABLE} u ${whereClause}`
            );

            const users: AdminUserRow[] = rows.map((r) => ({
                id:             Number(r.id),
                name:           r.name ?? null,
                email:          r.email,
                is_active:      r.is_active === 1,
                created_at:     r.created_at,
                wallet_balance: Number(r.wallet_balance),
                total_bills:    Number(r.total_bills),
                verified_bills: Number(r.verified_bills),
                rejected_bills: Number(r.rejected_bills),
                total_cashback: Number(r.total_cashback),
                max_fraud_score: Number(r.max_fraud_score),
            }));

            return ok({ users, total: Number(total) });
        } catch (error) {
            logger.error('Error fetching admin user list', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async setUserActive(id: number, isActive: boolean): Promise<Result<void, RequestError>> {
        try {
            const [result] = await db.query<ResultSetHeader>(
                `UPDATE ${USER_TABLE} SET is_active = ? WHERE id = ?`,
                [isActive ? 1 : 0, id]
            );
            if (result.affectedRows === 0) return err(ERRORS.USER_NOT_FOUND);
            return ok(undefined);
        } catch (error) {
            logger.error('Error setting user active status', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async adminExists(): Promise<Result<boolean, RequestError>> {
        try {
            const [[{ count }]] = await db.query<any[]>(
                `SELECT COUNT(*) AS count FROM ${USER_TABLE} WHERE role = 'admin'`
            );
            return ok(Number(count) > 0);
        } catch (error) {
            logger.error('Error checking admin existence', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async createAdmin(name: string, email: string, passwordHash: string): Promise<Result<User, RequestError>> {
        try {
            const [result] = await db.query<ResultSetHeader>(
                `INSERT INTO ${USER_TABLE} (name, email, role, is_onboarded, password_hash)
                 VALUES (?, ?, 'admin', TRUE, ?)`,
                [name, email.toLowerCase(), passwordHash]
            );
            return await this.findById(result.insertId);
        } catch (error) {
            logger.error('Error creating admin user', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }
}

export const UserRepository = new UserRepositoryImpl();
