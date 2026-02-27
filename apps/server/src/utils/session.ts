import { Request } from 'express';
import { UAParser } from 'ua-parser-js';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-secret';

export interface SessionData {
    accessToken: string;
    refreshToken: string;
}

/**
 * Utility to handle session fingerprinting and token generation
 */
export const createSession = async (
    userId: string,
    req: Request,
): Promise<SessionData> => {
    // 1. Parse User Agent for Fingerprinting
    const ua = new UAParser(req.headers['user-agent']);
    const browser = ua.getBrowser().name || 'Unknown Browser';
    const os = ua.getOS().name || 'Unknown OS';
    const device = ua.getDevice().model ? ` on ${ua.getDevice().model}` : '';

    const friendlyUserAgent = `${browser} on ${os}${device}`;
    const ipAddress = (
        req.ip ||
        req.headers['x-forwarded-for'] ||
        '0.0.0.0'
    ).toString();

    // 2. Generate Tokens
    const accessToken = jwt.sign({ userId }, ACCESS_SECRET, {
        expiresIn: '15m',
    });
    const refreshToken = jwt.sign({ userId }, REFRESH_SECRET, {
        expiresIn: '7d',
    });

    // 3. Persist Session & Update User's Last Seen IP
    // We use a transaction to ensure both happen or neither happens
    await prisma.$transaction([
        prisma.user.update({
            where: { id: userId },
            data: { lastLoginIp: ipAddress },
        }),
        prisma.session.create({
            data: {
                userId,
                refreshToken,
                ipAddress,
                userAgent: friendlyUserAgent,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 Days
            },
        }),
    ]);

    return { accessToken, refreshToken };
};
