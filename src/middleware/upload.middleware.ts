import multer from 'multer';
import { Request } from 'express';
import { ERRORS } from '../utils/error.ts';

// ── Accepted file types — defined here as the single source of truth ──────────
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;   // 20 MB — supports PDFs

const storage = multer.memoryStorage();

const fileFilter = (
    _req: Request,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
) => {
    const mime = file.mimetype.toLowerCase();
    // Accept images, PDF, and octet-stream (Android sometimes sends this for PDFs)
    const isValid =
        mime.startsWith('image/') ||
        mime === 'application/pdf' ||
        mime === 'application/octet-stream';

    if (isValid) {
        cb(null, true);
    } else {
        cb(new Error(ERRORS.BILL_INVALID_FILE.message));
    }
};

/**
 * Multer middleware for single-file bill upload.
 * Field name: "file" (must match the FastAPI /process endpoint's field).
 * Uses memory storage — file bytes available as req.file.buffer.
 */
export const billUpload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter,
}).single('file');
