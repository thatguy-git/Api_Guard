import { analyzeRaceConditionIntent } from '../../utils/ai.js';

interface RaceResult {
    verdict: 'PASS' | 'FAIL' | 'WARN';
    title: string;
    description: string;
    meta: any;
}

export const runRaceConditionTest = async (config: {
    url: string;
    method: string;
    headers?: any;
    body?: any;
}): Promise<RaceResult> => {
    const BATCH_SIZE = 10; // Number of parallel requests to fire
    console.log(
        `🏎️ Starting Race Condition Test: firing ${BATCH_SIZE} requests at once...`,
    );

    // 1. AI Analysis: "How many times SHOULD this succeed?"
    // e.g. "Add to Cart" -> Unlimited. "Transfer Money" -> Once.
    let constraint = { max_successes: 1, reason: 'Default strict safety' };

    try {
        const aiResult = await analyzeRaceConditionIntent(
            config.method,
            config.url,
            config.body,
        );
        // Normalize the AI result
        constraint = {
            max_successes:
                aiResult.max_successes === 'UNLIMITED'
                    ? 9999
                    : Number(aiResult.max_successes) || 1,
            reason: aiResult.reason,
        };
        console.log(
            `🤖 AI Constraint: Max ${constraint.max_successes} successes allowed. (${constraint.reason})`,
        );
    } catch (err) {
        console.warn(
            '⚠️ AI Analysis failed, defaulting to strict mode (Max 1).',
        );
    }

    // 2. The Attack (Parallel Burst)
    // We create an array of promises and fire them all instantly
    const requestPromises = Array(BATCH_SIZE)
        .fill(null)
        .map(() =>
            fetch(config.url, {
                method: config.method,
                headers: config.headers,
                body: config.body ? JSON.stringify(config.body) : undefined,
            })
                .then(async (res) => ({
                    status: res.status,
                    ok: res.ok, // True if 2xx
                    text: await res.text().catch(() => ''),
                }))
                .catch((err) => ({
                    status: 0,
                    ok: false,
                    error: err.message,
                    text: '',
                })),
        );

    const start = performance.now();
    const responses = await Promise.all(requestPromises);
    const duration = performance.now() - start;

    // 3. The Tally
    const successes = responses.filter((r) => r.ok).length;
    const failures = responses.filter((r) => !r.ok).length;
    const distinctStatusCodes = [...new Set(responses.map((r) => r.status))];

    console.log(`📊 Results: ${successes} Successes, ${failures} Failures`);

    // 4. The Verdict
    let verdict: 'PASS' | 'FAIL' | 'WARN' = 'PASS';
    let title = 'Race Condition Safe';
    let description = `The API correctly handled high concurrency.`;

    // IF: We got more successes than allowed
    if (successes > constraint.max_successes) {
        verdict = 'FAIL';
        title = 'Race Condition Detected';
        description = `The API allowed ${successes} successful operations, but AI determined only ${constraint.max_successes} should be possible. (${constraint.reason})`;
    }
    // IF: Everything failed (e.g. 500 Server Error)
    else if (successes === 0 && failures > 0) {
        verdict = 'WARN';
        title = 'Endpoint Unstable';
        description =
            'The API crashed or rejected all requests during the stress test.';
    }

    return {
        verdict,
        title,
        description,
        meta: {
            totalRequests: BATCH_SIZE,
            successCount: successes,
            failCount: failures,
            statusCodes: distinctStatusCodes,
            durationMs: duration,
            aiConstraint: constraint,
        },
    };
};
