-- Extract Bill & Pay — Seed Data
-- Auto-executed by MySQL Docker container on first boot
-- Uses INSERT IGNORE to be idempotent

-- Admin user (default password: Admin@123 — change after first login)
INSERT IGNORE INTO users (id, name, email, phone, role, is_onboarded, password_hash) VALUES
(1, 'Admin', 'admin@billpay.com', '9999999999', 'admin', TRUE, '$2b$12$XC1Zirmv9UYbII6Cb66FA.S6brBTj.Q4zo7ZBmxlZS/O6BmqUl84.');

-- Default reward tiers (admin can update via dashboard)
INSERT IGNORE INTO reward_config (id, tier_name, reward_min, reward_max, coin_min, coin_max, weight) VALUES
(1, 'base',    2.00,  10.00, 110, 125, 70),
(2, 'medium',  11.00, 30.00, 126, 170, 20),
(3, 'high',    31.00, 60.00, 171, 240,  8),
(4, 'jackpot', 61.00, 80.00, 241, 320,  2);

-- Default upload limits + pity cap
INSERT IGNORE INTO upload_limits (id, daily_limit, weekly_limit, monthly_limit, pity_cap) VALUES
(1, 3, 10, 30, 15);
