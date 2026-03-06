import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '../lib/prisma.js';
import { runIdempotencyTest } from '../engine/runners/idempotency.js';
import { runRaceConditionTest } from '../engine/runners/race-conditions.js';
import { runRateLimitTest } from '../engine/runners/rate-limiting.js';
import { runMassAssignmentTest } from '../engine/runners/mass-assignment.js';
import { runSlowlorisTest } from '../engine/runners/slowloris.js';
import { runBolaTest } from '../engine/runners/bola.js';
import { runSqliTest } from '../engine/runners/sqli.js';
import { TestJobData } from './queue.js';
import { createRedisConnection } from '../lib/redis.js';

const connection = createRedisConnection();

export const worker = new Worker<TestJobData>(
    'test-execution-queue',
    async (job: Job<TestJobData>) => {
        console.log(
            `Worker started job: ${job.id} (${job.data.config.testType})`,
        );

        const { testRunId, config } = job.data;

        try {
            await prisma.testRun.update({
                where: { id: testRunId },
                data: { status: 'RUNNING' },
            });

            let result;

            switch (config.testType) {
                case 'IDEMPOTENCY':
                    result = await runIdempotencyTest({
                        url: config.url,
                        method: config.method as any,
                        headers: config.headers,
                        body: config.body,
                    });
                    break;

                case 'RACE_CONDITION':
                    result = await runRaceConditionTest({
                        url: config.url,
                        method: config.method as any,
                        headers: config.headers,
                        body: config.body,
                    });
                    break;

                case 'RATE_LIMITING':
                    result = await runRateLimitTest({
                        url: config.url,
                        method: config.method as any,
                        headers: config.headers,
                        body: config.body,
                    });
                    break;

                case 'MASS_ASSIGNMENT':
                    result = await runMassAssignmentTest({
                        url: config.url,
                        method: config.method,
                        headers: config.headers,
                        body: config.body,
                    });
                    break;

                case 'SLOWLORIS':
                    result = await runSlowlorisTest({
                        url: config.url,
                        method: config.method,
                    });
                    break;

                case 'BOLA':
                    result = await runBolaTest({
                        url: config.url,
                        method: config.method,
                        headers: config.headers,
                        secondaryHeaders: config.secondaryHeaders,
                        body: config.body,
                    });
                    break;

                case 'SQLI':
                    result = await runSqliTest({
                        url: config.url,
                        method: config.method,
                        headers: config.headers,
                        body: config.body,
                    });
                    break;

                default:
                    throw new Error(`Unknown test type: ${config.testType}`);
            }

            await prisma.testRun.update({
                where: { id: testRunId },
                data: {
                    status: 'COMPLETED',
                    verdict: result.verdict,
                    resultSummary: result as any,
                    finishedAt: new Date(),
                },
            });

            console.log(`Job ${job.id} finished: ${result.verdict}`);
        } catch (error: unknown) {
            const errorMessage =
                error instanceof Error
                    ? error.message
                    : 'An unknown error occurred';
            console.error(`Job ${job.id} failed:`, errorMessage);

            await prisma.testRun.update({
                where: { id: testRunId },
                data: {
                    status: 'FAILED',
                    verdict: 'ERROR',
                    logs: { error: errorMessage },
                    finishedAt: new Date(),
                },
            });
        }
    },
    { connection },
);

worker.on('ready', () =>
    console.log('🚀 Worker is ready and listening for jobs...'),
);
worker.on('error', (err) => console.error('❌ Worker Error:', err));
worker.on('failed', (job, err) =>
    console.error(`❌ Job ${job?.id} failed with error:`, err),
);
worker.on('completed', (job) =>
    console.log(`✅ Job ${job?.id} completed successfully`),
);
