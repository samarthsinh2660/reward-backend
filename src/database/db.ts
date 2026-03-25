import mysql from 'mysql2/promise';
import { NODE_ENV, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER } from '../config/env.ts';

export const db = mysql.createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    port: Number(DB_PORT),
    waitForConnections: true,
    connectionLimit: 50,
    maxIdle: 10,
    idleTimeout: 60000,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
});

export const connectToDatabase = async () => {
    try {
        const connection = await db.getConnection();
        await connection.ping();
        connection.release();
        console.log(`MySQL pool connected successfully in ${NODE_ENV}`);
    } catch (error) {
        console.error('Error connecting to MySQL pool:', error);
        process.exit(1);
    }
};
