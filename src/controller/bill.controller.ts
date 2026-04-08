import crypto from 'crypto';
import { err, ok, Result } from 'neverthrow';
import { ERRORS, RequestError } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';
import { BillRepository } from '../repositories/bill.repository.ts';
import { RewardConfigRepository } from '../repositories/reward_config.repository.ts';
import { CashbackTransactionRepository } from '../repositories/cashback_transaction.repository.ts';
import { UserRepository } from '../repositories/user.repository.ts';
import { callBillProcessor } from '../services/bill-processor.service.ts';
import { uploadBillImage } from '../services/gcp-storage.service.ts';
import { drawReward } from './reward.controller.ts';
import {
    BillView, BillUploadResponse, ChestOpenResponse,
    BillStatus, ProcessedBillData,
    ProcessedBillBaseData,
    PersistProcessedBillOutcome,
    makeRejectedProcessedBillData,
    makePendingProcessedBillData,
    makeVerifiedProcessedBillData,
    toBillView,
} from '../models/bill.model.ts';
import { toPlatform } from '../utils/bill.utils.ts';
import { Paginated } from '../types/pagination.ts';

const logger = createLogger('@bill.controller');

// ── Fraud score thresholds (matches wahtisapp.md spec) ────────────────────────
const FRAUD_AUTO_APPROVE_MAX  = 49;
const FRAUD_MANUAL_REVIEW_MAX = 80;
// score > FRAUD_MANUAL_REVIEW_MAX → auto-reject

async function persistProcessedBill(
    billId: number,
    userId: number,
    data: ProcessedBillData
): Promise<PersistProcessedBillOutcome> {
    const saveResult = await BillRepository.updateProcessed(billId, data);
    if (saveResult.isOk()) return 'saved';

    // Repository returns DATABASE_ERROR in catch by guide rules.
    // On save failure, re-check duplicate signatures to distinguish collision vs infra issue.
    const phashCheck = await BillRepository.findByPhash(data.phash);
    if (phashCheck.isOk() && phashCheck.value && phashCheck.value.id !== billId) {
        await BillRepository.updateStatus(billId, 'rejected', 'Duplicate bill (visual match)');
        logger.info(`Bill ${billId} rejected during save due to pHash duplicate collision`);
        return 'duplicate';
    }

    if (data.order_id && data.platform) {
        const orderCheck = await BillRepository.findByOrderIdAndPlatform(
            data.order_id,
            data.platform,
            userId
        );
        if (orderCheck.isOk() && orderCheck.value && orderCheck.value.id !== billId) {
            await BillRepository.updateStatus(billId, 'rejected', 'Duplicate order ID');
            logger.info(`Bill ${billId} rejected during save due to order/platform duplicate collision`);
            return 'duplicate';
        }
    }

    logger.error(`Bill ${billId}: failed to persist processed data`, saveResult.error);
    await BillRepository.updateStatus(billId, 'failed', 'Internal error: could not save bill result');
    return 'failed';
}

// ── Phase 1: Accept upload (fast — returns in ~200ms) ─────────────────────────
// Validates limits + dedup, creates a queued bill row, returns bill_id immediately.
// The actual processing happens in processBillInBackground().

export const acceptBill = async (
    userId: number,
    file: Express.Multer.File
): Promise<Result<BillUploadResponse, RequestError>> => {

    // 1. Check upload limits before any external call
    const limitsResult = await RewardConfigRepository.getUploadLimits();
    if (limitsResult.isErr()) return err(limitsResult.error);
    const limits = limitsResult.value;

    const countsResult = await BillRepository.countUserUploads(userId);
    if (countsResult.isErr()) return err(countsResult.error);
    const counts = countsResult.value;

    if (counts.today >= limits.daily_limit)        return err(ERRORS.BILL_UPLOAD_LIMIT_REACHED);
    if (counts.this_week >= limits.weekly_limit)    return err(ERRORS.BILL_UPLOAD_LIMIT_REACHED);
    if (counts.this_month >= limits.monthly_limit)  return err(ERRORS.BILL_UPLOAD_LIMIT_REACHED);

    // 2. SHA-256 exact duplicate check (cheapest gate — no external calls)
    const sha256Hash = crypto
        .createHash('sha256')
        .update(file.buffer)
        .digest('hex');

    const dupCheck = await BillRepository.findBySha256Hash(sha256Hash);
    if (dupCheck.isErr()) return err(dupCheck.error);
    if (dupCheck.value) return err(ERRORS.BILL_DUPLICATE);

    // 3. Create bill row with status='queued' — background worker fills in the rest
    const queuedBill = await BillRepository.createQueued({ user_id: userId, sha256_hash: sha256Hash });
    if (queuedBill.isErr()) {
        // Race-safe duplicate fallback (DB unique collision between pre-check and insert)
        const raceDup = await BillRepository.findBySha256Hash(sha256Hash);
        if (raceDup.isOk() && raceDup.value) return err(ERRORS.BILL_DUPLICATE);
        return err(queuedBill.error);
    }

    return ok({
        bill_id: queuedBill.value.id,
        status: 'queued',
        platform: null,
        total_amount: null,
        fraud_score: 0,
        reward_pending: false,
        message: 'Bill received. Processing in background — check back shortly.',
    });
};

