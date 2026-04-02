import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';
import { BillRepository } from '../repositories/bill.repository.ts';

const logger = createLogger('@bill-queue');

// ── Queue limits (spec: 10 workers + 100 overflow) ────────────────────────────
const MAX_CONCURRENT_WORKERS = 10;
const MAX_OVERFLOW_SIZE       = 100;

// ── State ─────────────────────────────────────────────────────────────────────
let activeWorkers = 0;
const overflowQueue: Array<() => void> = [];

/**
 * Fire-and-forget: enqueue a background processing task without blocking the caller.
 * The HTTP response is already sent before this task runs.
 *
 * billId is required so that if the queue is full and the task must be dropped,
 * the bill row can be marked failed immediately instead of staying stuck as 'queued'.
 *
 *   Upload received → acceptBill() → HTTP 200 sent → fireAndForget()
 *     → active workers < 10?  → run immediately
 *     → overflow queue < 100? → park here, run when a worker slot frees
 *     → overflow full         → mark bill failed so user knows to retry
 */
export function fireAndForget(
    billId: number,
    task: () => Promise<void>
): void {
    if (activeWorkers < MAX_CONCURRENT_WORKERS) {
        runVoidTask(task);
        return;
    }

    if (overflowQueue.length >= MAX_OVERFLOW_SIZE) {
        logger.warn(`Queue full — bill ${billId} dropped (overflow=${overflowQueue.length})`);
        // Mark failed so user sees an error instead of waiting forever
        BillRepository.updateStatus(billId, 'failed', 'Server busy — please retry').then((r) => {
            if (r.isErr()) logger.error(`Bill ${billId}: failed to mark as failed after queue drop`);
        });
        return;
    }

    overflowQueue.push(() => runVoidTask(task));
    logger.debug(`Bill ${billId} queued in overflow — position ${overflowQueue.length}`);
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
