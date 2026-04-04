import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mysql from 'mysql2/promise';
import { GenericContainer } from 'testcontainers';
import { USER_TABLE, CREATE_USER_TABLE_QUERY } from '../models/user.model.ts';
import { ERRORS } from '../utils/error.ts';

jest.setTimeout(180000); // containers need time to start

// ─── CONTAINER + POOL SETUP ──────────────────────────────────────────────────

let container: any;
let testPool: any;

// Stable proxy object — methods delegate to testPool at call time.
// This works in ESM because the proxy reference is stable; testPool is
// resolved when the method is actually invoked (after beforeAll sets it up).
const dbProxy = {
    query:         (...args: any[]) => testPool.query(...args),
    getConnection: ()               => testPool.getConnection(),
    execute:       (...args: any[]) => testPool.execute(...args),
};

jest.unstable_mockModule('../database/db.ts', () => ({ db: dbProxy }));

const { UserRepository } = await import('./user.repository.ts');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function query(sql: string, params: unknown[] = []) {
    const conn = await testPool.getConnection();
    await conn.query(sql, params);
    conn.release();
}

async function resetTable() {
    await query(`DELETE FROM ${USER_TABLE}`);
    await query(`ALTER TABLE ${USER_TABLE} AUTO_INCREMENT = 1`);
    // Seed 3 users: 1 regular, 1 onboarded with referral, 1 admin
    await query(`
        INSERT INTO users (id, name, email, phone, role, is_onboarded, is_active, referral_code, coin_balance) VALUES
        (1, 'Alice',  'alice@test.com', '911111111111', 'user',  1, 1, 'ALICE1', 0),
        (2, 'Bob',    'bob@test.com',   '912222222222', 'user',  0, 1, NULL,     0),
        (3, 'Admin',  'admin@test.com', '919999999999', 'admin', 1, 1, 'ADMIN3', 0)
    `);
    await query(`
        UPDATE users SET password_hash = '$2b$12$testhash' WHERE role = 'admin'
    `);
}

// ─── LIFECYCLE ───────────────────────────────────────────────────────────────

beforeAll(async () => {
    container = await new GenericContainer('mysql:8.4')
        .withExposedPorts(3306)
        .withStartupTimeout(180000)
        .withEnvironment({
            MYSQL_ROOT_PASSWORD: 'root',
            MYSQL_DATABASE: 'test_billpay',
            MYSQL_USER: 'test_user',
            MYSQL_PASSWORD: 'test_pass',
        })
        .start();

    const port = container.getMappedPort(3306);

    testPool = mysql.createPool({
        host: 'localhost',
        user: 'test_user',
        password: 'test_pass',
        database: 'test_billpay',
        port,
        waitForConnections: true,
    });

    // Create table using the same query as the model (matches 01-tables.sql)
    const conn = await testPool.getConnection();
    await conn.query(CREATE_USER_TABLE_QUERY);
    conn.release();
});

afterAll(async () => {
    await query(`DROP TABLE IF EXISTS ${USER_TABLE}`);
    if (testPool) await testPool.end();
    if (container) await container.stop();
});

beforeEach(resetTable);

// ─── findByPhone ──────────────────────────────────────────────────────────────

describe('UserRepository.findByPhone', () => {
    it('returns user for existing phone', async () => {
        const result = await UserRepository.findByPhone('911111111111');

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value).not.toBeNull();
            expect(result.value!.phone).toBe('911111111111');
            expect(result.value!.name).toBe('Alice');
        }
    });

    it('returns null for unknown phone', async () => {
        const result = await UserRepository.findByPhone('910000000000');

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value).toBeNull();
    });

    it('does not return password_hash', async () => {
        const result = await UserRepository.findByPhone('919999999999');

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value).not.toBeNull();
            expect((result.value as any).password_hash).toBeUndefined();
        }
    });
});

// ─── findByPhoneWithPassword ──────────────────────────────────────────────────

describe('UserRepository.findByPhoneWithPassword', () => {
    it('returns user including password_hash', async () => {
        const result = await UserRepository.findByPhoneWithPassword('919999999999');

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value).not.toBeNull();
            expect(result.value!.password_hash).toBe('$2b$12$testhash');
            expect(result.value!.role).toBe('admin');
        }
    });

    it('returns null for unknown phone', async () => {
        const result = await UserRepository.findByPhoneWithPassword('910000000000');

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value).toBeNull();
    });
});

// ─── findById ─────────────────────────────────────────────────────────────────

describe('UserRepository.findById', () => {
    it('returns user for existing id', async () => {
        const result = await UserRepository.findById(1);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.id).toBe(1);
            expect(result.value.name).toBe('Alice');
        }
    });

    it('returns USER_NOT_FOUND for unknown id', async () => {
        const result = await UserRepository.findById(9999);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.USER_NOT_FOUND);
    });
});

// ─── findByReferralCode ───────────────────────────────────────────────────────

