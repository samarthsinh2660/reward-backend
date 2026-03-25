-- Extract Bill & Pay — Seed Data
-- Auto-executed by MySQL Docker container on first boot
-- Uses INSERT IGNORE to be idempotent

INSERT IGNORE INTO users (id, name, email, password_hash, role) VALUES
(1, 'Admin User', 'admin@billpay.com', '$2a$12$placeholder_hash_replace_me', 'admin');
