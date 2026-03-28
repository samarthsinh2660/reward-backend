import rateLimit from 'express-rate-limit';

export const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000,
    message: {
        success: false,
        error: {
            code: 42901,
            message: 'Too many requests, please try again later',
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Stricter limiter for auth endpoints (OTP verify, onboard)
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: {
        success: false,
        error: {
            code: 42902,
            message: 'Too many auth attempts, please try again later',
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
});
