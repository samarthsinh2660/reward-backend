import { MSG91_AUTHKEY } from '../config/env.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('@msg91.service');

const MSG91_VERIFY_URL = 'https://control.msg91.com/api/v5/widget/verifyAccessToken';

type Msg91VerifySuccess = { type: 'success'; message: string };
type Msg91VerifyFail    = { type: 'error';   message: string };
type Msg91VerifyResult  = Msg91VerifySuccess | Msg91VerifyFail;

/**
 * Server-side verification of the MSG91 access token received from the OTP widget.
 * Returns true when MSG91 confirms the token is valid (OTP was genuinely verified).
 * Returns false on any failure — caller should reject with 401.
 */
export async function verifyMsg91Token(accessToken: string): Promise<boolean> {
    try {
        const res = await fetch(MSG91_VERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                authkey:        MSG91_AUTHKEY,
                'access-token': accessToken,
            }),
            signal: AbortSignal.timeout(8000), // 8s timeout
        });

        const json = await res.json() as Msg91VerifyResult;

        if (json.type === 'success') {
            return true;
        }

        logger.warn(`MSG91 token verification failed: ${json.message}`);
        return false;
    } catch (e) {
        logger.error('MSG91 verifyAccessToken request failed', e);
        return false;
    }
}