// ── Phase 2: Background processing ───────────────────────────────────────────
// Runs after the HTTP response is already sent. Calls FastAPI, runs reward engine,
// uploads to GCP, and updates the bill row to its final status.
// All errors are logged and written to the bill row — nothing throws.

export async function processBillInBackground(
    billId: number,
    userId: number,
    fileBuffer: Buffer,
    fileMimetype: string,
    fileOriginalname: string
): Promise<void> {

    // Mark as 'processing' so admin/client can distinguish "in queue" vs "being worked on"
    await BillRepository.updateStatus(billId, 'processing');

    // Fetch upload limits (needed for pity cap)
    const limitsResult = await RewardConfigRepository.getUploadLimits();
    if (limitsResult.isErr()) {
        logger.error(`Bill ${billId}: failed to fetch upload limits`, limitsResult.error);
        await BillRepository.updateStatus(billId, 'failed', 'Internal error: could not fetch config');
        return;
    }
    const limits = limitsResult.value;

    // Call FastAPI bill processor
    const processorResult = await callBillProcessor(fileBuffer, fileMimetype, fileOriginalname);
    if (!processorResult.ok) {
        logger.error(`Bill ${billId}: processor unavailable`, processorResult.error);
        await BillRepository.updateStatus(billId, 'failed', 'Bill processor unavailable');
        return;
    }

    const processorData = processorResult.data;

    // FastAPI pipeline failure — update row to failed
    if (processorData.status === 'failed') {
        await BillRepository.updateStatus(billId, 'failed', processorData.reason);
        logger.info(`Bill ${billId} failed processing — reason: ${processorData.reason}`);
        return;
    }

    // Integrity gate: FastAPI and Node must agree on exact file hash.
    const localHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    if (processorData.image_hash !== localHash) {
        logger.error(
            `Bill ${billId}: processor hash mismatch (node=${localHash.slice(0, 16)}..., fastapi=${processorData.image_hash.slice(0, 16)}...)`
        );
        await BillRepository.updateStatus(billId, 'failed', 'Integrity check failed');
        return;
    }

    const { extracted_data, phash, fraud_signals } = processorData;
    const fraudScore = fraud_signals.fraud_score;

    // Unsupported platform — bill is real but we don't support it yet
    if (!extracted_data.is_supported_platform) {
        const detectedPlatform = extracted_data.platform ?? 'unknown';
        await BillRepository.updateStatus(
            billId,
            'rejected',
            `unsupported_platform:${detectedPlatform}`
        );
        logger.info(`Bill ${billId} rejected — unsupported platform: ${detectedPlatform}`);
        return;
    }

    // pHash near-duplicate check (exclude self — this bill already exists in DB as queued/processing)
    const phashCheck = await BillRepository.findByPhash(phash);
    if (phashCheck.isErr()) {
        logger.error(`Bill ${billId}: failed to check pHash duplicate`, phashCheck.error);
        await BillRepository.updateStatus(billId, 'failed', 'Internal error: duplicate check failed');
        return;
    }
    if (phashCheck.value && phashCheck.value.id !== billId) {
        await BillRepository.updateStatus(billId, 'rejected', 'Duplicate bill (visual match)');
        logger.info(`Bill ${billId} rejected — phash duplicate of bill ${phashCheck.value.id}`);
        return;
    }

    // Cross-user duplicate: same order_id + platform from a different user
    if (extracted_data.order_id && extracted_data.platform) {
        const crossDup = await BillRepository.findByOrderIdAndPlatform(
            extracted_data.order_id,
            extracted_data.platform ?? '',
            userId
        );
        if (crossDup.isErr()) {
            logger.error(`Bill ${billId}: failed to check order duplicate`, crossDup.error);
            await BillRepository.updateStatus(billId, 'failed', 'Internal error: duplicate check failed');
            return;
        }
        if (crossDup.value) {
            await BillRepository.updateStatus(billId, 'rejected', 'Duplicate order ID');
            logger.info(`Bill ${billId} rejected — order_id duplicate`);
            return;
        }
    }

    // Determine status based on fraud score
    const billStatus: BillStatus =
        fraudScore > FRAUD_MANUAL_REVIEW_MAX ? 'rejected' :
        fraudScore > FRAUD_AUTO_APPROVE_MAX  ? 'pending'  :
        'verified';

    const platform = toPlatform(extracted_data.platform);
    const processedBase: ProcessedBillBaseData = {
        phash,
        platform,
        order_id: extracted_data.order_id,
        total_amount: extracted_data.total_amount,
        bill_date: extracted_data.order_date,
        extracted_data,
        fraud_score: fraudScore,
        fraud_signals,
    };

    // Auto-rejected — fill in metadata, no image stored
    if (billStatus === 'rejected') {
        const persist = await persistProcessedBill(
            billId,
            userId,
            makeRejectedProcessedBillData(processedBase, 'Auto-rejected: high fraud score')
        );
        if (persist !== 'saved') return;
        logger.info(`Bill ${billId} auto-rejected — fraud score ${fraudScore}`);
        return;
    }

    // Upload file to GCP (only verified and pending reach here)
    const uploadResult = await uploadBillImage(fileBuffer, userId, fileMimetype);
    if (uploadResult.isErr()) {
        logger.error(`Bill ${billId}: GCP upload failed`, uploadResult.error);
        await BillRepository.updateStatus(billId, 'failed', 'Image upload failed');
        return;
    }
    const fileUrl = uploadResult.value.url;

    // Pending (manual review) — save with image, no reward yet
    if (billStatus === 'pending') {
        const persist = await persistProcessedBill(
            billId,
            userId,
            makePendingProcessedBillData(processedBase, fileUrl)
        );
        if (persist !== 'saved') return;
        logger.info(`Bill ${billId} queued for manual review — fraud score ${fraudScore}`);
        return;
    }

    // Verified — run reward engine
    const tiersResult = await RewardConfigRepository.getActiveTiers();
    if (tiersResult.isErr() || tiersResult.value.length === 0) {
        logger.error(`Bill ${billId}: reward config missing`);
        await BillRepository.updateStatus(billId, 'failed', 'Reward config not found');
        return;
    }

    const userResult = await UserRepository.findById(userId);
    if (userResult.isErr()) {
        logger.error(`Bill ${billId}: user ${userId} not found`);
        await BillRepository.updateStatus(billId, 'failed', 'User not found');
        return;
    }

    const draw = drawReward(tiersResult.value, userResult.value.pity_counter, limits.pity_cap);

    const persist = await persistProcessedBill(
        billId,
        userId,
        makeVerifiedProcessedBillData(
            processedBase,
            fileUrl,
            draw.amount,
            draw.coin_amount,
            draw.decoys
        )
    );
    if (persist !== 'saved') return;

    // Update pity counter (non-fatal — bill + reward are already saved)
    const pityResult = draw.pity_triggered
        ? await UserRepository.resetPityCounter(userId)
        : await UserRepository.incrementPityCounter(userId);
    if (pityResult.isErr()) {
        logger.error(`Bill ${billId}: failed to update pity counter for user ${userId} — counter may be out of sync`, pityResult.error);
    }

    logger.info(`Bill ${billId} verified for user ${userId}. Reward: ₹${draw.amount} (${draw.tier_name})`);
}

