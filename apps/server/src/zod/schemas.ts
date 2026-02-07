import { z } from 'zod';

export const RunTestSchema = z.object({
    projectId: z.string().optional(),
    testType: z.enum(['IDEMPOTENCY', 'RACE_CONDITION', 'RATE_LIMIT']),
    endpoint: z.string().url({ message: 'Invalid URL format' }),
    method: z.enum(['POST', 'PUT', 'DELETE', 'PATCH', 'GET']),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.any().optional(),
    expectedStatus: z.number().int().optional(),
});

export type RunTestInput = z.infer<typeof RunTestSchema>;
