import { err, ok, Result } from 'neverthrow';
import { ResultSetHeader } from 'mysql2/promise';
import { db } from '../database/db.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';
import { Banner, BANNER_TABLE } from '../models/banner.model.ts';

const logger = createLogger('@banner.repository');

export type CreateBannerData = {
    title: string;
    image_url: string;
    gcs_path: string;
    display_order?: number;
};

export type UpdateBannerData = {
    title?: string;
    display_order?: number;
    is_active?: boolean;
    image_url?: string;
    gcs_path?: string;
};

class BannerRepositoryImpl {

    async create(data: CreateBannerData): Promise<Result<Banner, RequestError>> {
        try {
            const [result] = await db.execute<ResultSetHeader>(
                `INSERT INTO ${BANNER_TABLE} (title, image_url, gcs_path, display_order)
                 VALUES (?, ?, ?, ?)`,
                [data.title, data.image_url, data.gcs_path, data.display_order ?? 0],
            );
            return this.findById(result.insertId);
        } catch (error) {
            logger.error('BannerRepository.create failed', error);
            return err(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }

    async findById(id: number): Promise<Result<Banner, RequestError>> {
        try {
            const [rows] = await db.execute<Banner[]>(
                `SELECT * FROM ${BANNER_TABLE} WHERE id = ?`,
                [id],
            );
            if (!rows[0]) return err(ERRORS.BANNER_NOT_FOUND);
            return ok(rows[0]);
        } catch (error) {
            logger.error('BannerRepository.findById failed', error);
            return err(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }

    async findAll(): Promise<Result<Banner[], RequestError>> {
        try {
            const [rows] = await db.execute<Banner[]>(
                `SELECT * FROM ${BANNER_TABLE} ORDER BY display_order ASC, id ASC`,
            );
            return ok(rows);
        } catch (error) {
            logger.error('BannerRepository.findAll failed', error);
            return err(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }

    async findActive(): Promise<Result<Banner[], RequestError>> {
        try {
            const [rows] = await db.execute<Banner[]>(
                `SELECT * FROM ${BANNER_TABLE} WHERE is_active = TRUE ORDER BY display_order ASC, id ASC`,
            );
            return ok(rows);
        } catch (error) {
            logger.error('BannerRepository.findActive failed', error);
            return err(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }

    async update(id: number, data: UpdateBannerData): Promise<Result<Banner, RequestError>> {
        try {
            const fields: string[] = [];
            const values: unknown[] = [];

            if (data.title !== undefined)         { fields.push('title = ?');         values.push(data.title); }
            if (data.display_order !== undefined)  { fields.push('display_order = ?'); values.push(data.display_order); }
            if (data.is_active !== undefined)      { fields.push('is_active = ?');     values.push(data.is_active); }
            if (data.image_url !== undefined)      { fields.push('image_url = ?');     values.push(data.image_url); }
            if (data.gcs_path !== undefined)       { fields.push('gcs_path = ?');      values.push(data.gcs_path); }

            if (fields.length === 0) return this.findById(id);

            values.push(id);
            await db.execute(
                `UPDATE ${BANNER_TABLE} SET ${fields.join(', ')} WHERE id = ?`,
                values,
            );
            return this.findById(id);
        } catch (error) {
            logger.error('BannerRepository.update failed', error);
            return err(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }

    async delete(id: number): Promise<Result<void, RequestError>> {
        try {
            const [result] = await db.execute<ResultSetHeader>(
                `DELETE FROM ${BANNER_TABLE} WHERE id = ?`,
                [id],
            );
            if (result.affectedRows === 0) return err(ERRORS.BANNER_NOT_FOUND);
            return ok(undefined);
        } catch (error) {
            logger.error('BannerRepository.delete failed', error);
            return err(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }
}

export const BannerRepository = new BannerRepositoryImpl();
