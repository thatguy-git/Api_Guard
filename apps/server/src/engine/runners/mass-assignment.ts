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

    // Mass assignment doesn't apply to GET or DELETE requests usually
    if (config.method === 'GET' || config.method === 'DELETE') {
        return {
            verdict: 'PASS',
            title: 'Not Applicable',
            description: `Mass assignment testing is generally not applicable to ${config.method} endpoints.`,
            meta: { statusCode: 0, injectedFields: [], durationMs: 0 },
        };
    }

    // 1. Generate the Poisoned Payload
    const { poisonedBody, injectedFields } =
        await generateMassAssignmentPayload(config.body);
    console.log(`💉 Injecting fields: ${injectedFields.join(', ')}`);

    const start = performance.now();

    // 2. Fire the Attack
    let statusCode = 0;
    let responseData: unknown = null;

    try {
        const response = await fetch(config.url, {
            method: config.method,
            headers: config.headers as HeadersInit,
            body: JSON.stringify(poisonedBody),
        });

        statusCode = response.status;

        // Safely attempt to parse JSON, fallback to text
        const text = await response.text();
        try {
            responseData = JSON.parse(text);
        } catch {
            responseData = text;
        }
    } catch (error: unknown) {
        const errorMessage =
            error instanceof Error ? error.message : 'Network error';
        return {
            verdict: 'WARN',
            title: 'Request Failed',
            description: `Could not reach the endpoint to test mass assignment: ${errorMessage}`,
            meta: {
                statusCode: 0,
                injectedFields,
                durationMs: performance.now() - start,
            },
        };
    }

    const durationMs = performance.now() - start;

    // 3. AI Analysis of the Response
    console.log(`🧠 Analyzing response (${statusCode}) for vulnerability...`);
    const analysis = await analyzeMassAssignmentResponse(
        injectedFields,
        statusCode,
        responseData,
    );

    // 4. Final Formatting
    return {
        verdict: analysis.verdict,
        title:
            analysis.verdict === 'PASS'
                ? 'Payload Filtered'
                : 'Mass Assignment Vulnerability',
        description: analysis.reason,
        meta: {
            statusCode,
            injectedFields,
            durationMs: Number(durationMs.toFixed(2)),
        },
    };
};
