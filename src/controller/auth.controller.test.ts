import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ok, err } from 'neverthrow';
import { ERRORS } from '../utils/error.ts';

// ─── MOCKS ───────────────────────────────────────────────────────────────────

const mockUserRepository = {
    findByPhone:            jest.fn<any>(),
    findByPhoneWithPassword: jest.fn<any>(),
    findById:               jest.fn<any>(),
    findByReferralCode:     jest.fn<any>(),
    create:                 jest.fn<any>(),
    onboard:                jest.fn<any>(),
    addCoins:               jest.fn<any>(),
};

const mockCreateAuthToken    = jest.fn<any>().mockReturnValue('mock_access_token');
const mockCreateRefreshToken = jest.fn<any>().mockReturnValue('mock_refresh_token');
const mockDecodeRefreshToken = jest.fn<any>().mockReturnValue({ id: 1, is_admin: false, phone: '919876543210' });
const mockBcryptCompare      = jest.fn<any>();
// MSG91 token verification — default to valid so existing tests pass unchanged
const mockVerifyMsg91Token   = jest.fn<any>().mockResolvedValue(true);
const mockSendOtpViaMSG91    = jest.fn<any>().mockResolvedValue(undefined);
const mockVerifyOtpViaMSG91  = jest.fn<any>().mockResolvedValue(true);

jest.unstable_mockModule('../repositories/user.repository.ts', () => ({
    UserRepository: mockUserRepository,
}));

jest.unstable_mockModule('../utils/jwt.ts', () => ({
    createAuthToken:     mockCreateAuthToken,
    createRefreshToken:  mockCreateRefreshToken,
    decodeRefreshToken:  mockDecodeRefreshToken,
}));

jest.unstable_mockModule('bcryptjs', () => ({
    default: { compare: mockBcryptCompare, hash: jest.fn<any>() },
}));

jest.unstable_mockModule('../services/msg91.service.ts', () => ({
    verifyMsg91Token:   mockVerifyMsg91Token,
    sendOtpViaMSG91:    mockSendOtpViaMSG91,
    verifyOtpViaMSG91:  mockVerifyOtpViaMSG91,
}));

const { verifyOtp, onboardUser, getMe, loginAdmin, refreshAccessToken } =
    await import('./auth.controller.ts');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const clear = () => { jest.clearAllMocks(); };

const makeUser = (overrides: Record<string, unknown> = {}) => ({
    id: 1, name: 'Test User', email: null, phone: '919876543210', gender: null,
    role: 'user', password_hash: null, upi_id: null, wallet_balance: 0,
    is_onboarded: 0, is_active: 1, pity_counter: 0, referral_code: null,
    referred_by: null, coin_balance: 0,
    created_at: new Date('2024-01-01'), updated_at: new Date('2024-01-01'),
    ...overrides,
});

const makeAdmin = (overrides: Record<string, unknown> = {}) =>
    makeUser({
        name: 'Admin', email: 'admin@billpay.com', phone: '9999999999',
        role: 'admin', is_onboarded: 1, password_hash: '$2b$12$hashedpassword',
        ...overrides,
    });

// ─── verifyOtp ────────────────────────────────────────────────────────────────

describe('verifyOtp', () => {
    beforeEach(clear);

    it('returns JWT for an existing active user', async () => {
        mockUserRepository.findByPhone.mockResolvedValue(ok(makeUser({ is_onboarded: 1 })));

        const result = await verifyOtp('919876543210', 'mock_msg91_token');

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.token).toBe('mock_access_token');
            expect(result.value.refresh_token).toBe('mock_refresh_token');
            expect(result.value.phone).toBe('919876543210');
        }
    });

    it('creates a new user when phone is not found', async () => {
        mockUserRepository.findByPhone.mockResolvedValue(ok(null));
        mockUserRepository.create.mockResolvedValue(ok(makeUser()));

        const result = await verifyOtp('919876543210', 'mock_msg91_token');

        expect(mockUserRepository.create).toHaveBeenCalledWith('919876543210');
        expect(result.isOk()).toBe(true);
    });

    it('strips leading + from phone before lookup', async () => {
        mockUserRepository.findByPhone.mockResolvedValue(ok(makeUser()));

        await verifyOtp('+919876543210', 'mock_msg91_token');

        expect(mockUserRepository.findByPhone).toHaveBeenCalledWith('919876543210');
    });

    it('returns USER_BANNED for inactive users', async () => {
        mockUserRepository.findByPhone.mockResolvedValue(ok(makeUser({ is_active: 0 })));

        const result = await verifyOtp('919876543210', 'mock_msg91_token');

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.USER_BANNED);
    });

    it('returns INVALID_OTP when MSG91 token verification fails', async () => {
        mockVerifyMsg91Token.mockResolvedValueOnce(false);

        const result = await verifyOtp('919876543210', 'bad_token');

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_OTP);
        // Must not touch the DB if token is invalid
        expect(mockUserRepository.findByPhone).not.toHaveBeenCalled();
    });

    it('propagates database errors', async () => {
        mockUserRepository.findByPhone.mockResolvedValue(err(ERRORS.DATABASE_ERROR));

        const result = await verifyOtp('919876543210', 'mock_msg91_token');

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DATABASE_ERROR);
    });
});

// ─── onboardUser ──────────────────────────────────────────────────────────────

