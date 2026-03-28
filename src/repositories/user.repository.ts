import { err, ok, Result } from 'neverthrow';
import { ResultSetHeader } from 'mysql2/promise';
import { db } from '../database/db.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';
import { User, OnboardUserData } from '../models/user.model.ts';

const logger = createLogger('@user.repository');

export interface IUserRepository {
    findByPhone(phone: string): Promise<Result<User | null, RequestError>>;
    findByPhoneWithPassword(phone: string): Promise<Result<User | null, RequestError>>;
    findById(id: number): Promise<Result<User, RequestError>>;
    findByReferralCode(code: string): Promise<Result<User | null, RequestError>>;
    create(phone: string): Promise<Result<User, RequestError>>;
    onboard(id: number, data: OnboardUserData, generatedReferralCode: string): Promise<Result<User, RequestError>>;
    addCoins(id: number, coins: number): Promise<Result<void, RequestError>>;
}

class UserRepositoryImpl implements IUserRepository {

    // Used for OTP login — no password_hash returned
    async findByPhone(phone: string): Promise<Result<User | null, RequestError>> {
        try {
            const [rows] = await db.query<User[]>(
                `SELECT id, name, email, phone, gender, role, upi_id, wallet_balance, is_onboarded, is_active,
                        pity_counter, referral_code, referred_by, coin_balance, created_at, updated_at
                 FROM users WHERE phone = ?`,
                [phone]
            );
            return ok(rows.length > 0 ? rows[0] : null);
        } catch (error) {
            logger.error('Error finding user by phone', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    // Used for admin password login — includes password_hash
    async findByPhoneWithPassword(phone: string): Promise<Result<User | null, RequestError>> {
        try {
            const [rows] = await db.query<User[]>(
                `SELECT id, name, email, phone, gender, role, password_hash, upi_id, wallet_balance,
                        is_onboarded, is_active, pity_counter, referral_code, referred_by,
                        coin_balance, created_at, updated_at
                 FROM users WHERE phone = ?`,
                [phone]
            );
            return ok(rows.length > 0 ? rows[0] : null);
        } catch (error) {
            logger.error('Error finding user by phone (with password)', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async findById(id: number): Promise<Result<User, RequestError>> {
        try {
            const [rows] = await db.query<User[]>(
                `SELECT id, name, email, phone, gender, role, upi_id, wallet_balance, is_onboarded, is_active,
                        pity_counter, referral_code, referred_by, coin_balance, created_at, updated_at
                 FROM users WHERE id = ?`,
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
                `SELECT id, name, phone, role, referral_code, coin_balance FROM users WHERE referral_code = ?`,
                [code]
            );
            return ok(rows.length > 0 ? rows[0] : null);
        } catch (error) {
            logger.error('Error finding user by referral code', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async create(phone: string): Promise<Result<User, RequestError>> {
        try {
            const [result] = await db.query<ResultSetHeader>(
                `INSERT INTO users (phone) VALUES (?)`,
                [phone]
            );
            return await this.findById(result.insertId);
        } catch (error) {
            logger.error('Error creating user', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async onboard(id: number, data: OnboardUserData, generatedReferralCode: string): Promise<Result<User, RequestError>> {
        try {
            await db.query(
                `UPDATE users
                 SET name = ?, is_onboarded = TRUE, referral_code = ?, referred_by = ?
                 WHERE id = ?`,
                [data.name, generatedReferralCode, data.referral_code_used ?? null, id]
            );
            return await this.findById(id);
        } catch (error) {
            logger.error('Error onboarding user', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async addCoins(id: number, coins: number): Promise<Result<void, RequestError>> {
        try {
            await db.query(
                `UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?`,
                [coins, id]
            );
            return ok(undefined);
        } catch (error) {
            logger.error('Error adding coins to user', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }
}

export const UserRepository = new UserRepositoryImpl();
