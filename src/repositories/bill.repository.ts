import { err, ok, Result } from 'neverthrow';
import { ResultSetHeader } from 'mysql2/promise';
import { db } from '../database/db.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';
import {
    Bill, BillStatus, CreateBillData, QueuedBillData, ProcessedBillData, BILL_TABLE,
} from '../models/bill.model.ts';

const logger = createLogger('@bill.repository');

export interface IBillRepository {
    createQueued(data: QueuedBillData): Promise<Result<Bill, RequestError>>;
    findStranded(): Promise<Result<Bill[], RequestError>>;
    updateProcessed(id: number, data: ProcessedBillData): Promise<Result<void, RequestError>>;
    create(data: CreateBillData): Promise<Result<Bill, RequestError>>;
    findById(id: number): Promise<Result<Bill | null, RequestError>>;
    findByUserId(userId: number, limit: number, before?: number): Promise<Result<Bill[], RequestError>>;
    findBySha256Hash(hash: string): Promise<Result<Bill | null, RequestError>>;
    findByPhash(phash: string): Promise<Result<Bill | null, RequestError>>;
    findByOrderIdAndPlatform(orderId: string, platform: string, excludeUserId: number): Promise<Result<Bill | null, RequestError>>;
    updateStatus(id: number, status: BillStatus, rejectionReason?: string): Promise<Result<void, RequestError>>;
    setVerified(id: number, rewardAmount: number, chestDecoys: [number, number]): Promise<Result<void, RequestError>>;
    setChestOpened(id: number): Promise<Result<void, RequestError>>;
    countUserUploads(userId: number): Promise<Result<{ today: number; this_week: number; this_month: number }, RequestError>>;
    findAllAdmin(limit: number, before?: number, status?: BillStatus): Promise<Result<Bill[], RequestError>>;
}

class BillRepositoryImpl implements IBillRepository {