describe('UserRepository.findByReferralCode', () => {
    it('returns user for existing referral code', async () => {
        const result = await UserRepository.findByReferralCode('ALICE1');

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value).not.toBeNull();
            expect(result.value!.referral_code).toBe('ALICE1');
        }
    });

    it('returns null for unknown referral code', async () => {
        const result = await UserRepository.findByReferralCode('NOCODE');

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value).toBeNull();
    });
});

// ─── create ───────────────────────────────────────────────────────────────────

describe('UserRepository.create', () => {
    it('inserts new user and returns them', async () => {
        const result = await UserRepository.create('913333333333');

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.phone).toBe('913333333333');
            expect(result.value.role).toBe('user');
            expect(result.value.is_onboarded).toBe(0);
            expect(result.value.wallet_balance).toBe('0.00');
        }
    });

    it('created user can be found by phone', async () => {
        await UserRepository.create('913333333333');
        const found = await UserRepository.findByPhone('913333333333');

        expect(found.isOk()).toBe(true);
        if (found.isOk()) expect(found.value).not.toBeNull();
    });
});

// ─── onboard ──────────────────────────────────────────────────────────────────

describe('UserRepository.onboard', () => {
    it('sets name, is_onboarded, and referral_code', async () => {
        const result = await UserRepository.onboard(
            2,
            { name: 'Bob Updated' },
            'NEWBOB2'
        );

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.name).toBe('Bob Updated');
            expect(result.value.is_onboarded).toBe(1);
            expect(result.value.referral_code).toBe('NEWBOB2');
            expect(result.value.referred_by).toBeNull();
        }
    });

    it('stores referred_by when referral_code_used is provided', async () => {
        const result = await UserRepository.onboard(
            2,
            { name: 'Bob', referral_code_used: 'ALICE1' },
            'NEWBOB2'
        );

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.referred_by).toBe('ALICE1');
    });

    it('verify onboard persists in DB via findById', async () => {
        await UserRepository.onboard(2, { name: 'Bob Persisted' }, 'PERSIST2');
        const found = await UserRepository.findById(2);

        expect(found.isOk()).toBe(true);
        if (found.isOk()) {
            expect(found.value.name).toBe('Bob Persisted');
            expect(found.value.is_onboarded).toBe(1);
        }
    });
});

// ─── onboard (email + gender) ─────────────────────────────────────────────────

describe('UserRepository.onboard (email + gender)', () => {
    it('stores email when provided', async () => {
        const result = await UserRepository.onboard(
            2,
            { name: 'Bob', email: 'bob@example.com' },
            'NEWBOB2'
        );

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.email).toBe('bob@example.com');
    });

    it('stores gender when provided', async () => {
        const result = await UserRepository.onboard(
            2,
            { name: 'Bob', gender: 'male' },
            'NEWBOB2'
        );

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.gender).toBe('male');
    });

    it('leaves email null when not provided', async () => {
        const result = await UserRepository.onboard(
            2,
            { name: 'Bob' },
            'NEWBOB2'
        );

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.email).toBeNull();
    });

    it('leaves gender null when not provided', async () => {
        const result = await UserRepository.onboard(
            2,
            { name: 'Bob' },
            'NEWBOB2'
        );

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.gender).toBeNull();
    });
});

// ─── addCoins ─────────────────────────────────────────────────────────────────

describe('UserRepository.addCoins', () => {
    it('increments coin_balance correctly', async () => {
        await UserRepository.addCoins(1, 50);
        const result = await UserRepository.findById(1);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.coin_balance).toBe(50);
    });

    it('accumulates across multiple calls', async () => {
        await UserRepository.addCoins(1, 50);
        await UserRepository.addCoins(1, 30);
        const result = await UserRepository.findById(1);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.coin_balance).toBe(80);
    });
});

// ─── incrementPityCounter ─────────────────────────────────────────────────────

describe('UserRepository.incrementPityCounter', () => {
    it('increments pity_counter by 1', async () => {
        await UserRepository.incrementPityCounter(1);
        const result = await UserRepository.findById(1);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.pity_counter).toBe(1);
    });

    it('accumulates across multiple increments', async () => {
        await UserRepository.incrementPityCounter(1);
        await UserRepository.incrementPityCounter(1);
        await UserRepository.incrementPityCounter(1);
        const result = await UserRepository.findById(1);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.pity_counter).toBe(3);
    });

    it('returns ok(undefined)', async () => {
        const result = await UserRepository.incrementPityCounter(1);
        expect(result.isOk()).toBe(true);
    });
});

// ─── resetPityCounter ─────────────────────────────────────────────────────────

describe('UserRepository.resetPityCounter', () => {
    it('sets pity_counter to 0', async () => {
        // First increment a few times
        await UserRepository.incrementPityCounter(1);
        await UserRepository.incrementPityCounter(1);

        // Then reset
        await UserRepository.resetPityCounter(1);
        const result = await UserRepository.findById(1);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.pity_counter).toBe(0);
    });

    it('is idempotent when counter is already 0', async () => {
        await UserRepository.resetPityCounter(1);
        const result = await UserRepository.findById(1);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.pity_counter).toBe(0);
    });

    it('returns ok(undefined)', async () => {
        const result = await UserRepository.resetPityCounter(1);
        expect(result.isOk()).toBe(true);
    });
});
