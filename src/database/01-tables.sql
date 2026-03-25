-- Extract Bill & Pay — Schema DDL
-- Auto-executed by MySQL Docker container on first boot

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  phone         VARCHAR(20),
  role          ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  wallet_balance DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bills (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  image_url       VARCHAR(500) NOT NULL,
  platform        VARCHAR(100),
  order_id        VARCHAR(255),
  total_amount    DECIMAL(10, 2),
  bill_date       DATE,
  status          ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
  rejection_reason VARCHAR(500),
  extracted_data  JSON,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cashback_transactions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  bill_id     INT NOT NULL,
  amount      DECIMAL(10, 2) NOT NULL,
  type        ENUM('credit', 'debit') NOT NULL DEFAULT 'credit',
  description VARCHAR(500),
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (bill_id) REFERENCES bills(id)
);
