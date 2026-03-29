import { err, ok, Result } from 'neverthrow';
import { db } from '../database/db.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';
import { CashbackTransaction, CASHBACK_TRANSACTIONS_TABLE } from '../models/cashback_transaction.model.ts';
import { USER_TABLE } from '../models/user.model.ts';

const logger = createLogger('@cashback_transaction.repository');

export interface ICashbackTransactionRepository {
    creditWallet(userId: number, billId: number, amount: number, description: string): Promise<Result<number, RequestError>>;
    getByUserId(userId: number, limit?: number): Promise<Result<CashbackTransaction[], RequestError>>;
}

class CashbackTransactionRepositoryImpl implements ICashbackTransactionRepository {

    /**
     * Atomically credits wallet_balance on users table AND inserts a
     * cashback_transactions record — both in a single DB transaction.
     * Returns the new wallet balance.
     */
    async creditWallet(
        userId: number,
        billId: number,
        amount: number,
        description: string
    ): Promise<Result<number, RequestError>> {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            await conn.execute(
                `UPDATE ${USER_TABLE} SET wallet_balance = wallet_balance + ? WHERE id = ?`,
                [amount, userId]
            );

            await conn.execute(
                `INSERT INTO ${CASHBACK_TRANSACTIONS_TABLE} (user_id, bill_id, amount, type, description)
                 VALUES (?, ?, ?, 'credit', ?)`,
                [userId, billId, amount, description]
            );

            const [rows] = await conn.execute<any[]>(
                `SELECT wallet_balance FROM ${USER_TABLE} WHERE id = ?`,
                [userId]
            );

            await conn.commit();
            conn.release();

            const newBalance = Number(rows[0]?.wallet_balance ?? 0);
            return ok(newBalance);
        } catch (error) {
            await conn.rollback();
            conn.release();
            logger.error('Error crediting wallet', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getByUserId(
        userId: number,
        limit = 50
    ): Promise<Result<CashbackTransaction[], RequestError>> {
        try {
            const [rows] = await db.query<CashbackTransaction[]>(
                `SELECT * FROM ${CASHBACK_TRANSACTIONS_TABLE}
                 WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
                [userId, limit]
            );
            return ok(rows);
        } catch (error) {
            logger.error('Error fetching cashback transactions', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }
}

export const CashbackTransactionRepository = new CashbackTransactionRepositoryImpl();
