import { err, ok, Result } from 'neverthrow';
import { db } from '../database/db.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';
import {
    CashbackTransaction,
    CASHBACK_TRANSACTIONS_TABLE,
    CreditWalletAndCoinsData,
    WalletAndCoinBalance,
} from '../models/cashback_transaction.model.ts';
import { USER_TABLE } from '../models/user.model.ts';

const logger = createLogger('@cashback_transaction.repository');

export type DailyEarning = { date: string; earned: number };

export interface ICashbackTransactionRepository {
    creditWallet(userId: number, billId: number, amount: number, description: string): Promise<Result<number, RequestError>>;
    creditWalletAndCoins(data: CreditWalletAndCoinsData): Promise<Result<WalletAndCoinBalance, RequestError>>;
    getByUserId(userId: number, limit?: number): Promise<Result<CashbackTransaction[], RequestError>>;
    getDailyEarnings(userId: number, days: number): Promise<Result<DailyEarning[], RequestError>>;
    getMonthlyTotal(userId: number): Promise<Result<number, RequestError>>;
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
        const result = await this.creditWalletAndCoins({
            user_id: userId,
            bill_id: billId,
            amount,
            coins: 0,
            description,
        });
        if (result.isErr()) return err(result.error);
        return ok(result.value.wallet_balance);
    }

    async creditWalletAndCoins(data: CreditWalletAndCoinsData): Promise<Result<WalletAndCoinBalance, RequestError>> {
        const { user_id, bill_id, amount, coins, description } = data;
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            await conn.execute(
                 `UPDATE ${USER_TABLE}
                 SET wallet_balance = wallet_balance + ?, coin_balance = coin_balance + ?
                 WHERE id = ?`,
                [amount, coins, user_id]
            );

            await conn.execute(
                `INSERT INTO ${CASHBACK_TRANSACTIONS_TABLE} (user_id, bill_id, amount, type, description)
                 VALUES (?, ?, ?, 'credit', ?)`,
                [user_id, bill_id, amount, description]
            );

            const [rows] = await conn.execute<any[]>(
                `SELECT wallet_balance, coin_balance FROM ${USER_TABLE} WHERE id = ?`,
                [user_id]
            );

            await conn.commit();
            conn.release();

            return ok({
                wallet_balance: Number(rows[0]?.wallet_balance ?? 0),
                coin_balance: Number(rows[0]?.coin_balance ?? 0),
            });
        } catch (error) {
            await conn.rollback();
            conn.release();
            logger.error('Error crediting wallet and coins', error);
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

    async getDailyEarnings(userId: number, days: number): Promise<Result<DailyEarning[], RequestError>> {
        try {
            const [rows] = await db.query<any[]>(
                `SELECT DATE(created_at) AS date, SUM(amount) AS earned
                 FROM ${CASHBACK_TRANSACTIONS_TABLE}
                 WHERE user_id = ? AND type = 'credit'
                   AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 GROUP BY DATE(created_at)
                 ORDER BY date ASC`,
                [userId, days]
            );
            return ok(rows.map(r => ({ date: String(r.date), earned: Number(r.earned) })));
        } catch (error) {
            logger.error('Error fetching daily earnings', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getMonthlyTotal(userId: number): Promise<Result<number, RequestError>> {
        try {
            const [rows] = await db.query<any[]>(
                `SELECT COALESCE(SUM(amount), 0) AS total
                 FROM ${CASHBACK_TRANSACTIONS_TABLE}
                 WHERE user_id = ? AND type = 'credit'
                   AND created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
                [userId]
            );
            return ok(Number(rows[0]?.total ?? 0));
        } catch (error) {
            logger.error('Error fetching monthly total', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }
}

export const CashbackTransactionRepository = new CashbackTransactionRepositoryImpl();
