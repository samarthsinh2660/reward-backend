export class RequestError extends Error {
    code: number;
    statusCode: number;

    constructor(message: string, code: number, statusCode: number) {
        super(message);
        this.name = 'RequestError';
        this.code = code;
        this.statusCode = statusCode;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, RequestError);
        }
    }
}

export const ERRORS = {
    // Common (1xxxx)
    DATABASE_ERROR:          new RequestError('Database operation failed',          10001, 500),
    INVALID_REQUEST_BODY:    new RequestError('Invalid request body',               10002, 400),
    INVALID_QUERY_PARAMETER: new RequestError('Invalid query parameters',           10003, 400),
    UNHANDLED_ERROR:         new RequestError('An unexpected error occurred',       10004, 500),
    INTERNAL_SERVER_ERROR:   new RequestError('Internal server error',              10005, 500),
    ROUTE_NOT_FOUND:         new RequestError('Route not found',                    10006, 404),
    INVALID_PARAMS:          new RequestError('Invalid parameters',                 10007, 400),
    VALIDATION_ERROR:        new RequestError('Validation failed',                  10008, 422),
    RESOURCE_NOT_FOUND:      new RequestError('Resource not found',                 10009, 404),
    DUPLICATE_RESOURCE:      new RequestError('Resource already exists',            10010, 409),

    // Auth (2xxxx)
    NO_TOKEN_PROVIDED:         new RequestError('No authentication token provided', 20001, 401),
    INVALID_AUTH_TOKEN:        new RequestError('Invalid authentication token',     20002, 401),
    TOKEN_EXPIRED:             new RequestError('Authentication token has expired', 20003, 401),
    INVALID_REFRESH_TOKEN:     new RequestError('Invalid refresh token',            20004, 401),
    UNAUTHORIZED:              new RequestError('Unauthorized access',              20005, 401),
    FORBIDDEN:                 new RequestError('Access forbidden',                 20006, 403),
    ADMIN_ONLY_ROUTE:          new RequestError('Admin access required',            20007, 403),
    JWT_SECRET_NOT_CONFIGURED: new RequestError('JWT configuration error',         20008, 500),
    INSUFFICIENT_PERMISSIONS:  new RequestError('Insufficient permissions',         20009, 403),

    // User / Auth domain (3xxxx)
    USER_NOT_FOUND:            new RequestError('User not found',                   30001, 404),
    USER_BANNED:               new RequestError('Your account has been suspended',  30002, 403),
    ONBOARDING_INCOMPLETE:     new RequestError('Please complete onboarding first', 30003, 403),
    INVALID_REFERRAL_CODE:     new RequestError('Invalid referral code',            30004, 400),
    SELF_REFERRAL:             new RequestError('You cannot use your own referral code', 30005, 400),
    ALREADY_ONBOARDED:         new RequestError('User is already onboarded',        30006, 409),
    INVALID_CREDENTIALS:       new RequestError('Invalid phone or password',        30007, 401),
    NOT_AN_ADMIN:              new RequestError('This account does not have admin access', 30008, 403),
    NO_PASSWORD_SET:           new RequestError('Admin password not configured',    30009, 500),

    // Bill domain (4xxxx)
    BILL_NOT_FOUND:               new RequestError('Bill not found',                                     40001, 404),
    BILL_PROCESSING_FAILED:       new RequestError('Bill processing failed. Please try again.',          40002, 422),
    BILL_DUPLICATE:               new RequestError('This bill has already been submitted.',              40003, 409),
    BILL_QUALITY_LOW:             new RequestError('Image quality too low. Please retake the photo.',    40004, 422),
    BILL_OCR_FAILED:              new RequestError('Could not read text from bill. Upload a clearer image.', 40005, 422),
    BILL_PARSE_FAILED:            new RequestError('Could not extract bill data. Upload a clearer image.',   40006, 422),
    BILL_UPLOAD_LIMIT_REACHED:    new RequestError('Upload limit reached. Try again tomorrow.',          40007, 429),
    BILL_PROCESSOR_UNAVAILABLE:   new RequestError('Bill processing service unavailable. Try again.',    40008, 503),
    BILL_INVALID_FILE:            new RequestError('Invalid file. Upload a JPEG, PNG, or WebP image.',   40009, 400),
    BILL_NOT_OWNED:               new RequestError('You do not have access to this bill.',               40010, 403),
    CHEST_ALREADY_OPENED:         new RequestError('Chest has already been opened for this bill.',       40011, 409),
    BILL_NOT_VERIFIED:            new RequestError('Bill is not verified yet. Reward is not available.', 40012, 422),
    BILL_AUTO_REJECTED:           new RequestError('Bill rejected due to fraud signals.',                40013, 422),
    REWARD_CONFIG_NOT_FOUND:      new RequestError('Reward configuration not found.',                    40014, 404),

    BILL_QUEUE_FULL:              new RequestError('System is busy. Please try again in a few minutes.', 40015, 503),
    CLOUDINARY_UPLOAD_FAILED:    new RequestError('Failed to store bill image. Please try again.',      40016, 500),

    // Wallet / Reward domain (5xxxx)
    INSUFFICIENT_BALANCE:      new RequestError('Insufficient wallet balance.',                  50001, 400),
    MIN_WITHDRAWAL_AMOUNT:     new RequestError('Minimum withdrawal amount is ₹100.',            50002, 400),
    UPI_ID_REQUIRED:           new RequestError('Please provide your UPI ID for withdrawal.',    50003, 400),
    WITHDRAWAL_PENDING:        new RequestError('You already have a pending withdrawal request.', 50004, 409),
} as const;

export function isRequestError(error: unknown): error is RequestError {
    return error instanceof RequestError;
}

export function handleUnknownError(error: unknown): RequestError {
    if (isRequestError(error)) return error;
    console.error('Unknown error:', error);
    return ERRORS.UNHANDLED_ERROR;
}
