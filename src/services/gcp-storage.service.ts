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
 * Compress and upload a bill image to GCP Cloud Storage (Mumbai — asia-south1).
 *
 * Rules (from wahtisapp.md):
 * - Only called AFTER the full pipeline succeeds and fraud checks pass.
 * - Failed/pending/rejected bills never reach this function — file_url stays null.
 * - Image is compressed to JPEG quality 80 before upload to save storage cost.
 * - Object path: bills/{userId}/{billId}_{timestamp}.jpg
 * - Bucket must be Standard storage class in asia-south1 region.
 */
export async function uploadBillImage(
    buffer: Buffer,
    userId: number,
    billId: number
): Promise<Result<StorageUploadResult, RequestError>> {
    try {
        // Compress to JPEG 80% quality, cap at 1600px wide — no upscale
        const compressed = await sharp(buffer)
            .resize({ width: 1600, withoutEnlargement: true })
            .jpeg({ quality: 80, mozjpeg: true })
            .toBuffer();

        const filename  = `bills/${userId}/bill_${billId}_${Date.now()}.jpg`;
        const bucket    = getStorage().bucket(GCP_STORAGE_BUCKET);
        const file      = bucket.file(filename);

        await file.save(compressed, {
            contentType:    'image/jpeg',
            resumable:      false,           // small files — single-shot upload
            metadata: {
                cacheControl: 'public, max-age=31536000',   // 1 year — images never change
                metadata: {
                    userId:  String(userId),
                    billId:  String(billId),
                },
            },
        });

        // Make the object publicly readable
        await file.makePublic();

        const url      = `https://storage.googleapis.com/${GCP_STORAGE_BUCKET}/${filename}`;
        const gcs_path = `gs://${GCP_STORAGE_BUCKET}/${filename}`;

        logger.info(`Bill image uploaded — ${gcs_path}`);
        return ok({ url, gcs_path });

    } catch (error) {
        logger.error('GCP Storage upload failed', error);
        return err(ERRORS.CLOUDINARY_UPLOAD_FAILED);
    }
}
