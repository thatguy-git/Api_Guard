import { Queue } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';

// Connect to Redis (Make sure Docker is running!)
const connection = createRedisConnection();

// Create the Queue
export const testQueue = new Queue('test-execution-queue', { connection });

// Define what a "Job" looks like
export interface TestJobData {
    testRunId: string; // The ID in Postgres
    config: {
        testType: 'IDEMPOTENCY' | 'RACE_CONDITION';
        url: string;
        method: 'POST' | 'PUT' | 'DELETE' | 'PATCH';
        headers?: Record<string, string>;
        body?: any;
    };
}
