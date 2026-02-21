import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
});

const MODEL = 'llama-3.3-70b-versatile';

export interface IdempotencySchema {
    identity: string[];
    noise: string[];
    data: string[];
}

export interface RaceConstraint {
    max_successes: number | 'UNLIMITED';
    reason: string;
}

export interface MismatchVerdict {
    verdict: 'PASS' | 'FAIL';
    reason: string;
}

export interface PoisonedPayload {
    poisonedBody: Record<string, unknown>;
    injectedFields: string[];
}

export interface MassAssignmentVerdict {
    verdict: 'PASS' | 'FAIL';
    reason: string;
}

async function askGroqJSON<T>(
    systemPrompt: string,
    userPrompt: string,
    fallback: T,
): Promise<T> {
    try {
        const completion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            model: MODEL,
            response_format: { type: 'json_object' },
            temperature: 0,
        });

        const content = completion.choices[0].message.content || '{}';
        return JSON.parse(content) as T;
    } catch (e) {
        console.error('Groq Inference Error:', e);
        return fallback;
    }
}

//IDEMPOTENCY CHECK
export async function analyzeIdempotencySchema(
    responseBody: any,
    status: number,
): Promise<IdempotencySchema> {
    if (!responseBody || Object.keys(responseBody).length === 0) {
        return { identity: [], noise: [], data: [] };
    }

    const prompt = `
    Analyze this API Response (Status ${status}) for IDEMPOTENCY testing.
    Categorize keys into:
    1. "identity": Critical fields (id, uuid, url). MUST NOT change.
    2. "noise": Metadata (time, latency, trace_id). EXPECTED to change.
    3. "data": Business state. SHOULD match.

    JSON: ${JSON.stringify(responseBody).slice(0, 1500)}
    Return JSON: { "identity": [], "noise": [], "data": [] }
    `;

    return askGroqJSON<IdempotencySchema>(
        'You are a QA Engineer. Output JSON only.',
        prompt,
        { identity: [], noise: [], data: Object.keys(responseBody) },
    );
}

export async function evaluateIdempotencyMismatch(
    req1: { status: number; body: any },
    req2: { status: number; body: any },
): Promise<MismatchVerdict> {
    const prompt = `
    Analyze these two sequential API responses to the EXACT SAME request.
    
    1. BASELINE (First Attempt):
        Status: ${req1.status}
        Body: ${JSON.stringify(req1.body || '').slice(0, 500)}

    2. REPLAY (Second Attempt):
        Status: ${req2.status}
        Body: ${JSON.stringify(req2.body || '').slice(0, 500)}

    Task: Determine if this behavior represents SAFE IDEMPOTENCY.
    
    - PASS if:
        a) The second request was blocked (4xx/409) specifically because the action was already completed.
        b) The response body implies "Already exists", "Duplicate", "Processed", or "Paid".
    
    - FAIL if:
        a) The status change seems random (e.g. 200 -> 500).
        b) The second request failed with an unrelated error (e.g. "Invalid formatting").
        
    Return JSON: { "verdict": "PASS" or "FAIL", "reason": "Short explanation for the developer" }
    `;

    return askGroqJSON<MismatchVerdict>(
        'You are a Senior QA Automation Engineer. Be strict but recognize standard API patterns.',
        prompt,
        {
            verdict: 'FAIL',
            reason: 'AI Analysis Failed, defaulting to strict fail.',
        },
    );
}

//RACE CONDITION CHECK
export async function analyzeRaceConditionIntent(
    method: string,
    url: string,
    body: any,
): Promise<RaceConstraint> {
    const prompt = `
    Analyze the intent of this API request for RACE CONDITIONS.
    Request: ${method} ${url}
    Body: ${JSON.stringify(body || {}).slice(0, 500)}

    Is this action "Single-Use" (max 1 success, e.g. coupon, voting) or "Unlimited" (e.g. search, add to cart)?
    Return JSON: { "max_successes": NUMBER or "UNLIMITED", "reason": "short explanation" }
    `;

    const result = await askGroqJSON<any>(
        'You are a Logic Analyzer. Output JSON only.',
        prompt,
        { max_successes: 1, reason: 'Fallback Default' },
    );

    // Normalize the AI output (handle "UNLIMITED" string vs numbers)
    return {
        max_successes:
            result.max_successes === 'UNLIMITED'
                ? 'UNLIMITED'
                : Number(result.max_successes) || 1,
        reason: result.reason || 'AI Default',
    };
}

//MASS ASSIGNMENT
export async function generateMassAssignmentPayload(
    baselineBody: unknown,
): Promise<PoisonedPayload> {
    const prompt = `
    Analyze this API request body. 
    Baseline: ${JSON.stringify(baselineBody || {}).slice(0, 1000)}

    Task: Act as a penetration tester. Generate a "poisoned" version of this body by injecting 3 to 5 common sensitive fields that developers often forget to filter out (e.g., isAdmin, role, balance, permissions, tenant_id, is_verified). 
    Keep the original fields intact so the request still looks valid.

    Return JSON strictly in this format:
    {
      "poisonedBody": { /* the merged original + malicious fields */ },
      "injectedFields": ["role", "isAdmin", ...] /* just the names of the keys you added */
    }
    `;

    return askGroqJSON<PoisonedPayload>(
        'You are a strict Security Auditor. Output JSON only.',
        prompt,
        {
            poisonedBody: {
                ...(baselineBody && typeof baselineBody === 'object'
                    ? baselineBody
                    : {}),
                isAdmin: true,
                role: 'admin',
            },
            injectedFields: ['isAdmin', 'role'],
        },
    );
}

export async function analyzeMassAssignmentResponse(
    injectedPayload: Record<string, unknown>,
    baselineResponse: unknown,
    attackResponse: unknown,
    statusCode: number,
): Promise<MassAssignmentVerdict> {
    const prompt = `
    I sent a Mass Assignment attack to an API.
    
    1. INJECTED PAYLOAD: ${JSON.stringify(injectedPayload)}
    2. BASELINE RESPONSE (Normal): ${JSON.stringify(baselineResponse || '').slice(0, 1000)}
    3. ATTACK RESPONSE (Status ${statusCode}): ${JSON.stringify(attackResponse || '').slice(0, 1000)}

    Task: Did the server actually process and apply the malicious payload?
    
    - PASS if: 
        a) The server returned a 4xx error (validation caught it).
        b) The server returned 2xx, BUT the ATTACK RESPONSE matches the BASELINE RESPONSE for the injected fields. (e.g. If 'balance' is in both responses, but the value didn't change to the injected value, the server safely ignored the injection).
        
    - FAIL if: 
        The server returned 2xx AND the ATTACK RESPONSE reflects the injected values (e.g. the 'balance' or 'role' in the response changed to match the malicious payload).

    Return JSON: { "verdict": "PASS" or "FAIL", "reason": "Short explanation" }
    `;

    return askGroqJSON<MassAssignmentVerdict>(
        'You are a Security Auditor evaluating an API response. Compare the baseline to the attack. Output JSON only.',
        prompt,
        {
            verdict: 'FAIL',
            reason: 'AI fallback: Assume vulnerable if analysis fails.',
        },
    );
}
