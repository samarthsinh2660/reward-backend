import { err, ok, Result } from 'neverthrow';
import { RowDataPacket } from 'mysql2';
import { db } from '../database/db.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('@brand.repository');

interface BrandRow extends RowDataPacket { name: string; }
interface HsnRow extends RowDataPacket { chapter: string; category: string; }

class BrandRepositoryImpl {

    /**
     * Returns all brand names sorted by length descending (longest first).
     * Longest-first ensures "Mother Dairy" matches before "Mother" on prefix checks.
     */
    async findAllNames(): Promise<Result<string[], RequestError>> {
        try {
            const [rows] = await db.execute<BrandRow[]>(
                'SELECT name FROM brands ORDER BY CHAR_LENGTH(name) DESC',
            );
            return ok(rows.map(r => r.name));
        } catch (error) {
            logger.error('BrandRepository.findAllNames failed', error);
            return err(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Insert a GPT-discovered brand. INSERT IGNORE so concurrent calls are safe.
     */
    async insert(name: string): Promise<Result<void, RequestError>> {
        try {
            await db.execute(
                "INSERT IGNORE INTO brands (name, source) VALUES (?, 'gpt')",
                [name],
            );
            return ok(undefined);
        } catch (error) {
            logger.error('BrandRepository.insert failed', error);
            return err(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Insert a GPT-discovered HSN category. INSERT IGNORE so concurrent calls are safe.
     */
    async insertHsnCategory(chapter: string, category: string): Promise<Result<void, RequestError>> {
        try {
            await db.execute(
                'INSERT IGNORE INTO hsn_categories (chapter, category) VALUES (?, ?)',
                [chapter, category],
            );
            return ok(undefined);
        } catch (error) {
            logger.error('BrandRepository.insertHsnCategory failed', error);
            return err(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Returns all HSN category mappings as a record keyed by chapter string.
     */
    async findAllHsnCategories(): Promise<Result<Record<string, string>, RequestError>> {
        try {
            const [rows] = await db.execute<HsnRow[]>(
                'SELECT chapter, category FROM hsn_categories',
            );
            const map: Record<string, string> = {};
            for (const row of rows) map[row.chapter] = row.category;
            return ok(map);
        } catch (error) {
            logger.error('BrandRepository.findAllHsnCategories failed', error);
            return err(ERRORS.INTERNAL_SERVER_ERROR);
        }
    }
}

export const BrandRepository = new BrandRepositoryImpl();
