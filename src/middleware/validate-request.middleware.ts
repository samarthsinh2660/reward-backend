import { Request, Response, NextFunction } from 'express';
import { ZodType } from 'zod';
import { ERRORS } from '../utils/error.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('@requestValidator');

export type RequestValidation = {
    params?: ZodType;
    query?: ZodType;
    body?: ZodType;
};

const validateRequest = ({ body, query, params }: RequestValidation) =>
    (req: Request, _res: Response, next: NextFunction) => {
        if (params) {
            const parsed = params.safeParse(req.params);
            if (!parsed.success) {
                logger.error(parsed.error);
                return next(ERRORS.INVALID_PARAMS);
            }
        }
        if (body) {
            const parsed = body.safeParse(req.body);
            if (!parsed.success) {
                logger.error(parsed.error);
                return next(ERRORS.INVALID_REQUEST_BODY);
            }
        }
        if (query) {
            const parsed = query.safeParse(req.query);
            if (!parsed.success) {
                logger.error(parsed.error);
                return next(ERRORS.INVALID_QUERY_PARAMETER);
            }
        }
        next();
    };

export default validateRequest;
