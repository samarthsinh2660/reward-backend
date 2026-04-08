-- Extract Bill & Pay — Schema DDL
-- Auto-executed by MySQL Docker container on first boot

CREATE TABLE IF NOT EXISTS users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(150),
  email           VARCHAR(255),
  phone           VARCHAR(20) NOT NULL UNIQUE,
  gender          ENUM('male', 'female', 'other'),
  role            ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  password_hash   VARCHAR(255),                         -- only set for admin accounts
  upi_id          VARCHAR(255),                         -- stored on first withdrawal
  wallet_balance  DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  is_onboarded    BOOLEAN NOT NULL DEFAULT FALSE,        -- false until onboarding form completed
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  pity_counter    INT NOT NULL DEFAULT 0,               -- tracks uploads since last bonus reward
  referral_code   VARCHAR(20) UNIQUE,                   -- generated on onboarding, shared by user
  referred_by     VARCHAR(20),                          -- referral code of the user who referred them
  coin_balance    INT NOT NULL DEFAULT 0,               -- separate from wallet; earned via referrals
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bills (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          INT NOT NULL,
  file_url         VARCHAR(500),                        -- NULL for failed bills (never stored if pipeline fails)
  sha256_hash      VARCHAR(64),                         -- SHA-256 of file bytes — exact duplicate gate (checked before FastAPI)
  phash            VARCHAR(20),                         -- perceptual hash — near-duplicate gate (computed by FastAPI)
  platform         VARCHAR(100),                        -- swiggy | zomato | zepto | blinkit | unknown
  order_id         VARCHAR(255),
  total_amount     DECIMAL(10, 2),
  bill_date        DATE,
  status           ENUM('queued', 'pending', 'processing', 'verified', 'rejected', 'failed') NOT NULL DEFAULT 'queued',
  rejection_reason VARCHAR(500),
  extracted_data   JSON,                                -- raw structured output from AI (ExtractedBillData)
  fraud_score      INT NOT NULL DEFAULT 0,              -- total fraud score from bill processor (admin filtering)
  fraud_signals    JSON,                                -- full fraud signal breakdown (admin review)
  reward_amount    DECIMAL(10, 2),                      -- amount assigned by reward engine (before claim)
  chest_decoys     JSON,                                -- pre-computed decoy amounts for chest UI [n1, n2]
  reward_claimed   BOOLEAN NOT NULL DEFAULT FALSE,      -- true after user opens chest and claims reward
  chest_opened     BOOLEAN NOT NULL DEFAULT FALSE,      -- true after user has viewed the chest opening UI
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  -- DB-level duplicate safety nets (critical for race-condition protection)
  UNIQUE KEY uniq_bill_sha256 (sha256_hash),
  UNIQUE KEY uniq_bill_phash (phash),
  UNIQUE KEY uniq_bill_order (order_id, platform)
);

CREATE TABLE IF NOT EXISTS cashback_transactions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  bill_id     INT,                                      -- nullable for manual admin credits/debits
  amount      DECIMAL(10, 2) NOT NULL,
  type        ENUM('credit', 'debit') NOT NULL DEFAULT 'credit',
  description VARCHAR(500),
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bill_id) REFERENCES bills(id)
);

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
);

CREATE TABLE IF NOT EXISTS tickets (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  bill_id       INT,                                    -- nullable (not all tickets are bill disputes)
  category      ENUM('bill_dispute', 'reward_issue', 'withdrawal_issue', 'other') NOT NULL,
  description   TEXT NOT NULL,
  attachment_url VARCHAR(500),                          -- optional screenshot upload
  status        ENUM('open', 'in_review', 'resolved', 'rejected') NOT NULL DEFAULT 'open',
  admin_comment TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bill_id) REFERENCES bills(id)
);

CREATE TABLE IF NOT EXISTS referral_transactions (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  referrer_user_id INT NOT NULL,                        -- user who shared their referral code
  referred_user_id INT NOT NULL,                        -- new user who used the code
  coins_awarded    INT NOT NULL,                        -- coins credited to referrer
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (referrer_user_id) REFERENCES users(id),
  FOREIGN KEY (referred_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reward_config (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tier_name   VARCHAR(50) NOT NULL,                    -- base / medium / high / jackpot
  reward_min  DECIMAL(10, 2) NOT NULL,
  reward_max  DECIMAL(10, 2) NOT NULL,
  weight      INT NOT NULL,                            -- higher = more common
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS upload_limits (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  daily_limit  INT NOT NULL DEFAULT 3,
  weekly_limit INT NOT NULL DEFAULT 10,
  monthly_limit INT NOT NULL DEFAULT 30,
  pity_cap     INT NOT NULL DEFAULT 15,                -- every Nth upload guaranteed bonus tier
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
