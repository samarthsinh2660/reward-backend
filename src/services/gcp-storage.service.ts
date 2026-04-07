import crypto from 'crypto';
import { Storage } from '@google-cloud/storage';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import sharp from 'sharp';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';
import {
    GCP_STORAGE_BUCKET,
    GCP_STORAGE_KEY_FILE,
} from '../config/env.ts';

const logger = createLogger('@gcp-storage.service');

// ── Lazy singleton — configured once on first call ────────────────────────────
let _storage: Storage | null = null;

function getStorage(): Storage {
    if (!_storage) {
        _storage = new Storage({
            keyFilename: GCP_STORAGE_KEY_FILE,
        });
    }
    return _storage;
}

export type StorageUploadResult = {
    url:      string;   // public HTTPS URL saved in bills.file_url
    gcs_path: string;   // gs://bucket/path — for admin reference
};

/**
 * Upload a bill file to GCP Cloud Storage (Mumbai — asia-south1).
 *
 * Rules:
 * - Only called AFTER the full pipeline succeeds and fraud checks pass.
 * - Failed/pending/rejected bills never reach this function — file_url stays null.
 * - Images are compressed to JPEG quality 80 before upload to save storage cost.
 * - PDFs are uploaded as-is (sharp cannot process PDFs).
 * - Object path: bills/{userId}/bill_{uuid}.jpg|pdf
 * - Bucket must be Standard storage class in asia-south1 region.
 */
export async function uploadBillImage(
    buffer: Buffer,
    userId: number,
    mimetype: string = 'image/jpeg'
): Promise<Result<StorageUploadResult, RequestError>> {
    try {
        let uploadBuffer: Buffer;
        let contentType: string;
        let ext: string;

        if (mimetype === 'application/pdf') {
            // PDFs: upload as-is
            uploadBuffer = buffer;
            contentType  = 'application/pdf';
            ext          = 'pdf';
        } else {
            // Images: compress to JPEG 80% quality, cap at 1600px wide
            uploadBuffer = await sharp(buffer)
                .resize({ width: 1600, withoutEnlargement: true })
                .jpeg({ quality: 80, mozjpeg: true })
                .toBuffer();
            contentType = 'image/jpeg';
            ext         = 'jpg';
        }

        const filename  = `bills/${userId}/bill_${crypto.randomUUID()}.${ext}`;
        const bucket    = getStorage().bucket(GCP_STORAGE_BUCKET);
        const file      = bucket.file(filename);

        await file.save(uploadBuffer, {
            contentType,
            resumable:      false,           // small files — single-shot upload
            metadata: {
                cacheControl: 'public, max-age=31536000',   // 1 year — files never change
                metadata: {
                    userId: String(userId),
                },
            },
        });
        // Public access is controlled by bucket-level IAM (uniform access enabled).
        // Grant allUsers → Storage Object Viewer on the bucket in GCP Console.

        const url      = `https://storage.googleapis.com/${GCP_STORAGE_BUCKET}/${filename}`;
        const gcs_path = `gs://${GCP_STORAGE_BUCKET}/${filename}`;

        logger.info(`Bill image uploaded — ${gcs_path}`);
        return ok({ url, gcs_path });

    } catch (error) {
        logger.error('GCP Storage upload failed', error);
        return err(ERRORS.CLOUDINARY_UPLOAD_FAILED);
    }
}
