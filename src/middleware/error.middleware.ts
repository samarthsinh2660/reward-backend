import { Request, Response, NextFunction } from 'express';
import { errorResponse } from '../utils/response.ts';

export const notFoundHandler = (req: Request, res: Response, _next: NextFunction) => {
    res.status(404).json(errorResponse(`Route ${req.method} ${req.originalUrl} not found`, 404));
};

export const errorHandler = (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json(errorResponse('Internal server error', 500));
};
