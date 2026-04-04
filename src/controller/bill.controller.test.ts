import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ok, err } from 'neverthrow';
import { ERRORS } from '../utils/error.ts';

// ─── MOCKS ────────────────────────────────────────────────────────────────────

const mockBillRepository = {
    create:                    jest.fn<any>(),
    createQueued:              jest.fn<any>(),
    updateProcessed:           jest.fn<any>(),
    findById:                  jest.fn<any>(),
    findByUserId:              jest.fn<any>(),
    findBySha256Hash:          jest.fn<any>(),
    findByPhash:               jest.fn<any>(),
    findByOrderIdAndPlatform:  jest.fn<any>(),
    updateStatus:              jest.fn<any>(),
    setVerified:               jest.fn<any>(),
    setChestOpened:            jest.fn<any>(),
    countUserUploads:          jest.fn<any>(),
    findAllAdmin:              jest.fn<any>(),
};

const mockRewardConfigRepository = {
    getActiveTiers:   jest.fn<any>(),
    getAllTiers:       jest.fn<any>(),
    getUploadLimits:  jest.fn<any>(),
    updateTier:       jest.fn<any>(),
    updateUploadLimits: jest.fn<any>(),
};

const mockCashbackTransactionRepository = {
    creditWallet: jest.fn<any>(),
};

const mockUserRepository = {
    findById:              jest.fn<any>(),
    findByPhone:           jest.fn<any>(),
    findByPhoneWithPassword: jest.fn<any>(),
    findByReferralCode:    jest.fn<any>(),
    create:                jest.fn<any>(),
    onboard:               jest.fn<any>(),
    addCoins:              jest.fn<any>(),
    incrementPityCounter:  jest.fn<any>(),
    resetPityCounter:      jest.fn<any>(),
};

const mockCallBillProcessor = jest.fn<any>();
const mockDrawReward        = jest.fn<any>();
const mockUploadBillImage   = jest.fn<any>();

jest.unstable_mockModule('../repositories/bill.repository.ts', () => ({
    BillRepository: mockBillRepository,
}));

jest.unstable_mockModule('../repositories/reward_config.repository.ts', () => ({
    RewardConfigRepository: mockRewardConfigRepository,
}));

jest.unstable_mockModule('../repositories/cashback_transaction.repository.ts', () => ({
    CashbackTransactionRepository: mockCashbackTransactionRepository,
}));

jest.unstable_mockModule('../repositories/user.repository.ts', () => ({
    UserRepository: mockUserRepository,
}));

jest.unstable_mockModule('../services/bill-processor.service.ts', () => ({
    callBillProcessor: mockCallBillProcessor,
}));

jest.unstable_mockModule('../services/gcp-storage.service.ts', () => ({
    uploadBillImage: mockUploadBillImage,
}));

jest.unstable_mockModule('./reward.controller.ts', () => ({
    drawReward: mockDrawReward,
}));

const {
    acceptBill: uploadBill,
    processBillInBackground,
    listBills, getBill, openChest, adminListBills, adminApproveBill, adminRejectBill,
} = await import('./bill.controller.ts');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const clear = () => jest.clearAllMocks();

function makeMullerFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
    return {
        fieldname:    'file',
        originalname: 'bill.jpg',
        encoding:     '7bit',
        mimetype:     'image/jpeg',
        buffer:       Buffer.from('fake-image-data'),
        size:         1024,
        destination:  '',
        filename:     '',
        path:         '',
        stream:       null as any,
        ...overrides,
    };
}

function makeBillRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        user_id: 10,
        file_url: 'https://storage.googleapis.com/bucket/bills/10/bill_1.jpg',
        sha256_hash: 'a'.repeat(64),
        phash: 'abcdef123456',
        platform: 'swiggy',
        order_id: 'ORD-001',
        total_amount: 250.00,
        bill_date: new Date('2024-06-01'),
        status: 'verified',
        rejection_reason: null,
        extracted_data: {},
        fraud_score: 10,
        fraud_signals: {},
        reward_amount: 15.50,
        chest_decoys: [22.00, 45.00] as [number, number],
        reward_claimed: 0,
        chest_opened: 0,
        created_at: new Date('2024-06-01'),
        updated_at: new Date('2024-06-01'),
        constructor: { name: 'RowDataPacket' },
        ...overrides,
    };
}

