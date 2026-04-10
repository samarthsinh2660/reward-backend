import { RowDataPacket } from 'mysql2';

export const BILL_TABLE = 'bills';

// ── Enum constants — import these in routes/queries, never hardcode strings ──

export const BILL_STATUSES = ['queued', 'pending', 'processing', 'verified', 'rejected', 'failed'] as const;
export type BillStatus = typeof BILL_STATUSES[number];

// Supported platforms — used for reward eligibility checks
export const SUPPORTED_PLATFORMS = ['swiggy', 'zomato', 'zepto', 'blinkit'] as const;
export type SupportedPlatform = typeof SUPPORTED_PLATFORMS[number];

// platform stored in DB is a free string — any detected name or "unknown"
export type BillPlatform = string;

// ── CREATE TABLE (mirrors 01-tables.sql exactly — do not edit, update SQL first) ──

export const CREATE_BILL_TABLE_QUERY = `
CREATE TABLE IF NOT EXISTS bills (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          INT NOT NULL,
  file_url         VARCHAR(500),
  sha256_hash      VARCHAR(64),
  phash            VARCHAR(20),
  platform         VARCHAR(100),
  order_id         VARCHAR(255),
  total_amount     DECIMAL(10, 2),
  bill_date        DATE,
  status           ENUM('queued', 'pending', 'processing', 'verified', 'rejected', 'failed') NOT NULL DEFAULT 'queued',
  rejection_reason VARCHAR(500),
  extracted_data   JSON,
  fraud_score      INT NOT NULL DEFAULT 0,
  fraud_signals    JSON,
  reward_amount    DECIMAL(10, 2),
  coin_reward      INT,
  chest_decoys     JSON,
  reward_claimed   BOOLEAN NOT NULL DEFAULT FALSE,
  chest_opened     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uniq_bill_sha256 (sha256_hash),
  UNIQUE KEY uniq_bill_phash (phash),
  UNIQUE KEY uniq_bill_order (order_id, platform)
)
`;

// ── DB row type ───────────────────────────────────────────────────────────────

export interface Bill extends RowDataPacket {
    id: number;
    user_id: number;
    file_url: string | null;
    sha256_hash: string | null;
    phash: string | null;
    platform: BillPlatform | null;
    order_id: string | null;
    total_amount: number | null;
    bill_date: Date | null;
    status: BillStatus;
    rejection_reason: string | null;
    extracted_data: object | null;
    fraud_score: number;
    fraud_signals: object | null;
    reward_amount: number | null;
    coin_reward: number | null;
    chest_decoys: [number, number] | null;
    reward_claimed: number;     // TINYINT — 0 | 1
    chest_opened: number;       // TINYINT — 0 | 1
    created_at: Date;
    updated_at: Date;
}

// ── Safe view for API responses ───────────────────────────────────────────────

export type BillView = {
    id: number;
    platform: BillPlatform | null;
    order_id: string | null;
    total_amount: number | null;
    bill_date: Date | null;
    status: BillStatus;
    rejection_reason: string | null;
    reward_amount: number | null;
    coin_reward: number | null;
    reward_claimed: boolean;
    chest_opened: boolean;
    created_at: Date;
    file_url: string | null;
    extracted_data: object | null;
};

// ── Input types ───────────────────────────────────────────────────────────────

// Minimal data needed to create the queued row before background processing starts
export type QueuedBillData = {
    user_id: number;
    sha256_hash: string;
};

export type BillUploadCounts = {
    today: number;
    this_week: number;
    this_month: number;
};

export type PersistProcessedBillOutcome = 'saved' | 'duplicate' | 'failed';

// Full extracted data written back to the bill row after background processing completes
export type ProcessedBillData = {
    phash: string;
    platform: BillPlatform;
    order_id: string | null;
    total_amount: number | null;
    bill_date: string | null;
    status: BillStatus;
    rejection_reason: string | null;
    extracted_data: object | null;
    fraud_score: number;
    fraud_signals: object | null;
    file_url: string | null;
    reward_amount: number | null;
    coin_reward: number | null;
    chest_decoys: [number, number] | null;
};

export type ProcessedBillBaseData = {
    phash: string;
    platform: BillPlatform;
    order_id: string | null;
    total_amount: number | null;
    bill_date: string | null;
    extracted_data: object | null;
    fraud_score: number;
    fraud_signals: object | null;
};

export function makeRejectedProcessedBillData(
    base: ProcessedBillBaseData,
    rejectionReason: string
): ProcessedBillData {
    return {
        ...base,
        status: 'rejected',
        rejection_reason: rejectionReason,
        file_url: null,
        reward_amount: null,
        coin_reward: null,
        chest_decoys: null,
    };
}

export function makePendingProcessedBillData(
    base: ProcessedBillBaseData,
    fileUrl: string
): ProcessedBillData {
    return {
        ...base,
        status: 'pending',
        rejection_reason: null,
        file_url: fileUrl,
        reward_amount: null,
        coin_reward: null,
        chest_decoys: null,
    };
}

export function makeVerifiedProcessedBillData(
    base: ProcessedBillBaseData,
    fileUrl: string,
    rewardAmount: number,
    coinReward: number,
    chestDecoys: [number, number]
): ProcessedBillData {
    return {
        ...base,
        status: 'verified',
        rejection_reason: null,
        file_url: fileUrl,
        reward_amount: rewardAmount,
        coin_reward: coinReward,
        chest_decoys: chestDecoys,
    };
}

export type CreateBillData = {
    user_id: number;
    file_url: string | null;           // Cloudinary URL — null on failure/pending bills
    sha256_hash: string;
    phash: string;
    platform: BillPlatform;
    order_id: string | null;
    total_amount: number | null;
    bill_date: string | null;          // ISO date YYYY-MM-DD
    status: BillStatus;
    rejection_reason: string | null;
    extracted_data: object | null;
    fraud_score: number;
    fraud_signals: object | null;
    reward_amount: number | null;
    coin_reward: number | null;
    chest_decoys: [number, number] | null;
};

// ── Response types (defined in model — not in routes) ─────────────────────────

export type BillUploadResponse = {
    bill_id: number;
    status: BillStatus;
    platform: BillPlatform | null;
    total_amount: number | null;
    fraud_score: number;
    reward_pending: boolean;    // true when status=verified and chest not yet opened
    message: string;
};

export type ChestOpenResponse = {
    bill_id: number;
    your_reward: number;
    coin_reward: number;
    decoys: [number, number];
    wallet_balance: number;
    coin_balance: number;
};

// ── Converters ────────────────────────────────────────────────────────────────

export function isSupportedPlatform(platform: string | null): platform is SupportedPlatform {
    return (SUPPORTED_PLATFORMS as readonly string[]).includes(platform ?? '');
}

export function toBillView(row: Bill): BillView {
    return {
        id: row.id,
        platform: row.platform,
        order_id: row.order_id,
        total_amount: row.total_amount !== null ? Number(row.total_amount) : null,
        bill_date: row.bill_date,
        status: row.status,
        rejection_reason: row.rejection_reason,
        reward_amount: row.reward_amount !== null ? Number(row.reward_amount) : null,
        coin_reward: row.coin_reward !== null ? Number(row.coin_reward) : null,
        reward_claimed: row.reward_claimed === 1,
        chest_opened: row.chest_opened === 1,
        created_at: row.created_at,
        file_url: row.file_url,
        extracted_data: row.extracted_data ?? null,
    };
}
