import { z } from 'zod';

export const SniperRequestSchema = z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
    url: z.url(),
    headers: z.record(z.string()).optional(),
    data: z.any().optional(),
});

export type SniperRequest = z.infer<typeof SniperRequestSchema>;

export interface SniperResponse {
    status: number;
    data: any;
    latency: number;
    headers: Record<string, string | string[] | undefined>;
}
