import { Router, Request, Response, NextFunction } from 'express';
import z from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.ts';
import validateRequest from '../middleware/validate-request.middleware.ts';
import { errorHandler } from '../middleware/error.middleware.ts';
import { successResponse } from '../utils/response.ts';
import { err, ok } from 'neverthrow';
import { db } from '../database/db.ts';
import { ERRORS } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('@admin.transactions.route');

const SCHEMA = {
    LIST: z.object({
        page:   z.coerce.number().int().min(1).default(1),
        limit:  z.coerce.number().int().min(1).max(100).default(30),
        type:   z.enum(['all', 'credit', 'debit']).default('all'),
        search: z.string().max(100).optional(),
    }),
};

const adminTransactionsRouter = Router();
adminTransactionsRouter.use(authenticate, requireAdmin);

// GET /api/admin/transactions/cashback
adminTransactionsRouter.get(
    '/cashback',
    validateRequest({ query: SCHEMA.LIST }),
    async function (req: Request, res: Response, next: NextFunction) {
        try {
            const { page, limit, type, search } = SCHEMA.LIST.parse(req.query);
            const offset = (page - 1) * limit;

            const conditions: string[] = [];
            const params: (string | number)[] = [];

            if (type !== 'all') {
                conditions.push('ct.type = ?');
                params.push(type);
            }
            if (search) {
                conditions.push('(u.name LIKE ? OR u.email LIKE ? OR ct.description LIKE ?)');
                const like = `%${search}%`;
                params.push(like, like, like);
            }

            const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

            const [rows] = await db.query<any[]>(
                `SELECT
                    ct.id, ct.user_id, ct.bill_id, ct.amount, ct.type,
                    ct.description, ct.created_at,
                    u.name AS user_name, u.email AS user_email
                 FROM cashback_transactions ct
                 JOIN users u ON u.id = ct.user_id
                 ${where}
                 ORDER BY ct.created_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            const [[{ total }]] = await db.query<any[]>(
                `SELECT COUNT(*) AS total FROM cashback_transactions ct
                 JOIN users u ON u.id = ct.user_id ${where}`,
                params
            );

            const [[{ total_credited }]] = await db.query<any[]>(
                `SELECT COALESCE(SUM(amount), 0) AS total_credited FROM cashback_transactions WHERE type = 'credit'`
            );
            const [[{ total_debited }]] = await db.query<any[]>(
                `SELECT COALESCE(SUM(amount), 0) AS total_debited FROM cashback_transactions WHERE type = 'debit'`
            );

            res.json(successResponse({
                transactions: rows,
                summary: {
                    total_credited: Number(total_credited),
                    total_debited: Number(total_debited),
                    net_outstanding: Number(total_credited) - Number(total_debited),
                },
                pagination: {
                    page,
                    limit,
                    total: Number(total),
                    total_pages: Math.ceil(Number(total) / limit),
                },
            }, 'Cashback transactions fetched'));
        } catch (e) {
            logger.error('Error fetching cashback transactions', e);
            next(ERRORS.DATABASE_ERROR);
        }
    }
);

// GET /api/admin/transactions/referrals
adminTransactionsRouter.get(
    '/referrals',
    validateRequest({ query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(30) }) }),
    async function (req: Request, res: Response, next: NextFunction) {
        try {
            const page = Number(req.query.page ?? 1);
            const limit = Number(req.query.limit ?? 30);
            const offset = (page - 1) * limit;

            const [rows] = await db.query<any[]>(
                `SELECT
                    rt.id, rt.referrer_user_id, rt.referred_user_id, rt.coins_awarded, rt.created_at,
                    r.name AS referrer_name, r.email AS referrer_email,
                    d.name AS referred_name, d.email AS referred_email
                 FROM referral_transactions rt
                 JOIN users r ON r.id = rt.referrer_user_id
                 JOIN users d ON d.id = rt.referred_user_id
                 ORDER BY rt.created_at DESC
                 LIMIT ? OFFSET ?`,
                [limit, offset]
            );

            const [[{ total }]] = await db.query<any[]>('SELECT COUNT(*) AS total FROM referral_transactions');
            const [[{ total_coins }]] = await db.query<any[]>('SELECT COALESCE(SUM(coins_awarded), 0) AS total_coins FROM referral_transactions');

            res.json(successResponse({
                transactions: rows,
                summary: { total_referrals: Number(total), total_coins_awarded: Number(total_coins) },
                pagination: { page, limit, total: Number(total), total_pages: Math.ceil(Number(total) / limit) },
            }, 'Referral transactions fetched'));
        } catch (e) {
            logger.error('Error fetching referral transactions', e);
            next(ERRORS.DATABASE_ERROR);
        }
    }
);

adminTransactionsRouter.use(errorHandler);
export default adminTransactionsRouter;
