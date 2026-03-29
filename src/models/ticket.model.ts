import { RowDataPacket } from 'mysql2';

export const TICKETS_TABLE = 'tickets';

// ── Enum constants ────────────────────────────────────────────────────────────

export const TICKET_CATEGORIES = ['bill_dispute', 'reward_issue', 'withdrawal_issue', 'other'] as const;
export type TicketCategory = typeof TICKET_CATEGORIES[number];

export const TICKET_STATUSES = ['open', 'in_review', 'resolved', 'rejected'] as const;
export type TicketStatus = typeof TICKET_STATUSES[number];

// ── CREATE TABLE (mirrors 01-tables.sql exactly) ──────────────────────────────

export const CREATE_TICKETS_TABLE_QUERY = `
CREATE TABLE IF NOT EXISTS tickets (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT NOT NULL,
  bill_id        INT,
  category       ENUM('bill_dispute', 'reward_issue', 'withdrawal_issue', 'other') NOT NULL,
  description    TEXT NOT NULL,
  attachment_url VARCHAR(500),
  status         ENUM('open', 'in_review', 'resolved', 'rejected') NOT NULL DEFAULT 'open',
  admin_comment  TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bill_id) REFERENCES bills(id)
)
`;

// ── DB row type ───────────────────────────────────────────────────────────────

export interface Ticket extends RowDataPacket {
    id: number;
    user_id: number;
    bill_id: number | null;
    category: TicketCategory;
    description: string;
    attachment_url: string | null;
    status: TicketStatus;
    admin_comment: string | null;
    created_at: Date;
    updated_at: Date;
}
