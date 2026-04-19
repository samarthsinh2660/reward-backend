import { RowDataPacket } from 'mysql2';

export const REWARD_CONFIG_TABLE   = 'reward_config';
export const UPLOAD_LIMITS_TABLE   = 'upload_limits';
export const REFERRAL_CONFIG_TABLE = 'referral_config';

// ── Enum constants ────────────────────────────────────────────────────────────

export const REWARD_TIER_NAMES = ['base', 'medium', 'high', 'jackpot'] as const;
export type RewardTierName = typeof REWARD_TIER_NAMES[number];

// ── CREATE TABLE (mirrors 01-tables.sql exactly) ──────────────────────────────

export const CREATE_REWARD_CONFIG_TABLE_QUERY = `
CREATE TABLE IF NOT EXISTS reward_config (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tier_name   VARCHAR(50) NOT NULL,
  reward_min  DECIMAL(10, 2) NOT NULL,
  reward_max  DECIMAL(10, 2) NOT NULL,
  coin_min    INT NOT NULL,
  coin_max    INT NOT NULL,
  weight      INT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
`;

export const CREATE_UPLOAD_LIMITS_TABLE_QUERY = `
CREATE TABLE IF NOT EXISTS upload_limits (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  daily_limit   INT NOT NULL DEFAULT 3,
  weekly_limit  INT NOT NULL DEFAULT 10,
  monthly_limit INT NOT NULL DEFAULT 30,
  pity_cap      INT NOT NULL DEFAULT 15,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
`;

// ── DB row types ──────────────────────────────────────────────────────────────

export interface RewardConfig extends RowDataPacket {
    id: number;
    tier_name: RewardTierName;
    reward_min: number;
    reward_max: number;
    coin_min: number;
    coin_max: number;
    weight: number;
    is_active: number;   // TINYINT — 0 | 1
    created_at: Date;
    updated_at: Date;
}

export interface UploadLimits extends RowDataPacket {
    id: number;
    daily_limit: number;
    weekly_limit: number;
    monthly_limit: number;
    pity_cap: number;
    updated_at: Date;
}

// ── Input types ───────────────────────────────────────────────────────────────

export type UpdateRewardTierData = {
    reward_min?: number;
    reward_max?: number;
    coin_min?: number;
    coin_max?: number;
    weight?: number;
    is_active?: boolean;
};

export type UpdateUploadLimitsData = {
    daily_limit?: number;
    weekly_limit?: number;
    monthly_limit?: number;
    pity_cap?: number;
};

export interface ReferralConfig extends RowDataPacket {
    id: number;
    coins_min: number;
    coins_max: number;
    updated_at: Date;
}

export type UpdateReferralConfigData = {
    coins_min?: number;
    coins_max?: number;
};

// ── Response type — what the reward engine returns after a draw ───────────────

export type RewardDraw = {
    amount: number;                     // actual reward to credit
    coin_amount: number;                // actual coins to credit
    tier_name: RewardTierName;
    pity_triggered: boolean;
    decoys: [number, number];           // 2 higher-tier amounts for chest UI
};
