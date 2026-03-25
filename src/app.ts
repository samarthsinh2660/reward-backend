import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { PORT, CORS_ORIGIN } from './config/env.ts';
import { notFoundHandler, errorHandler } from './middleware/error.middleware.ts';
import healthRouter from './routes/health.route.ts';
import { createLogger } from './utils/logger.ts';

const logger = createLogger('app');

async function start() {
    const app: Application = express();

    // Global middleware
    app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Root
    app.get('/', (_req: Request, res: Response) => {
        res.json({ success: true, message: 'Extract Bill & Pay API is running' });
    });

    // Routes
    app.use('/api/health', healthRouter);

    // Error handlers — must be last
    app.use(notFoundHandler);
    app.use(errorHandler);

    app.listen(PORT, () => {
        logger.info(`Server started on port ${PORT}`);
        logger.info(`Health check: http://localhost:${PORT}/api/health`);
    });
}

start();
