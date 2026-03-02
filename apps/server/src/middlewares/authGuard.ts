import { Response, Request, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { createRedisConnection } from '../lib/redis.js';

const redis = createRedisConnection();

export const authenticateSession = async (
    req: any,
    res: Response,
    next: NextFunction,
) => {
    const authHeader = req.headers.authorization;
    const refreshToken = req.cookies.refreshToken;

    if (!authHeader?.startsWith('Bearer ') || !refreshToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    const token = req.headers.authorization?.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as {
            userId: string;
        };

        const sessionActive = await redis.exists(`sess:${refreshToken}`);

        if (!sessionActive) {
            return res
                .status(401)
                .json({ error: 'Session revoked. Please log in again.' });
        }
        req.userId = decoded.userId;
        next();
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error(`Authentication error: ${error.message}`);
        } else {
            console.error('Unknown authentication error');
        }
        res.status(401).json({ error: 'Unauthorized' });
    }
};
