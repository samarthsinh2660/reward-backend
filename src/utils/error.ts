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
} as const;

export function isRequestError(error: unknown): error is RequestError {
    return error instanceof RequestError;
}

export function handleUnknownError(error: unknown): RequestError {
    if (isRequestError(error)) return error;
    console.error('Unknown error:', error);
    return ERRORS.UNHANDLED_ERROR;
}
