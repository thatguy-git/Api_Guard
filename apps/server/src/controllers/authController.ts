import { Request, Response } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { createSession } from '../utils/session.js';

if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
    console.log('Please set env variables for the access and refresh secret');
    process.exit(1);
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

const SignupSchema = z.object({
    email: z.email(),
    password: z.string().min(8),
    name: z
        .string()
        .min(2, 'Name must be at least 2 characters long')
        .max(70, 'Name must be at most 70 characters long'),
});
export const LoginSchema = SignupSchema.omit({ name: true });

export type LoginRequest = z.infer<typeof LoginSchema>;
export type SignupRequest = z.infer<typeof SignupSchema>;

export const signup = async (req: Request, res: Response) => {
    try {
        const data: SignupRequest = req.body;
        const { email, password, name } = SignupSchema.parse(data);

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser)
            return res.status(409).json({ error: 'Identity already exists' });

        const hashedPassword = await argon2.hash(password);
        await prisma.user.create({
            data: { email, password: hashedPassword, name },
        });

        res.status(201).json({ message: 'Identity created. Please log in.' });
    } catch (error: unknown) {
        res.status(400).json({ error: 'Initialization failed' });
        console.log(
            error instanceof Error
                ? error.message
                : 'Unknown error during signup',
        );
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const data: LoginRequest = req.body;
        const { email, password } = LoginSchema.parse(data);
        const userIp = req.ip || req.socket.remoteAddress || '0.0.0.0';

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !(await argon2.verify(user.password, password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const { accessToken, refreshToken } = await createSession(user.id, req);
        await prisma.$transaction([
            prisma.user.update({
                where: { id: user.id },
                data: { lastLoginIp: userIp.toString() },
            }),
            prisma.session.create({
                data: {
                    userId: user.id,
                    refreshToken,
                    ipAddress: userIp.toString(),
                    userAgent: req.headers['user-agent'],
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
            }),
        ]);

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.json({ accessToken, user: { id: user.id, email: user.email } });
    } catch (error) {
        res.status(500).json({ error: 'Authentication error' });
    }
};

export const logout = async (req: Request, res: Response) => {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken)
        return res.sendStatus(204).json({ message: 'No session found' });

    try {
        await prisma.session.update({
            where: { refreshToken },
            data: { isValid: false },
        });

        res.clearCookie('refreshToken');
        res.json({ message: 'Session terminated' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to terminate session' });
    }
};

/**
 * REFRESH: Issue new Access Token if session is still valid
 */
export const refresh = async (req: Request, res: Response) => {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!refreshToken)
        return res.status(401).json({ error: 'No session found' });

    try {
        const session = await prisma.session.findUnique({
            where: { refreshToken },
            include: { user: true },
        });

        // Check if session is revoked, expired, or doesn't exist
        if (!session || !session.isValid || session.expiresAt < new Date()) {
            return res
                .status(401)
                .json({ error: 'Session invalid or expired' });
        }

        const newAccessToken = jwt.sign(
            { userId: session.user.id },
            ACCESS_SECRET,
            { expiresIn: '15m' },
        );

        res.json({ accessToken: newAccessToken });
    } catch (error) {
        res.status(401).json({ error: 'Refresh failed' });
    }
};