function makeUploadLimits(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        daily_limit: 3,
        weekly_limit: 10,
        monthly_limit: 30,
        pity_cap: 15,
        updated_at: new Date(),
        constructor: { name: 'RowDataPacket' },
        ...overrides,
    };
}

function makeUploadCounts(overrides: Record<string, unknown> = {}) {
    return { today: 0, this_week: 0, this_month: 0, ...overrides };
}

function makeUser(overrides: Record<string, unknown> = {}) {
    return {
        id: 10, name: 'Test User', phone: '919876543210', email: null, gender: null,
        role: 'user', password_hash: null, upi_id: null, wallet_balance: 100,
        is_onboarded: 1, is_active: 1, pity_counter: 5,
        referral_code: 'USER0001', referred_by: null, coin_balance: 0,
        created_at: new Date(), updated_at: new Date(),
        constructor: { name: 'RowDataPacket' },
        ...overrides,
    };
}

function makeActiveTiers() {
    return [
        { id: 1, tier_name: 'base',    reward_min: 2,  reward_max: 10,  weight: 70, is_active: 1 },
        { id: 2, tier_name: 'medium',  reward_min: 11, reward_max: 30,  weight: 20, is_active: 1 },
        { id: 3, tier_name: 'high',    reward_min: 31, reward_max: 60,  weight: 8,  is_active: 1 },
        { id: 4, tier_name: 'jackpot', reward_min: 61, reward_max: 80,  weight: 2,  is_active: 1 },
    ];
}

function makeProcessorSuccess(overrides: Record<string, unknown> = {}) {
    return {
        ok: true,
        data: {
            status: 'success',
            phash: 'abcdef123456',
            extracted_data: {
                platform: 'zepto',
                is_supported_platform: true,
                order_id: 'ORD-001',
                total_amount: 250.00,
                order_date: '2024-06-01',
                items: [],
            },
            fraud_signals: {
                fraud_score: 10,
                font_anomaly: false,
                metadata_mismatch: false,
                wrong_platform: false,
                amount_out_of_range: false,
                duplicate_suspected: false,
                low_resolution: false,
                tampering_detected: false,
                tampering_confidence: 0.05,
            },
            ...overrides,
        },
    };
}

function makeDrawResult(overrides: Record<string, unknown> = {}) {
    return {
        amount: 15.50,
        tier_name: 'base',
        pity_triggered: false,
        decoys: [22.00, 45.00] as [number, number],
        ...overrides,
    };
}

// Happy-path setup for processBillInBackground
function setupProcessHappy() {
    mockBillRepository.updateStatus.mockResolvedValue(ok(undefined));
    mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits()));
    mockCallBillProcessor.mockResolvedValue(makeProcessorSuccess());
    mockBillRepository.findByPhash.mockResolvedValue(ok(null));
    mockBillRepository.findByOrderIdAndPlatform.mockResolvedValue(ok(null));
    mockUploadBillImage.mockResolvedValue(ok({
        url:      'https://storage.googleapis.com/bucket/bills/10/bill_1.jpg',
        gcs_path: 'gs://bucket/bills/10/bill_1.jpg',
    }));
    mockRewardConfigRepository.getActiveTiers.mockResolvedValue(ok(makeActiveTiers()));
    mockUserRepository.findById.mockResolvedValue(ok(makeUser()));
    mockDrawReward.mockReturnValue(makeDrawResult());
    mockBillRepository.updateProcessed.mockResolvedValue(ok(undefined));
    mockUserRepository.incrementPityCounter.mockResolvedValue(ok(undefined));
    mockUserRepository.resetPityCounter.mockResolvedValue(ok(undefined));
}

