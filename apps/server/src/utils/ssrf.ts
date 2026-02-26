import dns from 'dns';
import { promisify } from 'util';

const ALLOWED_TUNNEL_DOMAINS = [
    'ngrok-free.app',
    'ngrok.io',
    'trycloudflare.com',
    'localtunnel.me',
];

const lookupAsync = promisify(dns.lookup);

/**
 * Checks if an IPv4 or IPv6 address belongs to a private, loopback, or reserved range.
 */
export const isPrivateIP = (ip: string): boolean => {
    // IPv4 Loopback (127.0.0.0/8) and Current Network (0.0.0.0/8)
    if (/^(127|0)\./.test(ip)) return true;

    // IPv4 Private Networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
    if (/^10\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;

    // IPv4 Cloud Metadata / Link-Local (169.254.0.0/16) - CRITICAL FOR AWS/GCP
    if (/^169\.254\./.test(ip)) return true;

    // IPv6 Loopback and Unique Local Address (ULA)
    if (ip === '::1' || /^f[cd][0-9a-f]{2}:/i.test(ip)) return true;

    // IPv6 Link-Local
    if (/^fe80:/i.test(ip)) return true;

    // IPv4-mapped IPv6 addresses for loopback/private (e.g., ::ffff:127.0.0.1)
    if (ip.startsWith('::ffff:')) {
        const ipv4Part = ip.split('::ffff:')[1];
        return isPrivateIP(ipv4Part);
    }

    return false;
};

/**
 * Takes a URL, resolves its DNS, and checks if it resolves to a malicious IP.
 * Throws an error if the URL is unsafe.
 */
export const validateUrlSafety = async (targetUrl: string): Promise<void> => {
    let parsedUrl: URL;

    try {
        parsedUrl = new URL(targetUrl);
    } catch {
        throw new Error('Invalid URL format provided.');
    }

    // Only allow HTTP and HTTPS (prevents file://, ftp://, gopher:// attacks)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error(`Protocol ${parsedUrl.protocol} is not allowed.`);
    }

    const hostname = parsedUrl.hostname;

    const isTunnel = ALLOWED_TUNNEL_DOMAINS.some((domain) =>
        hostname.endsWith(domain),
    );

    if (isTunnel) {
        return;
    }

    try {
        const { address } = await lookupAsync(hostname);
        if (isPrivateIP(address)) {
            console.log(
                `Target URL resolves to a restricted internal IP address (${address}).`,
            );

            throw new Error(`Cannot resolve restricted address.`);
        }
    } catch (error: unknown) {
        if (error instanceof Error && error !== null) {
            if ((error as any).code === 'ENOTFOUND') {
                throw new Error('Could not resolve the hostname.');
            }
        }

        throw error;
    }
};