describe('onboardUser', () => {
    beforeEach(clear);

    it('onboards a new user without referral code', async () => {
        mockUserRepository.findById.mockResolvedValue(ok(makeUser()));
        mockUserRepository.onboard.mockResolvedValue(
            ok(makeUser({ name: 'John', is_onboarded: 1, referral_code: 'ABC1231' }))
        );

        const result = await onboardUser(1, { name: 'John' });

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.name).toBe('John');
            expect(result.value.is_onboarded).toBe(true);
        }
    });

    it('returns ALREADY_ONBOARDED if user is already onboarded', async () => {
        mockUserRepository.findById.mockResolvedValue(ok(makeUser({ is_onboarded: 1 })));

        const result = await onboardUser(1, { name: 'John' });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.ALREADY_ONBOARDED);
    });

    it('validates referral code and awards coins to referrer', async () => {
        mockUserRepository.findById.mockResolvedValue(ok(makeUser()));
        mockUserRepository.findByReferralCode.mockResolvedValue(
            ok(makeUser({ id: 2, referral_code: 'REF123' }))
        );
        mockUserRepository.onboard.mockResolvedValue(
            ok(makeUser({ name: 'John', is_onboarded: 1, referred_by: 'REF123' }))
        );
        mockUserRepository.addCoins.mockResolvedValue(ok(undefined));

        const result = await onboardUser(1, { name: 'John', referral_code_used: 'REF123' });

        expect(result.isOk()).toBe(true);
        expect(mockUserRepository.addCoins).toHaveBeenCalledWith(2, 50);
    });

    it('returns INVALID_REFERRAL_CODE for unknown referral code', async () => {
        mockUserRepository.findById.mockResolvedValue(ok(makeUser()));
        mockUserRepository.findByReferralCode.mockResolvedValue(ok(null));

        const result = await onboardUser(1, { name: 'John', referral_code_used: 'BADCODE' });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_REFERRAL_CODE);
    });

    it('returns SELF_REFERRAL when user tries to use their own code', async () => {
        mockUserRepository.findById.mockResolvedValue(ok(makeUser({ id: 1 })));
        mockUserRepository.findByReferralCode.mockResolvedValue(
            ok(makeUser({ id: 1, referral_code: 'MYCODE1' }))
        );

        const result = await onboardUser(1, { name: 'John', referral_code_used: 'MYCODE1' });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.SELF_REFERRAL);
    });
});

// ─── getMe ────────────────────────────────────────────────────────────────────

describe('getMe', () => {
    beforeEach(clear);

    it('returns user view for valid user id', async () => {
        mockUserRepository.findById.mockResolvedValue(ok(makeUser({ name: 'John', is_onboarded: 1 })));

        const result = await getMe(1);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.id).toBe(1);
            expect(result.value.name).toBe('John');
        }
    });

    it('returns USER_NOT_FOUND for unknown id', async () => {
        mockUserRepository.findById.mockResolvedValue(err(ERRORS.USER_NOT_FOUND));

        const result = await getMe(999);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.USER_NOT_FOUND);
    });
});

// ─── loginAdmin ───────────────────────────────────────────────────────────────

describe('loginAdmin', () => {
    beforeEach(clear);

    it('returns JWT for valid admin credentials', async () => {
        mockUserRepository.findByPhoneWithPassword.mockResolvedValue(ok(makeAdmin()));
        mockBcryptCompare.mockResolvedValue(true);

        const result = await loginAdmin('9999999999', 'Admin@123');

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.token).toBe('mock_access_token');
            expect(result.value.role).toBe('admin');
        }
    });

    it('returns INVALID_CREDENTIALS for wrong password', async () => {
        mockUserRepository.findByPhoneWithPassword.mockResolvedValue(ok(makeAdmin()));
        mockBcryptCompare.mockResolvedValue(false);

        const result = await loginAdmin('9999999999', 'wrongpassword');

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_CREDENTIALS);
    });

    it('returns INVALID_CREDENTIALS when phone not found', async () => {
        mockUserRepository.findByPhoneWithPassword.mockResolvedValue(ok(null));

        const result = await loginAdmin('0000000000', 'Admin@123');

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_CREDENTIALS);
    });

    it('returns NOT_AN_ADMIN for non-admin users', async () => {
        mockUserRepository.findByPhoneWithPassword.mockResolvedValue(
            ok(makeUser({ password_hash: '$2b$12$hash' }))
        );

        const result = await loginAdmin('919876543210', 'somepassword');

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.NOT_AN_ADMIN);
    });

    it('returns USER_BANNED for banned admin', async () => {
        mockUserRepository.findByPhoneWithPassword.mockResolvedValue(ok(makeAdmin({ is_active: 0 })));

        const result = await loginAdmin('9999999999', 'Admin@123');

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.USER_BANNED);
    });
});

// ─── refreshAccessToken ───────────────────────────────────────────────────────

describe('refreshAccessToken', () => {
    beforeEach(clear);

    it('returns new access token for valid refresh token', async () => {
        const result = await refreshAccessToken('valid_refresh_token');

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.token).toBe('mock_access_token');
    });

    it('returns INVALID_REFRESH_TOKEN for invalid token', async () => {
        mockDecodeRefreshToken.mockImplementationOnce(() => { throw new Error('invalid token'); });

        const result = await refreshAccessToken('bad_token');

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_REFRESH_TOKEN);
    });
});
