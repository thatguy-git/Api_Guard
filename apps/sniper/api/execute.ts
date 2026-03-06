import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios, { AxiosError } from 'axios';
import { SniperRequestSchema } from './types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // 1. Method Guard
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // 2. Internal Auth Guard (The "Secret Handshake")
    const internalSecret = req.headers['x-api-guard-secret'];
    if (
        !internalSecret ||
        internalSecret !== process.env.SNIPER_INTERNAL_SECRET
    ) {
        console.error('🚫 Unauthorized Sniper Access Attempt');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const validatedBody = SniperRequestSchema.parse(req.body);
        const { method, url, headers, data } = validatedBody;

        const startTime = Date.now();

        // 4. Execution with Fingerprint Rotation
        const response = await axios({
            method,
            url,
            data,
            headers: {
                ...headers,
                'User-Agent': 'Api-Guard-Bot/1.0 (Security Resilience Engine)',
                'X-Powered-By': 'Api-Guard-Sniper',
            },
            timeout: 15000,
            maxRedirects: 5,
            validateStatus: () => true, // Don't throw on 4xx/5xx, we want the results
        });

        const latency = Date.now() - startTime;

        return res.status(200).json({
            status: response.status,
            data: response.data,
            headers: response.headers,
            latency,
        });
    } catch (error: any) {
        if (error.name === 'ZodError') {
            return res
                .status(400)
                .json({ error: 'Invalid Payload', details: error.errors });
        }

        const axiosError = error as AxiosError;
        return res.status(502).json({
            error: 'Upstream Execution Error',
            message: axiosError.message,
            code: axiosError.code,
        });
    }
}