    // Creates a minimal bill row immediately on upload — background worker fills in the rest
    async createQueued(data: QueuedBillData): Promise<Result<Bill, RequestError>> {
        try {
            const [result] = await db.query<ResultSetHeader>(
                `INSERT INTO ${BILL_TABLE} (user_id, sha256_hash, status)
                 VALUES (?, ?, 'queued')`,
                [data.user_id, data.sha256_hash]
            );
            return await this.findByIdRequired(result.insertId);
        } catch (error) {
            logger.error('Error creating queued bill', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    // Returns bills stuck in queued/processing — used on server startup to recover from crashes
    async findStranded(): Promise<Result<Bill[], RequestError>> {
        try {
            const [rows] = await db.query<Bill[]>(
                `SELECT * FROM ${BILL_TABLE}
                 WHERE status IN ('queued', 'processing')
                 ORDER BY id ASC`
            );
            return ok(rows);
        } catch (error) {
            logger.error('Error finding stranded bills', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    // Fills in all extracted fields on a queued/processing bill row after background processing completes
    async updateProcessed(id: number, data: ProcessedBillData): Promise<Result<void, RequestError>> {
        try {
            await db.query(
                `UPDATE ${BILL_TABLE}
                 SET phash = ?, platform = ?, order_id = ?, total_amount = ?, bill_date = ?,
                     status = ?, rejection_reason = ?, extracted_data = ?, fraud_score = ?,
                     fraud_signals = ?, file_url = ?, reward_amount = ?, chest_decoys = ?
                 WHERE id = ?`,
                [
                    data.phash,
                    data.platform,
                    data.order_id,
                    data.total_amount,
                    data.bill_date,
                    data.status,
                    data.rejection_reason,
                    data.extracted_data ? JSON.stringify(data.extracted_data) : null,
                    data.fraud_score,
                    data.fraud_signals ? JSON.stringify(data.fraud_signals) : null,
                    data.file_url,
                    data.reward_amount,
                    data.chest_decoys ? JSON.stringify(data.chest_decoys) : null,
                    id,
                ]
            );
            return ok(undefined);
        } catch (error) {
            logger.error('Error updating processed bill', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async create(data: CreateBillData): Promise<Result<Bill, RequestError>> {
        try {
            const [result] = await db.query<ResultSetHeader>(
                `INSERT INTO ${BILL_TABLE}
                 (user_id, file_url, sha256_hash, phash, platform, order_id, total_amount,
                  bill_date, status, rejection_reason, extracted_data, fraud_score,
                  fraud_signals, reward_amount, chest_decoys)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    data.user_id,
                    data.file_url,
                    data.sha256_hash,
                    data.phash,
                    data.platform,
                    data.order_id,
                    data.total_amount,
                    data.bill_date,
                    data.status,
                    data.rejection_reason,
                    data.extracted_data ? JSON.stringify(data.extracted_data) : null,
                    data.fraud_score,
                    data.fraud_signals ? JSON.stringify(data.fraud_signals) : null,
                    data.reward_amount,
                    data.chest_decoys ? JSON.stringify(data.chest_decoys) : null,
                ]
            );
            return await this.findByIdRequired(result.insertId);
        } catch (error) {
            logger.error('Error creating bill', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async findById(id: number): Promise<Result<Bill | null, RequestError>> {
        try {
            const [rows] = await db.query<Bill[]>(
                `SELECT * FROM ${BILL_TABLE} WHERE id = ?`,
                [id]
            );
            return ok(rows.length > 0 ? rows[0] : null);
        } catch (error) {
            logger.error('Error finding bill by id', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async findByUserId(
        userId: number,
        limit: number,
        before?: number
    ): Promise<Result<Bill[], RequestError>> {
        try {
            const [rows] = before
                ? await db.query<Bill[]>(
                    `SELECT * FROM ${BILL_TABLE}
                     WHERE user_id = ? AND id < ?
                     ORDER BY id DESC LIMIT ?`,
                    [userId, before, limit]
                )
                : await db.query<Bill[]>(
                    `SELECT * FROM ${BILL_TABLE}
                     WHERE user_id = ?
                     ORDER BY id DESC LIMIT ?`,
                    [userId, limit]
                );
            return ok(rows);
        } catch (error) {
            logger.error('Error finding bills by user id', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async findBySha256Hash(hash: string): Promise<Result<Bill | null, RequestError>> {
        try {
            const [rows] = await db.query<Bill[]>(
                `SELECT id, user_id, sha256_hash, status FROM ${BILL_TABLE}
                 WHERE sha256_hash = ? AND status != 'failed'
                 LIMIT 1`,
                [hash]
            );
            return ok(rows.length > 0 ? rows[0] : null);
        } catch (error) {
            logger.error('Error finding bill by sha256', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async findByPhash(phash: string): Promise<Result<Bill | null, RequestError>> {
        try {
            const [rows] = await db.query<Bill[]>(
                `SELECT id, user_id, phash, status FROM ${BILL_TABLE} WHERE phash = ? LIMIT 1`,
                [phash]
            );
            return ok(rows.length > 0 ? rows[0] : null);
        } catch (error) {
            logger.error('Error finding bill by phash', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async findByOrderIdAndPlatform(
        orderId: string,
        platform: string,
        excludeUserId: number
    ): Promise<Result<Bill | null, RequestError>> {
        try {
            const [rows] = await db.query<Bill[]>(
                `SELECT id, user_id, order_id, platform, status FROM ${BILL_TABLE}
                 WHERE order_id = ? AND platform = ? AND user_id != ? AND status != 'failed'
                 LIMIT 1`,
                [orderId, platform, excludeUserId]
            );
            return ok(rows.length > 0 ? rows[0] : null);
        } catch (error) {
            logger.error('Error finding bill by order id + platform', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async updateStatus(
        id: number,
        status: BillStatus,
        rejectionReason?: string
    ): Promise<Result<void, RequestError>> {
        try {
            await db.query(
                `UPDATE ${BILL_TABLE} SET status = ?, rejection_reason = ? WHERE id = ?`,
                [status, rejectionReason ?? null, id]
            );
            return ok(undefined);
        } catch (error) {
            logger.error('Error updating bill status', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async setVerified(
        id: number,
        rewardAmount: number,
        chestDecoys: [number, number]
    ): Promise<Result<void, RequestError>> {
        try {
            await db.query(
                `UPDATE ${BILL_TABLE}
                 SET status = 'verified', reward_amount = ?, chest_decoys = ?
                 WHERE id = ?`,
                [rewardAmount, JSON.stringify(chestDecoys), id]
            );
            return ok(undefined);
        } catch (error) {
            logger.error('Error setting bill verified', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async setChestOpened(id: number): Promise<Result<void, RequestError>> {
        try {
            await db.query(
                `UPDATE ${BILL_TABLE}
                 SET chest_opened = TRUE, reward_claimed = TRUE
                 WHERE id = ?`,
                [id]
            );
            return ok(undefined);
        } catch (error) {
            logger.error('Error setting chest opened', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async countUserUploads(
        userId: number
    ): Promise<Result<{ today: number; this_week: number; this_month: number }, RequestError>> {
        try {
            const [rows] = await db.query<any[]>(
                `SELECT
                   SUM(created_at >= CURDATE()) AS today,
                   SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) AS this_week,
                   SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) AS this_month
                 FROM ${BILL_TABLE}
                 WHERE user_id = ? AND status != 'failed'`,
                [userId]
            );
            const row = rows[0];
            return ok({
                today:      Number(row.today      ?? 0),
                this_week:  Number(row.this_week  ?? 0),
                this_month: Number(row.this_month ?? 0),
            });
        } catch (error) {
            logger.error('Error counting user uploads', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async findAllAdmin(
        limit: number,
        before?: number,
        status?: BillStatus
    ): Promise<Result<Bill[], RequestError>> {
        try {
            const conditions: string[] = [];
            const params: (string | number)[] = [];

            if (before) {
                conditions.push('id < ?');
                params.push(before);
            }
            if (status) {
                conditions.push('status = ?');
                params.push(status);
            }

            const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            params.push(limit);

            const [rows] = await db.query<Bill[]>(
                `SELECT * FROM ${BILL_TABLE} ${where} ORDER BY id DESC LIMIT ?`,
                params
            );
            return ok(rows);
        } catch (error) {
            logger.error('Error listing bills (admin)', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    // ── Private ─────────────────────────────────────────────────────────────────

    private async findByIdRequired(id: number): Promise<Result<Bill, RequestError>> {
        try {
            const [rows] = await db.query<Bill[]>(
                `SELECT * FROM ${BILL_TABLE} WHERE id = ?`,
                [id]
            );
            if (rows.length === 0) return err(ERRORS.BILL_NOT_FOUND);
            return ok(rows[0]);
        } catch (error) {
            return err(ERRORS.DATABASE_ERROR);
        }
    }
}

export const BillRepository = new BillRepositoryImpl();