// ─── acceptBill (phase 1 — sync) ─────────────────────────────────────────────

describe('uploadBill', () => {
    beforeEach(clear);

    it('returns queued response and calls createQueued on happy path', async () => {
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits()));
        mockBillRepository.countUserUploads.mockResolvedValue(ok(makeUploadCounts()));
        mockBillRepository.findBySha256Hash.mockResolvedValue(ok(null));
        mockBillRepository.createQueued.mockResolvedValue(ok(makeBillRow({ id: 7, status: 'queued' })));

        const result = await uploadBill(10, makeMullerFile());

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.status).toBe('queued');
            expect(result.value.bill_id).toBe(7);
            expect(result.value.reward_pending).toBe(false);
        }
        expect(mockBillRepository.createQueued).toHaveBeenCalledWith(
            expect.objectContaining({ user_id: 10 })
        );
    });

    it('returns BILL_UPLOAD_LIMIT_REACHED when daily limit exceeded', async () => {
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits({ daily_limit: 2 })));
        mockBillRepository.countUserUploads.mockResolvedValue(ok(makeUploadCounts({ today: 2 })));

        const result = await uploadBill(10, makeMullerFile());

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.BILL_UPLOAD_LIMIT_REACHED);
    });

    it('returns BILL_UPLOAD_LIMIT_REACHED when weekly limit exceeded', async () => {
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits({ weekly_limit: 5 })));
        mockBillRepository.countUserUploads.mockResolvedValue(ok(makeUploadCounts({ this_week: 5 })));

        const result = await uploadBill(10, makeMullerFile());

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.BILL_UPLOAD_LIMIT_REACHED);
    });

    it('returns BILL_UPLOAD_LIMIT_REACHED when monthly limit exceeded', async () => {
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits({ monthly_limit: 10 })));
        mockBillRepository.countUserUploads.mockResolvedValue(ok(makeUploadCounts({ this_month: 10 })));

        const result = await uploadBill(10, makeMullerFile());

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.BILL_UPLOAD_LIMIT_REACHED);
    });

    it('returns BILL_DUPLICATE when SHA-256 hash already exists', async () => {
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits()));
        mockBillRepository.countUserUploads.mockResolvedValue(ok(makeUploadCounts()));
        mockBillRepository.findBySha256Hash.mockResolvedValue(ok(makeBillRow()));

        const result = await uploadBill(10, makeMullerFile());

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.BILL_DUPLICATE);
        expect(mockBillRepository.createQueued).not.toHaveBeenCalled();
    });

    it('propagates DB error from getUploadLimits', async () => {
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(err(ERRORS.DATABASE_ERROR));

        const result = await uploadBill(10, makeMullerFile());

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DATABASE_ERROR);
    });

    it('propagates DB error from createQueued', async () => {
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits()));
        mockBillRepository.countUserUploads.mockResolvedValue(ok(makeUploadCounts()));
        mockBillRepository.findBySha256Hash.mockResolvedValue(ok(null));
        mockBillRepository.createQueued.mockResolvedValue(err(ERRORS.DATABASE_ERROR));

        const result = await uploadBill(10, makeMullerFile());

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DATABASE_ERROR);
    });
});

// ─── processBillInBackground (phase 2 — async) ───────────────────────────────

