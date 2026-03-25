import { Router, Request, Response } from 'express';
import { successResponse } from '../utils/response.ts';

const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
    res.json(successResponse(
        { status: 'OK', uptime: process.uptime() },
        'Service is healthy'
    ));
});

export default healthRouter;
