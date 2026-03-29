import { RowDataPacket } from 'mysql2';

export const REFERRAL_TRANSACTIONS_TABLE = 'referral_transactions';

// ── CREATE TABLE (mirrors 01-tables.sql exactly) ──────────────────────────────

export const CREATE_REFERRAL_TRANSACTIONS_TABLE_QUERY = `
CREATE TABLE IF NOT EXISTS referral_transactions (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  referrer_user_id INT NOT NULL,
  referred_user_id INT NOT NULL,
  coins_awarded    INT NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (referrer_user_id) REFERENCES users(id),
  FOREIGN KEY (referred_user_id) REFERENCES users(id)
)
`;

// ── DB row type ───────────────────────────────────────────────────────────────

export interface ReferralTransaction extends RowDataPacket {
    id: number;
    referrer_user_id: number;
    referred_user_id: number;
    coins_awarded: number;
    created_at: Date;
}