describe('processBillInBackground', () => {
    const FILE = Buffer.from('fake-image-data');
    beforeEach(clear);

    it('marks bill as verified and calls updateProcessed on happy path', async () => {
        setupProcessHappy();

        await processBillInBackground(1, 10, FILE, 'image/jpeg', 'bill.jpg');

        expect(mockBillRepository.updateStatus).toHaveBeenCalledWith(1, 'processing');
        expect(mockBillRepository.updateProcessed).toHaveBeenCalledWith(
            1, expect.objectContaining({ status: 'verified', reward_amount: 15.50 })
        );
    });

    it('marks failed when processor is unavailable', async () => {
        mockBillRepository.updateStatus.mockResolvedValue(ok(undefined));
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits()));
        mockCallBillProcessor.mockResolvedValue({ ok: false, error: ERRORS.BILL_PROCESSOR_UNAVAILABLE });

        await processBillInBackground(1, 10, FILE, 'image/jpeg', 'bill.jpg');

        expect(mockBillRepository.updateStatus).toHaveBeenLastCalledWith(1, 'failed', 'Bill processor unavailable');
    });

    it('marks failed when FastAPI returns quality_low failure', async () => {
        mockBillRepository.updateStatus.mockResolvedValue(ok(undefined));
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits()));
        mockCallBillProcessor.mockResolvedValue({ ok: true, data: { status: 'failed', reason: 'quality_low' } });

        await processBillInBackground(1, 10, FILE, 'image/jpeg', 'bill.jpg');

        expect(mockBillRepository.updateStatus).toHaveBeenLastCalledWith(1, 'failed', 'quality_low');
    });

    it('marks rejected when pHash near-duplicate found (different bill)', async () => {
        mockBillRepository.updateStatus.mockResolvedValue(ok(undefined));
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits()));
        mockCallBillProcessor.mockResolvedValue(makeProcessorSuccess());
        // pHash match returns a DIFFERENT bill id (not the same bill being processed)
        mockBillRepository.findByPhash.mockResolvedValue(ok(makeBillRow({ id: 999 })));

        await processBillInBackground(1, 10, FILE, 'image/jpeg', 'bill.jpg');

        expect(mockBillRepository.updateStatus).toHaveBeenLastCalledWith(1, 'rejected', 'Duplicate bill (visual match)');
    });

    it('does NOT reject when pHash match is the same bill (self-exclusion)', async () => {
        setupProcessHappy();
        // pHash returns the SAME bill id (bill 1 finding itself)
        mockBillRepository.findByPhash.mockResolvedValue(ok(makeBillRow({ id: 1 })));

        await processBillInBackground(1, 10, FILE, 'image/jpeg', 'bill.jpg');

        expect(mockBillRepository.updateProcessed).toHaveBeenCalledWith(
            1, expect.objectContaining({ status: 'verified' })
        );
    });

    it('marks rejected when cross-user order_id + platform duplicate found', async () => {
        mockBillRepository.updateStatus.mockResolvedValue(ok(undefined));
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits()));
        mockCallBillProcessor.mockResolvedValue(makeProcessorSuccess());
        mockBillRepository.findByPhash.mockResolvedValue(ok(null));
        mockBillRepository.findByOrderIdAndPlatform.mockResolvedValue(ok(makeBillRow({ user_id: 99 })));

        await processBillInBackground(1, 10, FILE, 'image/jpeg', 'bill.jpg');

        expect(mockBillRepository.updateStatus).toHaveBeenLastCalledWith(1, 'rejected', 'Duplicate order ID');
    });

    it('marks pending for fraud score 50-80 (no reward assigned)', async () => {
        mockBillRepository.updateStatus.mockResolvedValue(ok(undefined));
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits()));
        mockCallBillProcessor.mockResolvedValue(makeProcessorSuccess({
            fraud_signals: {
                fraud_score: 65,
                font_anomaly: false, metadata_mismatch: false, wrong_platform: false,
                amount_out_of_range: false, duplicate_suspected: false,
                low_resolution: false, tampering_detected: false, tampering_confidence: 0.1,
            },
        }));
        mockBillRepository.findByPhash.mockResolvedValue(ok(null));
        mockBillRepository.findByOrderIdAndPlatform.mockResolvedValue(ok(null));
        mockUploadBillImage.mockResolvedValue(ok({ url: 'https://storage.googleapis.com/b/f.jpg', gcs_path: 'gs://b/f.jpg' }));
        mockBillRepository.updateProcessed.mockResolvedValue(ok(undefined));

        await processBillInBackground(1, 10, FILE, 'image/jpeg', 'bill.jpg');

        expect(mockBillRepository.updateProcessed).toHaveBeenCalledWith(
            1, expect.objectContaining({ status: 'pending', reward_amount: null })
        );
    });

    it('marks rejected for fraud score > 80 without uploading image', async () => {
        mockBillRepository.updateStatus.mockResolvedValue(ok(undefined));
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits()));
        mockCallBillProcessor.mockResolvedValue(makeProcessorSuccess({
            fraud_signals: {
                fraud_score: 95,
                font_anomaly: true, metadata_mismatch: true, wrong_platform: false,
                amount_out_of_range: true, duplicate_suspected: false,
                low_resolution: false, tampering_detected: true, tampering_confidence: 0.9,
            },
        }));
        mockBillRepository.findByPhash.mockResolvedValue(ok(null));
        mockBillRepository.findByOrderIdAndPlatform.mockResolvedValue(ok(null));
        mockBillRepository.updateProcessed.mockResolvedValue(ok(undefined));

        await processBillInBackground(1, 10, FILE, 'image/jpeg', 'bill.jpg');

        expect(mockBillRepository.updateProcessed).toHaveBeenCalledWith(
            1, expect.objectContaining({ status: 'rejected', file_url: null })
        );
        // Image upload must NOT happen for auto-rejected bills
        expect(mockUploadBillImage).not.toHaveBeenCalled();
    });

    it('marks failed when reward config has no active tiers', async () => {
        mockBillRepository.updateStatus.mockResolvedValue(ok(undefined));
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits()));
        mockCallBillProcessor.mockResolvedValue(makeProcessorSuccess());
        mockBillRepository.findByPhash.mockResolvedValue(ok(null));
        mockBillRepository.findByOrderIdAndPlatform.mockResolvedValue(ok(null));
        mockUploadBillImage.mockResolvedValue(ok({ url: 'https://storage.googleapis.com/b/f.jpg', gcs_path: 'gs://b/f.jpg' }));
        mockRewardConfigRepository.getActiveTiers.mockResolvedValue(ok([]));

        await processBillInBackground(1, 10, FILE, 'image/jpeg', 'bill.jpg');

        expect(mockBillRepository.updateStatus).toHaveBeenLastCalledWith(1, 'failed', 'Reward config not found');
    });

    it('resets pity counter when pity was triggered', async () => {
        setupProcessHappy();
        mockDrawReward.mockReturnValue(makeDrawResult({ pity_triggered: true }));

        await processBillInBackground(1, 10, FILE, 'image/jpeg', 'bill.jpg');

        expect(mockUserRepository.resetPityCounter).toHaveBeenCalledWith(10);
        expect(mockUserRepository.incrementPityCounter).not.toHaveBeenCalled();
    });

    it('increments pity counter when pity was not triggered', async () => {
        setupProcessHappy();
        mockDrawReward.mockReturnValue(makeDrawResult({ pity_triggered: false }));

        await processBillInBackground(1, 10, FILE, 'image/jpeg', 'bill.jpg');

        expect(mockUserRepository.incrementPityCounter).toHaveBeenCalledWith(10);
        expect(mockUserRepository.resetPityCounter).not.toHaveBeenCalled();
    });

    it('marks failed when getUploadLimits errors in background', async () => {
        mockBillRepository.updateStatus.mockResolvedValue(ok(undefined));
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(err(ERRORS.DATABASE_ERROR));

        await processBillInBackground(1, 10, FILE, 'image/jpeg', 'bill.jpg');

        expect(mockBillRepository.updateStatus).toHaveBeenLastCalledWith(
            1, 'failed', 'Internal error: could not fetch config'
        );
    });
});

