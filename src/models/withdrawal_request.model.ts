import { RowDataPacket } from 'mysql2';

export const WITHDRAWAL_REQUESTS_TABLE = 'withdrawal_requests';

// ── Enum constants ────────────────────────────────────────────────────────────

export const WITHDRAWAL_STATUSES = ['pending', 'processed', 'rejected'] as const;
export type WithdrawalStatus = typeof WITHDRAWAL_STATUSES[number];

// ── CREATE TABLE (mirrors 01-tables.sql exactly) ──────────────────────────────

export const CREATE_WITHDRAWAL_REQUESTS_TABLE_QUERY = `
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  amount       DECIMAL(10, 2) NOT NULL,
  upi_id       VARCHAR(255) NOT NULL,
  status       ENUM('pending', 'processed', 'rejected') NOT NULL DEFAULT 'pending',
  admin_note   VARCHAR(500),
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
)
`;

// ── DB row type ───────────────────────────────────────────────────────────────

export interface WithdrawalRequest extends RowDataPacket {
    id: number;
    user_id: number;
    amount: number;
    upi_id: string;
    status: WithdrawalStatus;
    admin_note: string | null;
    created_at: Date;
    updated_at: Date;
}
