export interface BolaConfig {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers: Record<string, string> | undefined;
    secondaryHeaders: Record<string, string> | undefined;
    body?: unknown;
}

export interface BolaResult {
    verdict: 'PASS' | 'FAIL' | 'WARN';
    title: string;
    description: string;
    meta: {
        baselineStatus: number;
        attackStatus: number;
        durationMs: number;
    };
}

export const runBolaTest = async (config: BolaConfig): Promise<BolaResult> => {
    console.log(`🪪 Starting BOLA Test on ${config.url}...`);

    if (
        !config.secondaryHeaders ||
        Object.keys(config.secondaryHeaders).length === 0
    ) {
        throw new Error(
            "BOLA test requires 'secondaryHeaders' (Attacker's credentials).",
        );
    }

    const start = performance.now();

    // 1. Fire Baseline (User A trying to access User A's resource)
    let baselineStatus = 0;
    let baselineText = '';
    try {
        const baselineRes = await fetch(config.url, {
            method: config.method,
            headers: config.headers as HeadersInit,
            body: config.body ? JSON.stringify(config.body) : undefined,
        });
        baselineStatus = baselineRes.status;
        baselineText = await baselineRes.text();
    } catch (error: unknown) {
        console.error('error firing baseline request:', error);
        return {
            verdict: 'WARN',
            title: 'Baseline Failed',
            description: `Could not reach the endpoint with Victim credentials.`,
            meta: {
                baselineStatus: 0,
                attackStatus: 0,
                durationMs: performance.now() - start,
            },
        };
    }

    // If the baseline itself is rejected, we can't test for BOLA
    if (baselineStatus >= 400) {
        return {
            verdict: 'WARN',
            title: 'Invalid Baseline',
            description: `The baseline request failed with status ${baselineStatus}. BOLA requires a successful baseline (2xx) to test against.`,
            meta: {
                baselineStatus,
                attackStatus: 0,
                durationMs: performance.now() - start,
            },
        };
    }

    // 2. Fire Attack (User B trying to access User A's resource)
    let attackStatus = 0;
    let attackText = '';
    try {
        const attackRes = await fetch(config.url, {
            method: config.method,
            headers: config.secondaryHeaders as HeadersInit, // 😈 Inject Attacker Credentials
            body: config.body ? JSON.stringify(config.body) : undefined,
        });
        attackStatus = attackRes.status;
        attackText = await attackRes.text();
    } catch (error: unknown) {
        return {
            verdict: 'WARN',
            title: 'Attack Request Failed',
            description: `Network error during the attack phase.`,
            meta: {
                baselineStatus,
                attackStatus: 0,
                durationMs: performance.now() - start,
            },
        };
    }

    const durationMs = performance.now() - start;

    // 3. Logic-Based Verdict (No AI needed for strict BOLA)
    let verdict: 'PASS' | 'FAIL' | 'WARN' = 'FAIL';
    let title = 'BOLA Vulnerability Detected';
    let description = `User B successfully accessed User A's resource (Status ${attackStatus}).`;

    // If the server correctly rejects User B with 401, 403, or 404
    if (attackStatus === 401 || attackStatus === 403 || attackStatus === 404) {
        verdict = 'PASS';
        title = 'Authorization Enforced';
        description = `The server correctly blocked User B from accessing the resource (Status ${attackStatus}).`;
    }
    // If User B gets a 2xx, check if the data actually leaked or if it's an empty success
    else if (attackStatus >= 200 && attackStatus < 300) {
        if (baselineText === attackText && baselineText.length > 10) {
            verdict = 'FAIL';
            title = 'Critical BOLA Vulnerability';
            description = `User B extracted the exact same data as User A using their own credentials.`;
        } else {
            verdict = 'WARN';
            ((title = 'Potential Data Leak'),
                (description = `User B received a 2xx success, but the data differed from User A. Manual review required.`));
        }
    }

    return {
        verdict,
        title,
        description,
        meta: { baselineStatus, attackStatus, durationMs },
    };
};
