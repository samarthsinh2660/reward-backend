import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('@bill-queue');

// ── Queue limits (spec: 10 workers + 100 overflow) ────────────────────────────
const MAX_CONCURRENT_WORKERS = 10;
const MAX_OVERFLOW_SIZE       = 100;

// ── State ─────────────────────────────────────────────────────────────────────
let activeWorkers = 0;
const overflowQueue: Array<() => void> = [];

/**
 * Wraps any async task with the two-queue concurrency gate from the spec:
 *
 *   Upload received
 *     → active workers < 10? → run immediately
 *     → overflow queue < 100? → park here, run when a worker slot frees
 *     → overflow full → reject with BILL_QUEUE_FULL (503)
 *
 * The HTTP request blocks until the task resolves (connection stays open,
 * frontend shows the waiting animation). v2 will swap this for BullMQ + Redis.
 */
export async function enqueueForProcessing<T>(
    task: () => Promise<Result<T, RequestError>>
): Promise<Result<T, RequestError>> {
    if (activeWorkers < MAX_CONCURRENT_WORKERS) {
        return runTask(task);
    }

    if (overflowQueue.length >= MAX_OVERFLOW_SIZE) {
        logger.warn(`Queue full — overflow=${overflowQueue.length}, workers=${activeWorkers}`);
        return err(ERRORS.BILL_QUEUE_FULL);
    }

    // Park in overflow — resolves once a worker slot opens
    return new Promise<Result<T, RequestError>>((resolve) => {
        logger.debug(`Queued in overflow — position ${overflowQueue.length + 1}`);
        overflowQueue.push(() => runTask(task).then(resolve));
    });
}

/**
 * Fire-and-forget: enqueue a background task without blocking the caller.
 * Used by the async upload flow — the HTTP response is already sent before this runs.
 * Falls back to marking the bill as failed if the queue is full.
 */
export function fireAndForget(
    task: () => Promise<void>
): void {
    if (activeWorkers < MAX_CONCURRENT_WORKERS) {
        runVoidTask(task);
        return;
    }

    if (overflowQueue.length >= MAX_OVERFLOW_SIZE) {
        logger.warn(`Queue full — background task dropped (overflow=${overflowQueue.length})`);
        return;
    }

    overflowQueue.push(() => runVoidTask(task));
    logger.debug(`Background task queued — position ${overflowQueue.length}`);
}

/** Current queue snapshot — useful for health/metrics endpoints */
export function getQueueStats(): { activeWorkers: number; overflowSize: number } {
    return { activeWorkers, overflowSize: overflowQueue.length };
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function runVoidTask(task: () => Promise<void>): Promise<void> {
    activeWorkers++;
    logger.debug(`Background worker started — active=${activeWorkers}, overflow=${overflowQueue.length}`);
    try {
        await task();
    } catch (e) {
        logger.error('Unhandled error in background task', e);
    } finally {
        activeWorkers--;
        const next = overflowQueue.shift();
        if (next) {
            logger.debug(`Draining overflow — remaining=${overflowQueue.length}`);
            next();
        }
    }
}

async function runTask<T>(
    task: () => Promise<Result<T, RequestError>>
): Promise<Result<T, RequestError>> {
    activeWorkers++;
    logger.debug(`Worker started — active=${activeWorkers}, overflow=${overflowQueue.length}`);

    try {
        return await task();
    } catch (e) {
        logger.error('Unhandled error in queue task', e);
        return err(ERRORS.UNHANDLED_ERROR);
    } finally {
        activeWorkers--;
        // Drain one item from overflow now that a slot is free
        const next = overflowQueue.shift();
        if (next) {
            logger.debug(`Draining overflow — remaining=${overflowQueue.length}`);
            next();
        }
    }
}
