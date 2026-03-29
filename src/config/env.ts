import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, '..', '..', `.env.${process.env.NODE_ENV || 'development'}.local`);
const result = config({ path: envPath });

if (result.error) {
    console.warn(`Warning: Environment file not found or couldn't be loaded`);
}

// Server
export const PORT = process.env.PORT || '3000';
export const NODE_ENV = process.env.NODE_ENV || 'development';

// Database
export const DB_HOST = process.env.DB_HOST!;
export const DB_USER = process.env.DB_USER!;
export const DB_PASSWORD = process.env.DB_PASSWORD!;
export const DB_NAME = process.env.DB_NAME!;
export const DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);

// JWT
export const JWT_SECRET = process.env.JWT_SECRET!;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;

// CORS
export const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Bill Processor microservice
export const BILL_PROCESSOR_URL = process.env.BILL_PROCESSOR_URL!;

// GCP Cloud Storage — Mumbai (asia-south1), Standard storage
// Bucket must be pre-created with Standard class in asia-south1 region
export const GCP_STORAGE_BUCKET = process.env.GCP_STORAGE_BUCKET!;
export const GCP_KEY_FILE       = process.env.GCP_KEY_FILE!;   // path to service account JSON

// MSG91 (OTP + SMS notifications)
export const MSG91_AUTH_TOKEN = process.env.MSG91_AUTH_TOKEN!;;
