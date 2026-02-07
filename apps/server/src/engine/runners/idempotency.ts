import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import _ from 'lodash';
import {
    analyzeIdempotencySchema,
    evaluateIdempotencyMismatch,
} from '../../utils/ai.js';

export interface IdempotencyConfig {
    url: string;
    method: 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Record<string, string>;
    body?: any;
}

export interface IdempotencyResult {
    verdict: 'PASS' | 'FAIL' | 'WARN' | 'ERROR';
    title: string;
    description: string;
    meta: {
        req1Status: number;
        req2Status: number;
        req1Time: number;
        req2Time: number;
        aiSchema?: any;
        diff?: any;
    };
}

export async function runIdempotencyTest(
    config: IdempotencyConfig,
): Promise<IdempotencyResult> {
    const requestConfig: AxiosRequestConfig = {
        method: config.method,
        url: config.url,
        headers: config.headers,
        data: config.body,
        validateStatus: () => true,
        timeout: 8000,
    };

    try {
        console.log('🚀 Firing Baseline Request...');
        const start1 = performance.now();
        const res1 = await axios(requestConfig);
        const time1 = performance.now() - start1;

        if (res1.status >= 500) {
            return {
                verdict: 'FAIL',
                title: 'Server Crash',
                description: `API returned ${res1.status} on the first request. Cannot test idempotency on a broken endpoint.`,
                meta: {
                    req1Status: res1.status,
                    req2Status: 0,
                    req1Time: time1,
                    req2Time: 0,
                },
            };
        }

        console.log('🧠 Analyzing Response Pattern...');

        const schema = await analyzeIdempotencySchema(res1.data, res1.status);

        console.log('🔄 Firing Replay Request...');
        // Small delay to simulate real-world retry latency (optional but recommended)
        await new Promise((r) => setTimeout(r, 500));

        const start2 = performance.now();
        const res2 = await axios(requestConfig);
        const time2 = performance.now() - start2;

        console.log('⚖️  Verifying Results...');

        // Case A: Perfect Conflict Handling (The "Gold Standard")
        if (res1.status >= 200 && res1.status < 300 && res2.status === 409) {
            return {
                verdict: 'PASS',
                title: 'Conflict Correctly Handled',
                description:
                    'Server identified the duplicate request and returned 409 Conflict.',
                meta: {
                    req1Status: res1.status,
                    req2Status: res2.status,
                    req1Time: time1,
                    req2Time: time2,
                },
            };
        }

        const status1 = res1.status;
        const status2 = res2.status;

        // Case B: Status Code Mismatch
        if (status1 !== status2) {
            console.log(
                `🧠 Status Mismatch (${status1} vs ${status2}). Asking AI for verdict...`,
            );

            const aiJudgment = await evaluateIdempotencyMismatch(
                { status: status1, body: res1.data },
                { status: status2, body: res2.data },
            );

            return {
                verdict: aiJudgment.verdict, // 'PASS' or 'FAIL' directly from AI
                title:
                    aiJudgment.verdict === 'PASS'
                        ? 'Safe Idempotent Rejection'
                        : 'Inconsistent Status Code',
                description: aiJudgment.reason,
                meta: {
                    req1Status: status1,
                    req2Status: status2,
                    req1Time: time1,
                    req2Time: time2,
                },
            };
        }
        if (status1 !== status2) {
            console.log(
                `🧠 Status Mismatch (${status1} vs ${status2}). Asking AI for verdict...`,
            );

            const aiJudgment = await evaluateIdempotencyMismatch(
                { status: status1, body: res1.data },
                { status: status2, body: res2.data },
            );

            return {
                verdict: aiJudgment.verdict, // 'PASS' or 'FAIL' directly from AI
                title:
                    aiJudgment.verdict === 'PASS'
                        ? 'Safe Idempotent Rejection'
                        : 'Inconsistent Status Code',
                description: aiJudgment.reason,
                meta: {
                    req1Status: status1,
                    req2Status: status2,
                    req1Time: time1,
                    req2Time: time2,
                },
            };
        }

        // Case C: Body Verification (Using AI Schema)
        // If response is not JSON, we skip deep analysis
        if (typeof res1.data !== 'object') {
            return {
                verdict: res1.data === res2.data ? 'PASS' : 'WARN',
                title: 'Non-JSON Response',
                description:
                    'Response was text/html. Simple string comparison performed.',
                meta: {
                    req1Status: res1.status,
                    req2Status: res2.status,
                    req1Time: time1,
                    req2Time: time2,
                },
            };
        }

        const validation = validateBodies(res1.data, res2.data, schema);

        return {
            verdict: validation.verdict,
            title: validation.title,
            description: validation.description,
            meta: {
                req1Status: res1.status,
                req2Status: res2.status,
                req1Time: time1,
                req2Time: time2,
                aiSchema: schema,
                diff: validation.diff,
            },
        };
    } catch (err: any) {
        console.error('Runner Error:', err);
        return {
            verdict: 'ERROR',
            title: 'Execution Error',
            description: `Test runner failed: ${err.message}`,
            meta: { req1Status: 0, req2Status: 0, req1Time: 0, req2Time: 0 },
        };
    }
}

// --- Helper: Logic Verifier ---

function validateBodies(
    body1: any,
    body2: any,
    schema: any,
): {
    verdict: 'PASS' | 'WARN' | 'FAIL' | 'ERROR';
    title: string;
    description: string;
    diff?: any;
} {
    for (const field of schema.identity || []) {
        const val1 = _.get(body1, field);
        const val2 = _.get(body2, field);

        if (!_.isEqual(val1, val2)) {
            return {
                verdict: 'FAIL',
                title: 'Double Execution Detected',
                description: `Critical identity field '${field}' changed from '${val1}' to '${val2}'. This implies a new resource was created.`,
                diff: { field, val1, val2 },
            };
        }
    }

    for (const field of schema.data || []) {
        const val1 = _.get(body1, field);
        const val2 = _.get(body2, field);

        if (!_.isEqual(val1, val2)) {
            return {
                verdict: 'WARN',
                title: 'State Mutation Detected',
                description: `Field '${field}' changed value. This might be a side-effect, but the resource ID remained stable.`,
                diff: { field, val1, val2 },
            };
        }
    }

    return {
        verdict: 'PASS',
        title: 'Idempotent Response',
        description:
            'Response body is functionally identical (ignoring dynamic metadata).',
    };
}
