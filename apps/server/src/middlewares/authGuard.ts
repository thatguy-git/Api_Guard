import { Response, Request, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

export const authenticateSession = async (
    req: any,
    res: Response,
    next: NextFunction,
) => {
    const token = req.headers.authorization?.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as {
            userId: string;
        };

        // Check if any valid session exists for this user + current IP
        // This is optional: you can just check 'isValid' if you're less strict
        const activeSession = await prisma.session.findFirst({
            where: {
                userId: decoded.userId,
                isValid: true,
                // Optional: ipAddress: currentIp.toString() // Forces session-per-IP
            },
        });

        if (!activeSession) {
            return res
                .status(401)
                .json({ error: 'Session expired or revoked.' });
        }

        req.userId = decoded.userId;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Unauthorized' });
    }
};
