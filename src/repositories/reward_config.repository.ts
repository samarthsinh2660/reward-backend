import { err, ok, Result } from 'neverthrow';
import { db } from '../database/db.ts';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';
import {
    RewardConfig, UploadLimits, ReferralConfig,
    UpdateRewardTierData, UpdateUploadLimitsData, UpdateReferralConfigData,
    REWARD_CONFIG_TABLE, UPLOAD_LIMITS_TABLE, REFERRAL_CONFIG_TABLE,
} from '../models/reward_config.model.ts';

const logger = createLogger('@reward_config.repository');

export interface IRewardConfigRepository {
    getActiveTiers(): Promise<Result<RewardConfig[], RequestError>>;
    getAllTiers(): Promise<Result<RewardConfig[], RequestError>>;
    updateTier(id: number, data: UpdateRewardTierData): Promise<Result<RewardConfig, RequestError>>;
    getUploadLimits(): Promise<Result<UploadLimits, RequestError>>;
    updateUploadLimits(data: UpdateUploadLimitsData): Promise<Result<UploadLimits, RequestError>>;
    getReferralConfig(): Promise<Result<ReferralConfig, RequestError>>;
    updateReferralConfig(data: UpdateReferralConfigData): Promise<Result<ReferralConfig, RequestError>>;
}

class RewardConfigRepositoryImpl implements IRewardConfigRepository {

    async getActiveTiers(): Promise<Result<RewardConfig[], RequestError>> {
        try {
            const [rows] = await db.query<RewardConfig[]>(
                `SELECT * FROM ${REWARD_CONFIG_TABLE} WHERE is_active = TRUE ORDER BY reward_min ASC`
            );
            return ok(rows);
        } catch (error) {
            logger.error('Error fetching active reward tiers', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getAllTiers(): Promise<Result<RewardConfig[], RequestError>> {
        try {
            const [rows] = await db.query<RewardConfig[]>(
                `SELECT * FROM ${REWARD_CONFIG_TABLE} ORDER BY reward_min ASC`
            );
            return ok(rows);
        } catch (error) {
            logger.error('Error fetching all reward tiers', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async updateTier(
        id: number,
        data: UpdateRewardTierData
    ): Promise<Result<RewardConfig, RequestError>> {
        try {
            const fields: string[] = [];
            const values: (number | boolean)[] = [];

            if (data.reward_min !== undefined) { fields.push('reward_min = ?'); values.push(data.reward_min); }
            if (data.reward_max !== undefined) { fields.push('reward_max = ?'); values.push(data.reward_max); }
            if (data.coin_min   !== undefined) { fields.push('coin_min = ?');   values.push(data.coin_min);   }
            if (data.coin_max   !== undefined) { fields.push('coin_max = ?');   values.push(data.coin_max);   }
            if (data.weight     !== undefined) { fields.push('weight = ?');     values.push(data.weight);     }
            if (data.is_active  !== undefined) { fields.push('is_active = ?');  values.push(data.is_active);  }

            if (fields.length === 0) {
                // Nothing to update — just return current state
                return await this._findTierById(id);
            }

            values.push(id);
            await db.query(
                `UPDATE ${REWARD_CONFIG_TABLE} SET ${fields.join(', ')} WHERE id = ?`,
                values
            );
            return await this._findTierById(id);
        } catch (error) {
            logger.error('Error updating reward tier', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getUploadLimits(): Promise<Result<UploadLimits, RequestError>> {
        try {
            const [rows] = await db.query<UploadLimits[]>(
                `SELECT * FROM ${UPLOAD_LIMITS_TABLE} LIMIT 1`
            );
            if (rows.length === 0) return err(ERRORS.REWARD_CONFIG_NOT_FOUND);
            return ok(rows[0]);
        } catch (error) {
            logger.error('Error fetching upload limits', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async updateUploadLimits(data: UpdateUploadLimitsData): Promise<Result<UploadLimits, RequestError>> {
        try {
            const fields: string[] = [];
            const values: number[] = [];

            if (data.daily_limit   !== undefined) { fields.push('daily_limit = ?');   values.push(data.daily_limit);   }
            if (data.weekly_limit  !== undefined) { fields.push('weekly_limit = ?');  values.push(data.weekly_limit);  }
            if (data.monthly_limit !== undefined) { fields.push('monthly_limit = ?'); values.push(data.monthly_limit); }
            if (data.pity_cap      !== undefined) { fields.push('pity_cap = ?');      values.push(data.pity_cap);      }

            if (fields.length > 0) {
                await db.query(
                    `UPDATE ${UPLOAD_LIMITS_TABLE} SET ${fields.join(', ')} WHERE id = 1`,
                    values
                );
            }
            return await this.getUploadLimits();
        } catch (error) {
            logger.error('Error updating upload limits', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getReferralConfig(): Promise<Result<ReferralConfig, RequestError>> {
        try {
            const [rows] = await db.query<ReferralConfig[]>(
                `SELECT * FROM ${REFERRAL_CONFIG_TABLE} LIMIT 1`
            );
            if (rows.length === 0) return err(ERRORS.REWARD_CONFIG_NOT_FOUND);
            return ok(rows[0]);
        } catch (error) {
            logger.error('Error fetching referral config', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async updateReferralConfig(data: UpdateReferralConfigData): Promise<Result<ReferralConfig, RequestError>> {
        try {
            const fields: string[] = [];
            const values: number[] = [];

            if (data.coins_min !== undefined) { fields.push('coins_min = ?'); values.push(data.coins_min); }
            if (data.coins_max !== undefined) { fields.push('coins_max = ?'); values.push(data.coins_max); }

            if (fields.length > 0) {
                await db.query(
                    `UPDATE ${REFERRAL_CONFIG_TABLE} SET ${fields.join(', ')} WHERE id = 1`,
                    values
                );
            }
            return await this.getReferralConfig();
        } catch (error) {
            logger.error('Error updating referral config', error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    private async _findTierById(id: number): Promise<Result<RewardConfig, RequestError>> {
        const [rows] = await db.query<RewardConfig[]>(
            `SELECT * FROM ${REWARD_CONFIG_TABLE} WHERE id = ?`,
            [id]
        );
        if (rows.length === 0) return err(ERRORS.REWARD_CONFIG_NOT_FOUND);
        return ok(rows[0]);
    }
}

export const RewardConfigRepository = new RewardConfigRepositoryImpl();
