import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { PORT, CORS_ORIGIN } from './config/env.ts';
import { notFoundHandler, errorHandler } from './middleware/error.middleware.ts';
import { limiter } from './middleware/ratelimit.middleware.ts';
import { connectToDatabase } from './database/db.ts';
import { BillRepository } from './repositories/bill.repository.ts';
import healthRouter from './routes/health.route.ts';
import authRouter from './routes/auth.route.ts';
import adminAuthRouter from './routes/admin.auth.route.ts';
import billRouter from './routes/bill.route.ts';
import adminRewardRouter from './routes/admin.reward.route.ts';
import adminAnalyticsRouter from './routes/admin.analytics.route.ts';
import userRouter from './routes/user.route.ts';
import { createLogger } from './utils/logger.ts';

const logger = createLogger('app');

// On startup, any bill left in queued/processing was interrupted by a server crash or restart.
// Since file buffers are in-memory and lost, we can't re-process them — mark as failed so
// users know to re-upload rather than waiting forever.
async function recoverStrandedBills(): Promise<void> {
    const stranded = await BillRepository.findStranded();
    if (stranded.isErr()) {
        logger.warn('Could not check for stranded bills on startup');
        return;
    }
    if (stranded.value.length === 0) return;

    logger.warn(`Found ${stranded.value.length} stranded bill(s) from previous run — marking as failed`);
    for (const bill of stranded.value) {
        await BillRepository.updateStatus(
            bill.id,
            'failed',
            'Server restarted while processing — please re-upload'
        );
    }
}

async function start() {
    // Connect to MySQL before accepting requests
    await connectToDatabase();
    await recoverStrandedBills();

    const app: Application = express();

    // Global middleware
    app.use(limiter);
    app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Root
    app.get('/', (_req: Request, res: Response) => {
        res.json({ success: true, message: 'Extract Bill & Pay API is running' });
    });

    // Routes
    app.use('/api/health', healthRouter);
    app.use('/api/auth', authRouter);
    app.use('/api/users', userRouter);
    app.use('/api/admin/auth', adminAuthRouter);
    app.use('/api/bills', billRouter);
    app.use('/api/admin', adminRewardRouter);
    app.use('/api/admin/analytics', adminAnalyticsRouter);

    // Error handlers — must be last
    app.use(notFoundHandler);
    app.use(errorHandler);

    app.listen(PORT, () => {
        logger.info(`Server started on port ${PORT}`);
        logger.info(`Health check: http://localhost:${PORT}/api/health`);
    });
}

start();
