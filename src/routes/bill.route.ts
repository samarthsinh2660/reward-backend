import { Router, Request, Response, NextFunction } from 'express';
import z from 'zod';
import multer from 'multer';
import { authenticate, requireAuth } from '../middleware/auth.middleware.ts';
import { billUpload } from '../middleware/upload.middleware.ts';
import { errorHandler } from '../middleware/error.middleware.ts';
import validateRequest from '../middleware/validate-request.middleware.ts';
import { successResponse } from '../utils/response.ts';
import { ERRORS } from '../utils/error.ts';
import {
    acceptBill, processBillInBackground, listBills, getBill, openChest,
} from '../controller/bill.controller.ts';
import { fireAndForget } from '../services/bill-queue.service.ts';

const SCHEMA = {
    LIST: z.object({
        limit:  z.coerce.number().int().min(1).max(50).default(20),
        before: z.coerce.number().int().optional(),
    }),
    ID_PARAM: z.object({
        id: z.coerce.number().int().min(1),
    }),
};

const billRouter = Router();

// ─── POST /api/bills/upload ──────────────────────────────────────────────────
// Accepts multipart/form-data. Field name: "file".
billRouter.post(
    '/upload',
    authenticate,
    requireAuth,
    (req: Request, res: Response, next: NextFunction) => {
        billUpload(req, res, (multerErr) => {
            if (multerErr instanceof multer.MulterError) {
                return next(
                    multerErr.code === 'LIMIT_FILE_SIZE'
                        ? ERRORS.BILL_INVALID_FILE
                        : ERRORS.INVALID_REQUEST_BODY
                );
            }
            if (multerErr) return next(ERRORS.BILL_INVALID_FILE);
            next();
        });
    },
    async function (req: Request, res: Response, next: NextFunction) {
        if (!req.file) return next(ERRORS.BILL_INVALID_FILE);

        // Phase 1: fast — dedup + limit check + create queued row (~200ms)
        const result = await acceptBill(req.user!.id, req.file);
        if (result.isErr()) return next(result.error);

        const { bill_id } = result.value;
        const { buffer, mimetype, originalname } = req.file;
        const userId = req.user!.id;

        // Phase 2: fire-and-forget — response is sent before this runs
        fireAndForget(() =>
            processBillInBackground(bill_id, userId, buffer, mimetype, originalname)
        );

        res.json(successResponse(result.value, 'Bill received and queued for processing'));
    }
);

// ─── GET /api/bills ───────────────────────────────────────────────────────────
billRouter.get(
    '/',
    authenticate,
    requireAuth,
    validateRequest({ query: SCHEMA.LIST }),
    async function (req: Request, res: Response, next: NextFunction) {
        const query = SCHEMA.LIST.parse(req.query);
        const result = await listBills(req.user!.id, query.limit, query.before);
        result.match(
            (data) => res.json(successResponse(data, 'Bills fetched')),
            (error) => next(error)
        );
    }
);

// ─── GET /api/bills/:id ───────────────────────────────────────────────────────
billRouter.get(
    '/:id',
    authenticate,
    requireAuth,
    validateRequest({ params: SCHEMA.ID_PARAM }),
    async function (req: Request, res: Response, next: NextFunction) {
        const result = await getBill(req.user!.id, Number(req.params.id));
        result.match(
            (data) => res.json(successResponse(data, 'Bill fetched')),
            (error) => next(error)
        );
    }
);

// ─── POST /api/bills/:id/open-chest ───────────────────────────────────────────
billRouter.post(
    '/:id/open-chest',
    authenticate,
    requireAuth,
    validateRequest({ params: SCHEMA.ID_PARAM }),
    async function (req: Request, res: Response, next: NextFunction) {
        const result = await openChest(req.user!.id, Number(req.params.id));
        result.match(
            (data) => res.json(successResponse(data, 'Chest opened! Reward credited to wallet.')),
            (error) => next(error)
        );
    }
);

billRouter.use(errorHandler);
export default billRouter;
