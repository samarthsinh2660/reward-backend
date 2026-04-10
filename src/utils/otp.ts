import { randomInt } from 'crypto';

/**
 * Generates a cryptographically secure 6-digit OTP string.
 * Uses Node's crypto.randomInt which draws from the OS CSPRNG.
 */
export function generateOtp(): string {
    return randomInt(100000, 1000000).toString();
}
