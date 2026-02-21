// Define strict types for the configuration
export interface RateLimitConfig {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    body?: unknown;
    // Optional tuning parameters for the stress test
    requestsToFire?: number;
    concurrencyLimit?: number;
}

export interface RateLimitResult {
    verdict: 'PASS' | 'FAIL' | 'WARN';
    title: string;
    description: string;
    meta: {
        totalRequests: number;
        successCount: number;
        rateLimitedCount: number; // 429s
        serverErrorCount: number; // 500s
        durationMs: number;
    };
}

// Helper to manage timeouts to prevent hanging workers
const fetchWithTimeout = async (
    url: string,
    options: RequestInit,
    timeoutMs: number = 8000,
): Promise<{ status: number; ok: boolean }> => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        clearTimeout(id);
        return { status: response.status, ok: response.ok };
    } catch (error) {
        clearTimeout(id);
        // Return 0 for network failures or aborts to distinguish from HTTP status codes
        return { status: 0, ok: false };
    }
};

/**
 * Fires a sequence of requests to test if an API enforces HTTP 429 Too Many Requests.
 */
export const runRateLimitTest = async (
    config: RateLimitConfig,
): Promise<RateLimitResult> => {
    // Production defaults: 60 requests is usually enough to trigger standard 1req/sec limits
    const TOTAL_REQUESTS = config.requestsToFire ?? 60;
    const BATCH_SIZE = config.concurrencyLimit ?? 15;

    console.log(
        `⏱️ Starting Rate Limit Test: Firing ${TOTAL_REQUESTS} requests in batches of ${BATCH_SIZE}...`,
    );

    const results: { status: number; ok: boolean }[] = [];
    const start = performance.now();

    const requestOptions: RequestInit = {
        method: config.method,
        headers: config.headers as HeadersInit,
        body: config.body ? JSON.stringify(config.body) : undefined,
    };

    // Process in chunks to prevent Node.js socket exhaustion
    for (let i = 0; i < TOTAL_REQUESTS; i += BATCH_SIZE) {
        const batchSize = Math.min(BATCH_SIZE, TOTAL_REQUESTS - i);
        const promises = Array.from({ length: batchSize }).map(() =>
            fetchWithTimeout(config.url, requestOptions),
        );

        // Wait for the current batch to finish before firing the next
        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
    }

    const durationMs = performance.now() - start;

    // Tally the results
    const successCount = results.filter(
        (r) => r.status >= 200 && r.status < 300,
    ).length;
    const rateLimitedCount = results.filter((r) => r.status === 429).length;
    const serverErrorCount = results.filter((r) => r.status >= 500).length;

    console.log(
        `📊 Rate Limit Tally: ${successCount} Successes | ${rateLimitedCount} Rate Limits | ${serverErrorCount} Server Errors`,
    );

    // Analyze the verdict based on HTTP standards
    let verdict: 'PASS' | 'FAIL' | 'WARN' = 'FAIL';
    let title = 'Rate Limit Not Enforced';
    let description = `The API allowed all ${successCount} requests through without returning a 429 status.`;

    if (rateLimitedCount > 0) {
        verdict = 'PASS';
        title = 'Rate Limit Enforced';
        description = `The API correctly identified the spam and returned HTTP 429 Too Many Requests after ${successCount} successful requests.`;
    } else if (serverErrorCount > 0 && successCount < TOTAL_REQUESTS) {
        verdict = 'WARN';
        title = 'Server Degraded Under Load';
        description = `The API did not enforce rate limits cleanly (no 429s). Instead, the server crashed or dropped connections (returned 5xx or timed out).`;
    }

    return {
        verdict,
        title,
        description,
        meta: {
            totalRequests: TOTAL_REQUESTS,
            successCount,
            rateLimitedCount,
            serverErrorCount,
            durationMs: Number(durationMs.toFixed(2)),
        },
    };
};