// ── List user's bills ─────────────────────────────────────────────────────────

export const listBills = async (
    userId: number,
    limit: number,
    before?: number
): Promise<Result<Paginated<BillView>, RequestError>> => {
    const result = await BillRepository.findByUserId(userId, limit + 1, before);
    if (result.isErr()) return err(result.error);

    const rows = result.value;
    const hasNext = rows.length > limit;
    const data = rows.slice(0, limit).map(toBillView);

    return ok({
        data,
        pagination: {
            hasNext,
            nextCursor: hasNext ? data[data.length - 1].id : 0,
        },
    });
};

// ── Get single bill ───────────────────────────────────────────────────────────

export const getBill = async (
    userId: number,
    billId: number
): Promise<Result<BillView, RequestError>> => {
    const result = await BillRepository.findById(billId);
    if (result.isErr()) return err(result.error);
    if (!result.value) return err(ERRORS.BILL_NOT_FOUND);
    if (result.value.user_id !== userId) return err(ERRORS.BILL_NOT_OWNED);
    return ok(toBillView(result.value));
};

// ── Open chest ────────────────────────────────────────────────────────────────

export const openChest = async (
    userId: number,
    billId: number
): Promise<Result<ChestOpenResponse, RequestError>> => {
    const billResult = await BillRepository.findById(billId);
    if (billResult.isErr()) return err(billResult.error);

    const bill = billResult.value;
    if (!bill) return err(ERRORS.BILL_NOT_FOUND);
    if (bill.user_id !== userId) return err(ERRORS.BILL_NOT_OWNED);
    if (bill.status !== 'verified') return err(ERRORS.BILL_NOT_VERIFIED);
    if (bill.chest_opened === 1) return err(ERRORS.CHEST_ALREADY_OPENED);
    if (!bill.reward_amount) return err(ERRORS.BILL_NOT_VERIFIED);
    if (!bill.chest_decoys) return err(ERRORS.BILL_NOT_VERIFIED);
    if (!bill.coin_reward) return err(ERRORS.BILL_NOT_VERIFIED);

    // Atomically credit wallet + create cashback transaction
    const creditResult = await CashbackTransactionRepository.creditWalletAndCoins({
        user_id: userId,
        bill_id: billId,
        amount: bill.reward_amount,
        coins: bill.coin_reward,
        description: `Bill reward — ${bill.platform ?? 'unknown'} ₹${bill.total_amount ?? '?'}`,
    });
    if (creditResult.isErr()) return err(creditResult.error);

    // Mark chest as opened
    const openResult = await BillRepository.setChestOpened(billId);
    if (openResult.isErr()) return err(openResult.error);

    logger.info(`Chest opened for bill ${billId} by user ${userId}. Credited ₹${bill.reward_amount}`);

    return ok({
        bill_id: billId,
        your_reward: Number(bill.reward_amount),
        coin_reward: Number(bill.coin_reward),
        decoys: bill.chest_decoys,
        wallet_balance: creditResult.value.wallet_balance,
        coin_balance: creditResult.value.coin_balance,
    });
};

