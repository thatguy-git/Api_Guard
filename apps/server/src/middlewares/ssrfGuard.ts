import { Request, Response, NextFunction } from 'express';
import { validateUrlSafety } from '../utils/ssrf.js';

export const ssrfProtection = async (
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> => {
    const targetUrl = req.body.endpoint || req.body.url;

    if (!targetUrl) {
        res.status(400).json({ error: 'Endpoint URL is required.' });
        return;
    }

    try {
        await validateUrlSafety(targetUrl);
        next();
    } catch (error: unknown) {
        console.warn(
            `SSRF Blocked: ${req.ip} attempted to scan ${targetUrl} - ${error instanceof Error ? error.message : 'Unknown error'}`,
        );

        res.status(403).json({
            error: 'SSRF Protection Triggered',
            message:
                error instanceof Error
                    ? error.message
                    : 'The provided URL is unsafe or resolves to an internal network.',
        });
    }
};
