import OpenAI from 'openai';

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
});

const MODEL = 'llama3-70b-8192';

export interface SchemaResponse {
    identity: string[];
    noise: string[];
    data: string[];
}

export interface ConstraintResponse {
    max_successes: number | 'UNLIMITED';
    reason: string;
}

export async function analyzeIdempotencySchema(
    responseBody: any,
    status: number,
): Promise<SchemaResponse> {
    if (!responseBody || Object.keys(responseBody).length === 0) {
        return { identity: [], noise: [], data: [] };
    }

    const prompt = `
    I am an API Testing Bot. I performed a request (Status ${status}) and got this JSON.
    Categorize keys for IDEMPOTENCY testing:
    1. "identity": Critical fields (id, uuid, url). MUST NOT change.
    2. "noise": Metadata (time, latency, trace_id). EXPECTED to change.
    3. "data": Business state. SHOULD match.

    JSON: ${JSON.stringify(responseBody).slice(0, 1500)}

    Return JSON: { "identity": [], "noise": [], "data": [] }
  `;

    try {
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: 'You are a QA Engineer. Output JSON only.',
                },
                { role: 'user', content: prompt },
            ],
            model: MODEL,
            response_format: { type: 'json_object' },
            temperature: 0,
        });

        return JSON.parse(completion.choices[0].message.content || '{}');
    } catch (e) {
        console.error('Groq AI Error:', e);
        // Fallback safe mode
        return { identity: [], noise: [], data: Object.keys(responseBody) };
    }
}

export async function analyzeRaceCondition(
    method: string,
    url: string,
    body: any,
): Promise<ConstraintResponse> {
    const prompt = `
    Analyze the intent of this API request for RACE CONDITIONS.
    Request: ${method} ${url}
    Body: ${JSON.stringify(body || {}).slice(0, 500)}

    Is this action "Single-Use" (max 1 success, e.g. coupon) or "Unlimited" (e.g. search)?
    
    Return JSON: { "max_successes": NUMBER or "UNLIMITED", "reason": "string" }
  `;

    try {
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: 'You are a Logic Analyzer. Output JSON only.',
                },
                { role: 'user', content: prompt },
            ],
            model: MODEL,
            response_format: { type: 'json_object' },
            temperature: 0,
        });

        const res = JSON.parse(completion.choices[0].message.content || '{}');
        return {
            max_successes:
                res.max_successes === 'UNLIMITED'
                    ? 'UNLIMITED'
                    : Number(res.max_successes) || 1,
            reason: res.reason || 'AI Default',
        };
    } catch (e) {
        return {
            max_successes: 1,
            reason: 'AI Failed, defaulting to Strict 1.',
        };
    }
}
