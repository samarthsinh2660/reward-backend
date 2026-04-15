import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import z from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.middleware.ts';
import validateRequest from '../middleware/validate-request.middleware.ts';
import { errorHandler } from '../middleware/error.middleware.ts';
import { successResponse } from '../utils/response.ts';
import { ERRORS } from '../utils/error.ts';
import { BannerRepository } from '../repositories/banner.repository.ts';
import { toBannerView } from '../models/banner.model.ts';
import { uploadBannerImage, deleteGcsFile } from '../services/gcp-storage.service.ts';

// ── Multer — in-memory, images only, 5 MB cap ─────────────────────────────────
const _ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const _MAX_BANNER_SIZE = 5 * 1024 * 1024;  // 5 MB

const bannerUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: _MAX_BANNER_SIZE },
    fileFilter: (_req, file, cb) => {
        if (_ALLOWED_IMAGE_TYPES.includes(file.mimetype.toLowerCase())) {
            cb(null, true);
        } else {
            cb(new Error(ERRORS.BANNER_INVALID_IMAGE.message));
        }
    },
}).single('image');

/** Runs multer and maps its errors to specific RequestErrors */
function _runBannerUpload(req: Request, res: Response, next: NextFunction) {
    bannerUpload(req, res, (err) => {
        if (!err) return next();
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return next(ERRORS.BANNER_IMAGE_TOO_LARGE);
        }
        if (err instanceof Error && err.message === ERRORS.BANNER_INVALID_IMAGE.message) {
            return next(ERRORS.BANNER_INVALID_IMAGE);
        }
        return next(ERRORS.BANNER_UPLOAD_FAILED);
    });
}

// ── Schemas ───────────────────────────────────────────────────────────────────
const SCHEMA = {
    CREATE: z.object({
        title:         z.string().min(1).max(255),
        display_order: z.coerce.number().int().min(0).default(0),
    }),

    UPDATE: z.object({
        title:         z.string().min(1).max(255).optional(),
        display_order: z.coerce.number().int().min(0).optional(),
        is_active:     z.preprocess(
            (v) => v === 'true' ? true : v === 'false' ? false : v,
            z.boolean().optional(),
        ),
    }),

    BANNER_ID: z.object({
        id: z.coerce.number().int().min(1),
    }),
};

const adminBannerRouter = Router();

// All routes require admin authentication
adminBannerRouter.use(authenticate, requireAdmin);

// ─── GET /api/admin/banners ───────────────────────────────────────────────────
adminBannerRouter.get(
    '/banners',
    async function (_req: Request, res: Response, next: NextFunction) {
        const result = await BannerRepository.findAll();
        result.match(
            (banners) => res.json(successResponse(banners.map(toBannerView), 'Banners fetched')),
            (error)   => next(error),
        );
    },
);

// ─── POST /api/admin/banners ──────────────────────────────────────────────────
adminBannerRouter.post(
    '/banners',
    _runBannerUpload,
    async function (req: Request, res: Response, next: NextFunction) {
        if (!req.file) return next(ERRORS.BANNER_IMAGE_REQUIRED);

        const parsed = SCHEMA.CREATE.safeParse(req.body);
        if (!parsed.success) return next(ERRORS.BANNER_TITLE_REQUIRED);

        const uploadResult = await uploadBannerImage(req.file.buffer);
        if (uploadResult.isErr()) return next(uploadResult.error);

        const createResult = await BannerRepository.create({
            title:         parsed.data.title,
            image_url:     uploadResult.value.url,
            gcs_path:      uploadResult.value.gcs_path,
            display_order: parsed.data.display_order,
        });

        createResult.match(
            (banner) => res.status(201).json(successResponse(toBannerView(banner), 'Banner created')),
            (error)  => next(error),
        );
    },
);

// ─── PUT /api/admin/banners/:id ───────────────────────────────────────────────
// Updates title, display_order, is_active. Optionally replaces image if uploaded.
adminBannerRouter.put(
    '/banners/:id',
    validateRequest({ params: SCHEMA.BANNER_ID }),
    _runBannerUpload,
    async function (req: Request, res: Response, next: NextFunction) {
        const id = Number(req.params.id);

        const parsed = SCHEMA.UPDATE.safeParse(req.body);
        if (!parsed.success) return next(ERRORS.INVALID_REQUEST_BODY);

        const updateData: Parameters<typeof BannerRepository.update>[1] = { ...parsed.data };

        // If a new image file was uploaded, upload it and replace the old one
        if (req.file) {
            // Fetch existing record to get old gcs_path for cleanup
            const existing = await BannerRepository.findById(id);
            if (existing.isErr()) return next(existing.error);

            const uploadResult = await uploadBannerImage(req.file.buffer);
            if (uploadResult.isErr()) return next(uploadResult.error);

            updateData.image_url = uploadResult.value.url;
            updateData.gcs_path  = uploadResult.value.gcs_path;

            // Delete old GCS file after new one is confirmed uploaded
            await deleteGcsFile(existing.value.gcs_path);
        }

        const result = await BannerRepository.update(id, updateData);
        result.match(
            (banner) => res.json(successResponse(toBannerView(banner), 'Banner updated')),
            (error)  => next(error),
        );
    },
);

// ─── DELETE /api/admin/banners/:id ───────────────────────────────────────────
adminBannerRouter.delete(
    '/banners/:id',
    validateRequest({ params: SCHEMA.BANNER_ID }),
    async function (req: Request, res: Response, next: NextFunction) {
        const id = Number(req.params.id);

        // Fetch first to get gcs_path for cleanup
        const existing = await BannerRepository.findById(id);
        if (existing.isErr()) return next(existing.error);

        const deleteResult = await BannerRepository.delete(id);
        if (deleteResult.isErr()) return next(deleteResult.error);

        // Remove image from GCS after DB record is gone
        await deleteGcsFile(existing.value.gcs_path);

        res.json(successResponse(null, 'Banner deleted'));
    },
);

adminBannerRouter.use(errorHandler);
export default adminBannerRouter;
