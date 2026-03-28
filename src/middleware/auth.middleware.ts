import { Request, Response, NextFunction } from 'express';
import { decodeAuthToken, TokenData } from '../utils/jwt.ts';
import { ERRORS } from '../utils/error.ts';

declare global {
    namespace Express {
        interface Request {
            user?: TokenData;
        }
    }
}

// Extracts and validates JWT from: Authorization: Bearer <token>
export const authenticate = (req: Request, _res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw ERRORS.NO_TOKEN_PROVIDED;
        }
        const token = authHeader.substring(7);
        req.user = decodeAuthToken(token);
        next();
    } catch (error) {
        next(error);
    }
};

// Must come AFTER authenticate in the middleware chain
export const requireAdmin = (_req: Request, __res: Response, next: NextFunction) => {
    try {
        if (!_req.user) throw ERRORS.UNAUTHORIZED;
        if (!_req.user.is_admin) throw ERRORS.ADMIN_ONLY_ROUTE;
        next();
    } catch (error) {
        next(error);
    }
};

// Must come AFTER authenticate in the middleware chain
export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
    try {
        if (!req.user) throw ERRORS.UNAUTHORIZED;
        next();
    } catch (error) {
        next(error);
    }
};