// ─── listBills ────────────────────────────────────────────────────────────────

describe('listBills', () => {
    beforeEach(clear);

    it('returns paginated bills without next page when fewer rows than limit', async () => {
        const rows = [makeBillRow({ id: 1 }), makeBillRow({ id: 2 })];
        mockBillRepository.findByUserId.mockResolvedValue(ok(rows));

        const result = await listBills(10, 5);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.data).toHaveLength(2);
            expect(result.value.pagination.hasNext).toBe(false);
        }
    });

    it('returns hasNext=true when row count exceeds limit', async () => {
        // Request limit=2 but return 3 rows — the +1 sentinel
        const rows = [makeBillRow({ id: 1 }), makeBillRow({ id: 2 }), makeBillRow({ id: 3 })];
        mockBillRepository.findByUserId.mockResolvedValue(ok(rows));

        const result = await listBills(10, 2);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.data).toHaveLength(2);         // trimmed to limit
            expect(result.value.pagination.hasNext).toBe(true);
            expect(result.value.pagination.nextCursor).toBe(2); // last id in trimmed slice
        }
    });

    it('passes before cursor to repository', async () => {
        mockBillRepository.findByUserId.mockResolvedValue(ok([]));

        await listBills(10, 5, 42);

        expect(mockBillRepository.findByUserId).toHaveBeenCalledWith(10, 6, 42);
    });

    it('propagates DB error', async () => {
        mockBillRepository.findByUserId.mockResolvedValue(err(ERRORS.DATABASE_ERROR));

        const result = await listBills(10, 5);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DATABASE_ERROR);
    });
});

