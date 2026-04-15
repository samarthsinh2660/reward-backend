import { RowDataPacket } from 'mysql2';

export const BANNER_TABLE = 'banners';

export const CREATE_BANNER_TABLE_QUERY = `
CREATE TABLE IF NOT EXISTS banners (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(255) NOT NULL,
  image_url     VARCHAR(500) NOT NULL,
  gcs_path      VARCHAR(500) NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
`;

export interface Banner extends RowDataPacket {
    id: number;
    title: string;
    image_url: string;
    gcs_path: string;
    display_order: number;
    is_active: number;   // TINYINT — 0 | 1
    created_at: Date;
    updated_at: Date;
}

export type BannerView = {
    id: number;
    title: string;
    image_url: string;
    display_order: number;
    is_active: boolean;
    created_at: Date;
};

export function toBannerView(row: Banner): BannerView {
    return {
        id: row.id,
        title: row.title,
        image_url: row.image_url,
        display_order: row.display_order,
        is_active: row.is_active === 1,
        created_at: row.created_at,
    };
}
