import { generateSqliPayload, analyzeSqliResponse } from '../../utils/ai.js';

export interface SqliConfig {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    body?: unknown;
}

export interface SqliResult {
    verdict: 'PASS' | 'FAIL' | 'WARN';
    title: string;
    description: string;
    meta: { statusCode: number; durationMs: number };
}

export const runSqliTest = async (config: SqliConfig): Promise<SqliResult> => {
    console.log(`💉 Starting SQL/NoSQL Injection Test on ${config.url}...`);

    if (!config.body || Object.keys(config.body).length === 0) {
        return {
            verdict: 'PASS',
            title: 'No Body',
            description: 'SQLi test currently requires a JSON body.',
            meta: { statusCode: 0, durationMs: 0 },
        };
    }

    const { poisonedBody } = await generateSqliPayload(config.body);
    const start = performance.now();

    let statusCode = 0;
    let responseData: unknown = null;

    try {
        const response = await fetch(config.url, {
            method: config.method,
            headers: config.headers as HeadersInit,
            body: JSON.stringify(poisonedBody),
        });
        statusCode = response.status;
        const text = await response.text();
        try {
            responseData = JSON.parse(text);
        } catch {
            responseData = text;
        }
    } catch (error) {
        return {
            verdict: 'WARN',
            title: 'Network Error',
            description: 'Failed to reach endpoint.',
            meta: { statusCode: 0, durationMs: performance.now() - start },
        };
    }

    const analysis = await analyzeSqliResponse(statusCode, responseData);

    return {
        verdict: analysis.verdict,
        title:
            analysis.verdict === 'PASS'
                ? 'Injection Prevented'
                : 'SQL/NoSQL Injection Vulnerability',
        description: analysis.reason,
        meta: {
            statusCode,
            durationMs: Number((performance.now() - start).toFixed(2)),
        },
    };
};