// ─── getBill ──────────────────────────────────────────────────────────────────

describe('getBill', () => {
    beforeEach(clear);

    it('returns bill view for owner', async () => {
        mockBillRepository.findById.mockResolvedValue(ok(makeBillRow({ user_id: 10 })));

        const result = await getBill(10, 1);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.id).toBe(1);
            expect(result.value.platform).toBe('swiggy');
        }
    });

    it('returns BILL_NOT_FOUND when bill does not exist', async () => {
        mockBillRepository.findById.mockResolvedValue(ok(null));

        const result = await getBill(10, 999);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.BILL_NOT_FOUND);
    });

    it('returns BILL_NOT_OWNED when bill belongs to a different user', async () => {
        mockBillRepository.findById.mockResolvedValue(ok(makeBillRow({ user_id: 99 })));

        const result = await getBill(10, 1);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.BILL_NOT_OWNED);
    });

    it('propagates DB error', async () => {
        mockBillRepository.findById.mockResolvedValue(err(ERRORS.DATABASE_ERROR));

        const result = await getBill(10, 1);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DATABASE_ERROR);
    });
});

// ─── openChest ────────────────────────────────────────────────────────────────

describe('openChest', () => {
    beforeEach(clear);

    const setupOpenChestHappy = () => {
        mockBillRepository.findById.mockResolvedValue(ok(makeBillRow({
            user_id: 10,
            status: 'verified',
            chest_opened: 0,
            reward_amount: 15.50,
            chest_decoys: [22.00, 45.00],
        })));
        mockCashbackTransactionRepository.creditWallet.mockResolvedValue(ok(115.50));
        mockBillRepository.setChestOpened.mockResolvedValue(ok(undefined));
    };

    it('credits wallet and returns chest response on happy path', async () => {
        setupOpenChestHappy();

        const result = await openChest(10, 1);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.bill_id).toBe(1);
            expect(result.value.your_reward).toBe(15.50);
            expect(result.value.decoys).toEqual([22.00, 45.00]);
            expect(result.value.wallet_balance).toBe(115.50);
        }
        expect(mockCashbackTransactionRepository.creditWallet).toHaveBeenCalledWith(
            10, 1, 15.50, expect.stringContaining('swiggy')
        );
        expect(mockBillRepository.setChestOpened).toHaveBeenCalledWith(1);
    });

    it('returns BILL_NOT_FOUND when bill does not exist', async () => {
        mockBillRepository.findById.mockResolvedValue(ok(null));

        const result = await openChest(10, 999);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.BILL_NOT_FOUND);
    });

    it('returns BILL_NOT_OWNED when bill belongs to a different user', async () => {
        mockBillRepository.findById.mockResolvedValue(ok(makeBillRow({ user_id: 99 })));

        const result = await openChest(10, 1);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.BILL_NOT_OWNED);
    });

    it('returns BILL_NOT_VERIFIED when bill is still pending', async () => {
        mockBillRepository.findById.mockResolvedValue(ok(makeBillRow({
            user_id: 10,
            status: 'pending',
        })));

        const result = await openChest(10, 1);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.BILL_NOT_VERIFIED);
    });

    it('returns CHEST_ALREADY_OPENED when chest was already opened', async () => {
        mockBillRepository.findById.mockResolvedValue(ok(makeBillRow({
            user_id: 10,
            status: 'verified',
            chest_opened: 1,
            reward_amount: 15.50,
        })));

        const result = await openChest(10, 1);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.CHEST_ALREADY_OPENED);
    });

    it('returns BILL_NOT_VERIFIED when reward_amount is null (reward not assigned)', async () => {
        mockBillRepository.findById.mockResolvedValue(ok(makeBillRow({
            user_id: 10,
            status: 'verified',
            chest_opened: 0,
            reward_amount: null,
        })));

        const result = await openChest(10, 1);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.BILL_NOT_VERIFIED);
    });

    it('propagates wallet credit error', async () => {
        mockBillRepository.findById.mockResolvedValue(ok(makeBillRow({
            user_id: 10,
            status: 'verified',
            chest_opened: 0,
            reward_amount: 15.50,
            chest_decoys: [22.00, 45.00],
        })));
        mockCashbackTransactionRepository.creditWallet.mockResolvedValue(err(ERRORS.DATABASE_ERROR));

        const result = await openChest(10, 1);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DATABASE_ERROR);
        // setChestOpened must NOT be called if credit failed
        expect(mockBillRepository.setChestOpened).not.toHaveBeenCalled();
    });
});

