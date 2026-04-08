import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config/env.ts';
import { ERRORS } from './error.ts';

export interface TokenData {
    id: number;
    is_admin: boolean;
    email: string;
}

export function createAuthToken(data: TokenData): string {
    if (!JWT_SECRET) throw ERRORS.JWT_SECRET_NOT_CONFIGURED;
    return jwt.sign(data, JWT_SECRET, {
        expiresIn: (JWT_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'],
    });
}

export function createRefreshToken(data: TokenData): string {
    if (!JWT_SECRET) throw ERRORS.JWT_SECRET_NOT_CONFIGURED;
    return jwt.sign(data, JWT_SECRET, { expiresIn: '30d' });
}

export function decodeAuthToken(token: string): TokenData {
    if (!JWT_SECRET) throw ERRORS.JWT_SECRET_NOT_CONFIGURED;
    return jwt.verify(token, JWT_SECRET) as TokenData;
}

export function decodeRefreshToken(token: string): TokenData {
    if (!JWT_SECRET) throw ERRORS.JWT_SECRET_NOT_CONFIGURED;
    return jwt.verify(token, JWT_SECRET) as TokenData;
}
