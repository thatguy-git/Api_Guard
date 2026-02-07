import { Request, Response } from 'express';
import { testQueue } from '../workers/queue.js';
import { RunTestSchema } from '../zod/schemas.js';
import { prisma } from '../lib/prisma.js';

export const createTestRun = async (req: Request, res: Response) => {
    try {
        // 1. Validate Request
        const data = RunTestSchema.parse(req.body);

        // 2. Create DB Record (Pending)
        const testRun = await prisma.testRun.create({
            data: {
                testType: data.testType,
                endpoint: data.endpoint,
                method: data.method,
                status: 'PENDING',
                resultSummary: {},
            },
        });

        // 3. Add to Queue
        await testQueue.add('execute-test', {
            testRunId: testRun.id,
            config: {
                testType: data.testType,
                url: data.endpoint,
                method: data.method,
                headers: data.headers,
                body: data.body,
            },
        });

        console.log(`🚀 Accepted Test Run: ${testRun.id}`);

        // 4. Return ID to user
        res.status(202).json({
            status: 'queued',
            testRunId: testRun.id,
        });
    } catch (error: any) {
        console.error(error);
        res.status(400).json({ error: 'Invalid Request', details: error });
    }
};
