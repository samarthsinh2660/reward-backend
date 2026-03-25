export class RequestError {
    constructor(
        public readonly message: string,
        public readonly statusCode: number
    ) {}
}

export const ERRORS = {
    NOT_FOUND: new RequestError('Resource not found', 404),
    UNAUTHORIZED: new RequestError('Unauthorized', 401),
    FORBIDDEN: new RequestError('Forbidden', 403),
    BAD_REQUEST: new RequestError('Bad request', 400),
    INTERNAL_ERROR: new RequestError('Internal server error', 500),
    DATABASE_ERROR: new RequestError('Database error', 500),
    VALIDATION_ERROR: new RequestError('Validation error', 422),
} as const;
