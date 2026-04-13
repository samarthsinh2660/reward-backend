import { db } from './db.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('@admin-analytics.bootstrap');

const ADMIN_ANALYTICS_SCHEMA_QUERIES = [
    `
    CREATE TABLE IF NOT EXISTS analytics_companies (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      platform_code VARCHAR(100) NOT NULL UNIQUE,
      company_name  VARCHAR(255) NOT NULL,
      company_type  VARCHAR(100),
      active_status BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS analytics_brands (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      brand_name VARCHAR(255) NOT NULL UNIQUE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS analytics_products (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      product_key     VARCHAR(191) NOT NULL UNIQUE,
      product_name    VARCHAR(255) NOT NULL,
      normalized_name VARCHAR(255) NOT NULL,
      brand_id        INT NULL,
      category_l1     VARCHAR(100) NULL,
      category_l2     VARCHAR(100) NULL,
      unit_type       VARCHAR(50) NULL,
      pack_size       VARCHAR(100) NULL,
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (brand_id) REFERENCES analytics_brands(id)
    )
    `,
    `
    CREATE TABLE IF NOT EXISTS bill_items (
      id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
      bill_id                 INT NOT NULL,
      company_id              INT NULL,
      brand_id                INT NULL,
      product_id              INT NULL,
      product_name_raw        VARCHAR(255) NOT NULL,
      product_name_normalized VARCHAR(255) NULL,
      category_l1             VARCHAR(100) NULL,
      category_l2             VARCHAR(100) NULL,
      quantity                DECIMAL(10, 2) NULL,
      unit_type               VARCHAR(50) NULL,
      unit_price              DECIMAL(10, 2) NULL,
      line_amount             DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      currency_code           VARCHAR(10) NOT NULL DEFAULT 'INR',
      city                    VARCHAR(100) NULL,
      area                    VARCHAR(100) NULL,
      bill_date               DATE NULL,
      created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (bill_id) REFERENCES bills(id),
      FOREIGN KEY (company_id) REFERENCES analytics_companies(id),
      FOREIGN KEY (brand_id) REFERENCES analytics_brands(id),
      FOREIGN KEY (product_id) REFERENCES analytics_products(id)
    )
    `,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS company_id INT NULL`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS merchant_name VARCHAR(255) NULL`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS region VARCHAR(100) NULL`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS state VARCHAR(100) NULL`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS city VARCHAR(100) NULL`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS area VARCHAR(100) NULL`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20) NULL`,
    `
    INSERT IGNORE INTO analytics_companies (platform_code, company_name, company_type)
    VALUES
      ('blinkit', 'Blinkit', 'quick_commerce'),
      ('zepto', 'Zepto', 'quick_commerce'),
      ('swiggy', 'Swiggy', 'food_delivery'),
      ('zomato', 'Zomato', 'food_delivery')
    `,
];

export async function ensureAdminAnalyticsSchema(): Promise<void> {
    for (const query of ADMIN_ANALYTICS_SCHEMA_QUERIES) {
        try {
            await db.query(query);
        } catch (error) {
            logger.error('Failed to apply admin analytics schema query', error);
            throw error;
        }
    }
}