// ── Admin: list all bills ─────────────────────────────────────────────────────

export const adminListBills = async (
    limit: number,
    before?: number,
    status?: BillStatus
): Promise<Result<Paginated<BillView>, RequestError>> => {
    const result = await BillRepository.findAllAdmin(limit + 1, before, status);
    if (result.isErr()) return err(result.error);

    const rows = result.value;
    const hasNext = rows.length > limit;
    const data = rows.slice(0, limit).map(toBillView);

    return ok({
        data,
        pagination: {
            hasNext,
            nextCursor: hasNext ? data[data.length - 1].id : 0,
        },
    });
};

// ── Admin: approve bill (manual review) ──────────────────────────────────────

export const adminApproveBill = async (
    billId: number
): Promise<Result<BillView, RequestError>> => {
    const billResult = await BillRepository.findById(billId);
    if (billResult.isErr()) return err(billResult.error);
    const bill = billResult.value;
    if (!bill) return err(ERRORS.BILL_NOT_FOUND);
    if (bill.status !== 'pending') return err(ERRORS.BILL_NOT_VERIFIED);

    // Run reward engine for this bill
    const tiersResult = await RewardConfigRepository.getActiveTiers();
    if (tiersResult.isErr()) return err(tiersResult.error);
    if (tiersResult.value.length === 0) return err(ERRORS.REWARD_CONFIG_NOT_FOUND);

    const limitsResult = await RewardConfigRepository.getUploadLimits();
    if (limitsResult.isErr()) return err(limitsResult.error);

    const userResult = await UserRepository.findById(bill.user_id);
    if (userResult.isErr()) return err(userResult.error);

    const draw = drawReward(tiersResult.value, userResult.value.pity_counter, limitsResult.value.pity_cap);

    const setResult = await BillRepository.setVerified(
        billId,
        draw.amount,
        draw.coin_amount,
        draw.decoys
    );
    if (setResult.isErr()) return err(setResult.error);

    // Update pity counter (non-fatal — bill is already saved)
    const pityResult = draw.pity_triggered
        ? await UserRepository.resetPityCounter(bill.user_id)
        : await UserRepository.incrementPityCounter(bill.user_id);
    if (pityResult.isErr()) {
        logger.error(`Failed to update pity counter for user ${bill.user_id} on admin approve — counter may be out of sync`, pityResult.error);
    }

    const updated = await BillRepository.findById(billId);
    if (updated.isErr()) return err(updated.error);
    return ok(toBillView(updated.value!));
};

// ── Admin: reject bill ────────────────────────────────────────────────────────

export const adminRejectBill = async (
    billId: number,
    reason: string
): Promise<Result<BillView, RequestError>> => {
    const billResult = await BillRepository.findById(billId);
    if (billResult.isErr()) return err(billResult.error);
    const bill = billResult.value;
    if (!bill) return err(ERRORS.BILL_NOT_FOUND);
    if (!['pending', 'verified'].includes(bill.status)) {
        return err(ERRORS.BILL_NOT_FOUND);
    }

    const updateResult = await BillRepository.updateStatus(billId, 'rejected', reason);
    if (updateResult.isErr()) return err(updateResult.error);

    const updated = await BillRepository.findById(billId);
    if (updated.isErr()) return err(updated.error);
    return ok(toBillView(updated.value!));
};
