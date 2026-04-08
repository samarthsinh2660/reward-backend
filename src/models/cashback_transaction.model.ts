import { RowDataPacket } from 'mysql2';

export const CASHBACK_TRANSACTIONS_TABLE = 'cashback_transactions';

// ── Enum constants ────────────────────────────────────────────────────────────

export const TRANSACTION_TYPES = ['credit', 'debit'] as const;
export type TransactionType = typeof TRANSACTION_TYPES[number];

// ── CREATE TABLE (mirrors 01-tables.sql exactly) ──────────────────────────────

export const CREATE_CASHBACK_TRANSACTIONS_TABLE_QUERY = `
CREATE TABLE IF NOT EXISTS cashback_transactions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  bill_id     INT,
  amount      DECIMAL(10, 2) NOT NULL,
  type        ENUM('credit', 'debit') NOT NULL DEFAULT 'credit',
  description VARCHAR(500),
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bill_id) REFERENCES bills(id)
)
`;

// ── DB row type ───────────────────────────────────────────────────────────────

export interface CashbackTransaction extends RowDataPacket {
    id: number;
    user_id: number;
    bill_id: number | null;
    amount: number;
    type: TransactionType;
    description: string | null;
    created_at: Date;
}

// ── Input / response types ───────────────────────────────────────────────────

export type CreditWalletAndCoinsData = {
    user_id: number;
    bill_id: number;
    amount: number;
    coins: number;
    description: string;
};

export type WalletAndCoinBalance = {
    wallet_balance: number;
    coin_balance: number;
};