// ─── adminListBills ───────────────────────────────────────────────────────────

describe('adminListBills', () => {
    beforeEach(clear);

    it('returns all bills paginated for admin', async () => {
        const rows = [makeBillRow({ id: 1 }), makeBillRow({ id: 2 }), makeBillRow({ id: 3 })];
        mockBillRepository.findAllAdmin.mockResolvedValue(ok(rows));

        const result = await adminListBills(2);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.data).toHaveLength(2);
            expect(result.value.pagination.hasNext).toBe(true);
        }
    });

    it('filters by status when provided', async () => {
        mockBillRepository.findAllAdmin.mockResolvedValue(ok([]));

        await adminListBills(10, undefined, 'pending');

        expect(mockBillRepository.findAllAdmin).toHaveBeenCalledWith(11, undefined, 'pending');
    });

    it('propagates DB error', async () => {
        mockBillRepository.findAllAdmin.mockResolvedValue(err(ERRORS.DATABASE_ERROR));

        const result = await adminListBills(10);

        expect(result.isErr()).toBe(true);
    });
});

// ─── adminApproveBill ─────────────────────────────────────────────────────────

describe('adminApproveBill', () => {
    beforeEach(clear);

    const setupApproveHappy = () => {
        const pendingBill = makeBillRow({ id: 5, user_id: 10, status: 'pending', reward_amount: null });
        const verifiedBill = makeBillRow({ id: 5, user_id: 10, status: 'verified', reward_amount: 15.50 });

        mockBillRepository.findById
            .mockResolvedValueOnce(ok(pendingBill))   // first call: load bill
            .mockResolvedValueOnce(ok(verifiedBill)); // second call: reload after update
        mockRewardConfigRepository.getActiveTiers.mockResolvedValue(ok(makeActiveTiers()));
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits()));
        mockUserRepository.findById.mockResolvedValue(ok(makeUser()));
        mockDrawReward.mockReturnValue(makeDrawResult());
        mockBillRepository.setVerified.mockResolvedValue(ok(undefined));
        mockUserRepository.incrementPityCounter.mockResolvedValue(ok(undefined));
        mockUserRepository.resetPityCounter.mockResolvedValue(ok(undefined));
    };

    it('runs reward engine and marks bill verified', async () => {
        setupApproveHappy();

        const result = await adminApproveBill(5);

        expect(result.isOk()).toBe(true);
        expect(mockBillRepository.setVerified).toHaveBeenCalledWith(5, 15.50, [22.00, 45.00]);
        expect(mockDrawReward).toHaveBeenCalled();
    });

    it('returns BILL_NOT_FOUND when bill does not exist', async () => {
        mockBillRepository.findById.mockResolvedValue(ok(null));

        const result = await adminApproveBill(999);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.BILL_NOT_FOUND);
    });

    it('returns BILL_NOT_VERIFIED when bill is not pending', async () => {
        mockBillRepository.findById.mockResolvedValue(ok(makeBillRow({ status: 'verified' })));

        const result = await adminApproveBill(1);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.BILL_NOT_VERIFIED);
    });

    it('returns REWARD_CONFIG_NOT_FOUND when no active tiers', async () => {
        mockBillRepository.findById.mockResolvedValue(ok(makeBillRow({ status: 'pending' })));
        mockRewardConfigRepository.getActiveTiers.mockResolvedValue(ok([]));
        mockRewardConfigRepository.getUploadLimits.mockResolvedValue(ok(makeUploadLimits()));

        const result = await adminApproveBill(1);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.REWARD_CONFIG_NOT_FOUND);
    });

    it('resets pity counter when pity triggered during approval', async () => {
        setupApproveHappy();
        mockDrawReward.mockReturnValue(makeDrawResult({ pity_triggered: true }));

        await adminApproveBill(5);

        expect(mockUserRepository.resetPityCounter).toHaveBeenCalledWith(10);
        expect(mockUserRepository.incrementPityCounter).not.toHaveBeenCalled();
    });
});

