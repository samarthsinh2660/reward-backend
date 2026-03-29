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
    BillStatus, toBillView,
} from '../models/bill.model.ts';
import { Paginated } from '../types/pagination.ts';

const logger = createLogger('@bill.controller');

// ── Fraud score thresholds (matches wahtisapp.md spec) ────────────────────────
const FRAUD_AUTO_APPROVE_MAX  = 49;
const FRAUD_MANUAL_REVIEW_MAX = 80;
// score > FRAUD_MANUAL_REVIEW_MAX → auto-reject

// ── Bill upload & processing ──────────────────────────────────────────────────

export const uploadBill = async (
    userId: number,
    file: Express.Multer.File
): Promise<Result<BillUploadResponse, RequestError>> => {

    // 1. Check upload limits before calling any external service
    const limitsResult = await RewardConfigRepository.getUploadLimits();
    if (limitsResult.isErr()) return err(limitsResult.error);
    const limits = limitsResult.value;

    const countsResult = await BillRepository.countUserUploads(userId);
    if (countsResult.isErr()) return err(countsResult.error);
    const counts = countsResult.value;

    if (counts.today >= limits.daily_limit) {
        return err(ERRORS.BILL_UPLOAD_LIMIT_REACHED);
    }
    if (counts.this_week >= limits.weekly_limit) {
        return err(ERRORS.BILL_UPLOAD_LIMIT_REACHED);
    }
    if (counts.this_month >= limits.monthly_limit) {
        return err(ERRORS.BILL_UPLOAD_LIMIT_REACHED);
    }

    // 2. SHA-256 exact duplicate check (cheapest gate — no external calls)
    const sha256Hash = crypto
        .createHash('sha256')
        .update(file.buffer)
        .digest('hex');

    const dupCheck = await BillRepository.findBySha256Hash(sha256Hash);
    if (dupCheck.isErr()) return err(dupCheck.error);
    if (dupCheck.value) return err(ERRORS.BILL_DUPLICATE);

    // 3. Call FastAPI bill processor
    const processorResult = await callBillProcessor(
        file.buffer,
        file.mimetype,
        file.originalname
    );
    if (!processorResult.ok) return err(processorResult.error);

    const processorData = processorResult.data;

    // 4. Handle FastAPI pipeline failures — save a failed record for fraud tracking
    if (processorData.status === 'failed') {
        await BillRepository.create({
            user_id: userId,
            file_url: null,     // nothing stored on failure — per spec
            sha256_hash: sha256Hash,
            phash: '',
            platform: 'unknown',
            order_id: null,
            total_amount: null,
            bill_date: null,
            status: 'failed',
            rejection_reason: processorData.reason,
            extracted_data: null,
            fraud_score: 0,
            fraud_signals: null,
            reward_amount: null,
            chest_decoys: null,
        });

        const reasonToError: Record<string, RequestError> = {
            quality_low:  ERRORS.BILL_QUALITY_LOW,
            ocr_failed:   ERRORS.BILL_OCR_FAILED,
            parse_failed: ERRORS.BILL_PARSE_FAILED,
            invalid_file: ERRORS.BILL_INVALID_FILE,
        };
        return err(reasonToError[processorData.reason] ?? ERRORS.BILL_PROCESSING_FAILED);
    }

    const { extracted_data, phash, fraud_signals } = processorData;
    const fraudScore = fraud_signals.fraud_score;

    // 5. pHash near-duplicate check
    const phashCheck = await BillRepository.findByPhash(phash);
    if (phashCheck.isErr()) return err(phashCheck.error);
    if (phashCheck.value) return err(ERRORS.BILL_DUPLICATE);

    // 6. Cross-user duplicate: same order_id + platform from a different user
    if (extracted_data.order_id && extracted_data.platform) {
        const crossDup = await BillRepository.findByOrderIdAndPlatform(
            extracted_data.order_id,
            extracted_data.platform ?? '',
            userId
        );
        if (crossDup.isErr()) return err(crossDup.error);
        if (crossDup.value) return err(ERRORS.BILL_DUPLICATE);
    }

    // 7. Determine status based on fraud score
    const billStatus: BillStatus =
        fraudScore > FRAUD_MANUAL_REVIEW_MAX ? 'rejected' :
        fraudScore > FRAUD_AUTO_APPROVE_MAX  ? 'pending'  :
        'verified';

    const rejectionReason =
        fraudScore > FRAUD_MANUAL_REVIEW_MAX
            ? 'Auto-rejected: high fraud score'
            : null;

    // 8. If auto-rejected — save (no image stored, per spec) and return
    if (billStatus === 'rejected') {
        const rejBill = await BillRepository.create({
            user_id: userId,
            file_url: null,
            sha256_hash: sha256Hash,
            phash,
            platform: (extracted_data.platform ?? 'unknown') as any,
            order_id: extracted_data.order_id,
            total_amount: extracted_data.total_amount,
            bill_date: extracted_data.order_date,
            status: 'rejected',
            rejection_reason: rejectionReason,
            extracted_data,
            fraud_score: fraudScore,
            fraud_signals,
            reward_amount: null,
            chest_decoys: null,
        });
        if (rejBill.isErr()) return err(rejBill.error);

        return err(ERRORS.BILL_AUTO_REJECTED);
    }

    // 9. All checks passed — upload image to GCP Cloud Storage (Mumbai)
    //    Only verified and pending bills reach here. Spec: "nothing stored unless pipeline succeeds."
    const tempBillId = Date.now(); // placeholder until DB insert; used only for GCS path
    const uploadResult = await uploadBillImage(file.buffer, userId, tempBillId);
    if (uploadResult.isErr()) return err(uploadResult.error);
    const fileUrl = uploadResult.value.url;

    // 10. For pending (manual review) — save with image URL, no reward yet
    if (billStatus === 'pending') {
        const pendingBill = await BillRepository.create({
            user_id: userId,
            file_url: fileUrl,
            sha256_hash: sha256Hash,
            phash,
            platform: (extracted_data.platform ?? 'unknown') as any,
            order_id: extracted_data.order_id,
            total_amount: extracted_data.total_amount,
            bill_date: extracted_data.order_date,
            status: 'pending',
            rejection_reason: null,
            extracted_data,
            fraud_score: fraudScore,
            fraud_signals,
            reward_amount: null,
            chest_decoys: null,
        });
        if (pendingBill.isErr()) return err(pendingBill.error);

        return ok({
            bill_id: pendingBill.value.id,
            status: 'pending',
            platform: pendingBill.value.platform,
            total_amount: pendingBill.value.total_amount,
            fraud_score: fraudScore,
            reward_pending: false,
            message: 'Your bill is under review. You will be notified once it is verified.',
        });
    }

    // 11. Verified — run reward engine
    const tiersResult = await RewardConfigRepository.getActiveTiers();
    if (tiersResult.isErr()) return err(tiersResult.error);
    if (tiersResult.value.length === 0) return err(ERRORS.REWARD_CONFIG_NOT_FOUND);

    const userResult = await UserRepository.findById(userId);
    if (userResult.isErr()) return err(userResult.error);

    const draw = drawReward(tiersResult.value, userResult.value.pity_counter, limits.pity_cap);

    // 12. Save verified bill with image URL + reward
    const billResult = await BillRepository.create({
        user_id: userId,
        file_url: fileUrl,
        sha256_hash: sha256Hash,
        phash,
        platform: (extracted_data.platform ?? 'unknown') as any,
        order_id: extracted_data.order_id,
        total_amount: extracted_data.total_amount,
        bill_date: extracted_data.order_date,
        status: 'verified',
        rejection_reason: null,
        extracted_data,
        fraud_score: fraudScore,
        fraud_signals,
        reward_amount: draw.amount,
        chest_decoys: draw.decoys,
    });
    if (billResult.isErr()) return err(billResult.error);

    // 12. Update pity counter
    if (draw.pity_triggered) {
        await UserRepository.resetPityCounter(userId);
    } else {
        await UserRepository.incrementPityCounter(userId);
    }

    logger.info(`Bill ${billResult.value.id} verified for user ${userId}. Reward: ₹${draw.amount} (${draw.tier_name})`);

    return ok({
        bill_id: billResult.value.id,
        status: 'verified',
        platform: billResult.value.platform,
        total_amount: billResult.value.total_amount,
        fraud_score: fraudScore,
        reward_pending: true,
        message: 'Bill verified! Open your reward chest.',
    });
};

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

    // Atomically credit wallet + create cashback transaction
    const creditResult = await CashbackTransactionRepository.creditWallet(
        userId,
        billId,
        bill.reward_amount,
        `Bill reward — ${bill.platform ?? 'unknown'} ₹${bill.total_amount ?? '?'}`
    );
    if (creditResult.isErr()) return err(creditResult.error);

    // Mark chest as opened
    const openResult = await BillRepository.setChestOpened(billId);
    if (openResult.isErr()) return err(openResult.error);

    logger.info(`Chest opened for bill ${billId} by user ${userId}. Credited ₹${bill.reward_amount}`);

    return ok({
        bill_id: billId,
        your_reward: Number(bill.reward_amount),
        decoys: bill.chest_decoys,
        wallet_balance: creditResult.value,
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

    const setResult = await BillRepository.setVerified(billId, draw.amount, draw.decoys);
    if (setResult.isErr()) return err(setResult.error);

    if (draw.pity_triggered) {
        await UserRepository.resetPityCounter(bill.user_id);
    } else {
        await UserRepository.incrementPityCounter(bill.user_id);
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
