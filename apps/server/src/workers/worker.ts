import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '../lib/prisma.js';
import { runIdempotencyTest } from '../engine/runners/idempotency.js';
import { TestJobData } from './queue.js';
import { createRedisConnection } from '../lib/redis.js';

const connection = createRedisConnection();

export const worker = new Worker<TestJobData>(
    'test-execution-queue',
    async (job: Job<TestJobData>) => {
        console.log(
            `👷 Worker started job: ${job.id} (${job.data.config.testType})`,
        );

        const { testRunId, config } = job.data;

        try {
            // 1. Update DB to RUNNING
            await prisma.testRun.update({
                where: { id: testRunId },
                data: { status: 'RUNNING' },
            });

            let result;

            // 2. Select the correct runner
            if (config.testType === 'IDEMPOTENCY') {
                result = await runIdempotencyTest({
                    url: config.url,
                    method: config.method,
                    headers: config.headers,
                    body: config.body,
                });
            } else {
                throw new Error(
                    `Test type ${config.testType} not implemented yet`,
                );
            }

            // 3. Save Success to DB
            await prisma.testRun.update({
                where: { id: testRunId },
                data: {
                    status: 'COMPLETED',
                    verdict: result.verdict,
                    resultSummary: result as any, // Save the full JSON report
                    finishedAt: new Date(),
                },
            });

            console.log(`✅ Job ${job.id} finished: ${result.verdict}`);
        } catch (error: any) {
            console.error(`❌ Job ${job.id} failed:`, error);

            // Save Failure to DB
            await prisma.testRun.update({
                where: { id: testRunId },
                data: {
                    status: 'FAILED',
                    verdict: 'ERROR',
                    logs: { error: error.message },
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
