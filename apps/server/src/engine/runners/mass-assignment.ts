import {
    generateMassAssignmentPayload,
    analyzeMassAssignmentResponse,
} from '../../utils/ai.js';

export interface MassAssignmentConfig {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    body?: unknown;
}

export interface MassAssignmentResult {
    verdict: 'PASS' | 'FAIL' | 'WARN';
    title: string;
    description: string;
    meta: {
        statusCode: number;
        injectedFields: string[];
        durationMs: number;
    };
}

export const runMassAssignmentTest = async (
    config: MassAssignmentConfig,
): Promise<MassAssignmentResult> => {
    console.log(`🕵️ Starting Mass Assignment Test on ${config.url}...`);

    if (config.method === 'GET' || config.method === 'DELETE') {
        return {
            verdict: 'PASS',
            title: 'Not Applicable',
            description: `Mass assignment testing is generally not applicable to ${config.method} endpoints.`,
            meta: { statusCode: 0, injectedFields: [], durationMs: 0 },
        };
    }

    const start = performance.now();

    // 1. Fire the Baseline Request
    console.log(`📡 Firing Baseline Request...`);
    let baselineResponseData: unknown = null;
    try {
        const baselineRes = await fetch(config.url, {
            method: config.method,
            headers: config.headers as HeadersInit,
            body: config.body ? JSON.stringify(config.body) : undefined,
        });
        const text = await baselineRes.text();
        try {
            baselineResponseData = JSON.parse(text);
        } catch {
            baselineResponseData = text;
        }
    } catch (error: unknown) {
        console.error(error);
        return {
            verdict: 'WARN',
            title: 'Baseline Failed',
            description: `Could not reach the endpoint to establish a baseline.`,
            meta: {
                statusCode: 0,
                injectedFields: [],
                durationMs: performance.now() - start,
            },
        };
    }

    // 2. Generate the Poisoned Payload
    const { poisonedBody, injectedFields } =
        await generateMassAssignmentPayload(config.body);
    console.log(`💉 Injecting fields: ${injectedFields.join(', ')}`);

    // Extract exactly what we injected so the AI knows what to look for
    const injectedPayload: Record<string, unknown> = {};
    for (const field of injectedFields) {
        injectedPayload[field] = (poisonedBody as Record<string, unknown>)[
            field
        ];
    }

    // 3. Fire the Attack Request
    console.log(`⚔️ Firing Attack Request...`);
    let attackStatusCode = 0;
    let attackResponseData: unknown = null;

    try {
        const attackRes = await fetch(config.url, {
            method: config.method,
            headers: config.headers as HeadersInit,
            body: JSON.stringify(poisonedBody),
        });

        attackStatusCode = attackRes.status;
        const text = await attackRes.text();
        try {
            attackResponseData = JSON.parse(text);
        } catch {
            attackResponseData = text;
        }
    } catch (error: unknown) {
        return {
            verdict: 'WARN',
            title: 'Attack Failed',
            description: `Could not reach the endpoint during the attack phase.`,
            meta: {
                statusCode: 0,
                injectedFields,
                durationMs: performance.now() - start,
            },
        };
    }

    const durationMs = performance.now() - start;

    // 4. AI Analysis
    console.log(
        `Comparing baseline to attack response (${attackStatusCode})...`,
    );
    const analysis = await analyzeMassAssignmentResponse(
        injectedPayload,
        baselineResponseData,
        attackResponseData,
        attackStatusCode,
    );

    return {
        verdict: analysis.verdict,
        title:
            analysis.verdict === 'PASS'
                ? 'Payload Filtered'
                : 'Mass Assignment Vulnerability',
        description: analysis.reason,
        meta: {
            statusCode: attackStatusCode,
            injectedFields,
            durationMs: Number(durationMs.toFixed(2)),
        },
    };
};
