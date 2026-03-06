import axios from 'axios';
import { SniperRequest, SniperResponse } from '../../../sniper/api/types.js';

/**
 * The Central Dispatcher
 * This is the ONLY place in your workers that should touch the network.
 */
export const dispatchRequest = async (
    config: SniperRequest,
): Promise<SniperResponse> => {
    const isProduction = process.env.NODE_ENV === 'production';
    const sniperUrl = process.env.SNIPER_URL;

    // 1. Logic: Use Sniper in Prod, Direct Axios in Dev (for speed/local testing)
    if (isProduction && sniperUrl) {
        try {
            const { data } = await axios.post<SniperResponse>(
                sniperUrl,
                config,
                {
                    headers: {
                        'x-api-guard-secret':
                            process.env.SNIPER_INTERNAL_SECRET!,
                        'Content-Type': 'application/json',
                    },
                    timeout: 20000, // Slightly longer than the Sniper's internal timeout
                },
            );
            return data;
        } catch (error: any) {
            console.error('🚨 Sniper Delegation Failed:', error.message);
            throw new Error(`Execution Layer Error: ${error.message}`);
        }
    }

    // 2. Fallback for Local Development (Direct Request)
    const start = Date.now();
    const response = await axios({
        ...config,
        validateStatus: () => true,
    });

    return {
        status: response.status,
        data: response.data,
        headers: response.headers as Record<string, string>,
        latency: Date.now() - start,
    };
};
