import { UserView } from '../models/user.model.ts';

export type LoginResponse<T> = {
    token: string;
    refresh_token: string;
    email: string;
    is_onboarded: boolean;
    user: T;
};

// Used by admin login (merges UserView fields at top level for backward compat)
export type AdminLoginResponse = UserView & { token: string; refresh_token: string };
