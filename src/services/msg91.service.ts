import { MSG91_AUTHKEY, NODE_ENV } from '../config/env.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('@msg91.service');

const BASE = 'https://control.msg91.com/api/v5';
const DEMO_OTP = '1234';

// ─── MSG91 Token Verification (Widget Flow — Legacy) ───────────────────────

export async function verifyMsg91Token(_accessToken: string): Promise<boolean> {
    // Legacy widget-based flow — not used in current demo mode.
    // Stub implementation returns false.
    // TODO: Implement server-side MSG91 token validation when widget is fully configured.
    return false;
}

function headers() {
    return {
        'Content-Type': 'application/json',
        'authkey': MSG91_AUTHKEY,
    };
}

// ─── Send OTP ─────────────────────────────────────────────────────────────────

export async function sendOtpViaMSG91(mobile: string): Promise<void> {
    // DEMO MODE: bypass real MSG91
    if (NODE_ENV !== 'production') {
        logger.info(`[DEMO] OTP sent to ${mobile}: ${DEMO_OTP}`);
        return;
    }

    // PRODUCTION: send real OTP via MSG91
    // const res = await fetch(`${BASE}/otp`, {
    //     method: 'POST',
    //     headers: headers(),
    //     body: JSON.stringify({
    //         mobile,
    //         otp_length: 4,
    //         otp_expiry: 10,
    //     }),
    //     signal: AbortSignal.timeout(10_000),
    // });

    // const json = await res.json() as { type: string; message?: string };
    // if (json.type !== 'success') {
    //     logger.warn(`MSG91 sendOtp failed: ${json.message}`);
    //     throw new Error(json.message ?? 'Failed to send OTP');
    // }
}

// ─── Verify OTP ───────────────────────────────────────────────────────────────

export async function verifyOtpViaMSG91(mobile: string, otp: string): Promise<boolean> {
    // DEMO MODE: use fixed OTP
    if (NODE_ENV !== 'production') {
        const isValid = otp === DEMO_OTP;
        logger.info(`[DEMO] OTP verify for ${mobile}: ${isValid ? 'SUCCESS' : 'FAILED'} (entered: ${otp})`);
        return isValid;
    }

    // PRODUCTION: verify with MSG91
    // try {
    //     const res = await fetch(`${BASE}/otp/verify`, {
    //         method: 'POST',
    //         headers: headers(),
    //         body: JSON.stringify({ mobile, otp }),
    //         signal: AbortSignal.timeout(10_000),
    //     });

    //     const json = await res.json() as { type: string; message?: string };
    //     if (json.type === 'success') return true;
    //     logger.warn(`MSG91 verifyOtp failed: ${json.message}`);
    //     return false;
    // } catch (e) {
    //     logger.error('MSG91 verifyOtp request failed', e);
    //     return false;
    // }

    return false;
}

// ─── Resend OTP ───────────────────────────────────────────────────────────────

export async function resendOtpViaMSG91(mobile: string): Promise<void> {
    // DEMO MODE: bypass real MSG91
    if (NODE_ENV !== 'production') {
        logger.info(`[DEMO] OTP resent to ${mobile}: ${DEMO_OTP}`);
        return;
    }

    // PRODUCTION: resend via MSG91
    // const res = await fetch(`${BASE}/otp/retry`, {
    //     method: 'POST',
    //     headers: headers(),
    //     body: JSON.stringify({
    //         mobile,
    //         retrytype: 'text',
    //     }),
    //     signal: AbortSignal.timeout(10_000),
    // });

    // const json = await res.json() as { type: string; message?: string };
    // if (json.type !== 'success') {
    //     logger.warn(`MSG91 resendOtp failed: ${json.message}`);
    //     throw new Error(json.message ?? 'Failed to resend OTP');
    // }
}
