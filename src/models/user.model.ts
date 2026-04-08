import { RowDataPacket } from 'mysql2';

export const USER_TABLE = 'users';

// ── Enum constants — import in routes/queries, never hardcode the strings ────

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = typeof USER_ROLES[number];

export const USER_GENDERS = ['male', 'female', 'other'] as const;
export type UserGender = typeof USER_GENDERS[number];

// ── DB row type ───────────────────────────────────────────────────────────────

export interface User extends RowDataPacket {
    id: number;
    name: string | null;
    email: string;                    // primary login identifier (NOT NULL in DB)
    phone: string | null;             // optional — collected at withdrawal
    gender: UserGender | null;
    role: UserRole;
    password_hash: string | null;     // only set for admin accounts
    upi_id: string | null;
    wallet_balance: number;
    is_onboarded: number;             // TINYINT — 0 | 1
    is_active: number;                // TINYINT — 0 | 1
    pity_counter: number;
    referral_code: string | null;
    referred_by: string | null;
    coin_balance: number;
    created_at: Date;
    updated_at: Date;
}

// ── Safe view — only fields safe to expose to the client ──────────────────────

export type UserView = {
    id: number;
    name: string | null;
    email: string;
    phone: string | null;
    gender: UserGender | null;
    role: UserRole;
    wallet_balance: number;
    is_onboarded: boolean;
    pity_counter: number;
    referral_code: string | null;
    coin_balance: number;
    created_at: Date;
};

// ── Input types ───────────────────────────────────────────────────────────────

export type CreateUserData = {
    email: string;
};

export type OnboardUserData = {
    name: string;
    gender?: UserGender;
    referral_code_used?: string;    // the referrer's code, entered during onboarding
};

export type AdminLoginData = {
    email: string;
    password: string;
};

// ── Converter ─────────────────────────────────────────────────────────────────

export function toUserView(row: User): UserView {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        gender: row.gender,
        role: row.role,
        wallet_balance: Number(row.wallet_balance),
        is_onboarded: row.is_onboarded === 1,
        pity_counter: row.pity_counter,
        referral_code: row.referral_code,
        coin_balance: row.coin_balance,
        created_at: row.created_at,
    };
}