// ─── adminRejectBill ──────────────────────────────────────────────────────────

describe('adminRejectBill', () => {
    beforeEach(clear);

    it('rejects a pending bill with a reason', async () => {
        const pending = makeBillRow({ id: 1, status: 'pending' });
        const rejected = makeBillRow({ id: 1, status: 'rejected', rejection_reason: 'tampered' });

        mockBillRepository.findById
            .mockResolvedValueOnce(ok(pending))
            .mockResolvedValueOnce(ok(rejected));
        mockBillRepository.updateStatus.mockResolvedValue(ok(undefined));

        const result = await adminRejectBill(1, 'tampered');

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.status).toBe('rejected');
            expect(result.value.rejection_reason).toBe('tampered');
        }
        expect(mockBillRepository.updateStatus).toHaveBeenCalledWith(1, 'rejected', 'tampered');
    });

    it('rejects a verified bill (admin can override)', async () => {
        const verified = makeBillRow({ id: 1, status: 'verified' });
        const rejected = makeBillRow({ id: 1, status: 'rejected' });

        mockBillRepository.findById
            .mockResolvedValueOnce(ok(verified))
            .mockResolvedValueOnce(ok(rejected));
        mockBillRepository.updateStatus.mockResolvedValue(ok(undefined));

        const result = await adminRejectBill(1, 'fraud confirmed');

        expect(result.isOk()).toBe(true);
    });

    it('returns BILL_NOT_FOUND when bill does not exist', async () => {
        mockBillRepository.findById.mockResolvedValue(ok(null));

        const result = await adminRejectBill(999, 'reason');

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.BILL_NOT_FOUND);
    });

    it('returns BILL_NOT_FOUND when bill is already rejected (cannot re-reject)', async () => {
        mockBillRepository.findById.mockResolvedValue(ok(makeBillRow({ status: 'rejected' })));

        const result = await adminRejectBill(1, 'again');

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.BILL_NOT_FOUND);
    });

    it('propagates DB error from findById', async () => {
        mockBillRepository.findById.mockResolvedValue(err(ERRORS.DATABASE_ERROR));

        const result = await adminRejectBill(1, 'reason');

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DATABASE_ERROR);
    });
});
