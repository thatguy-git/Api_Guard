import { Request, Response } from 'express';
import { testQueue } from '../workers/queue.js';
import { RunTestSchema } from '../zod/schemas.js';
import { prisma } from '../lib/prisma.js';

export const createTestRun = async (req: Request, res: Response) => {
    try {
        // Validate Request
        const currentUser = req.ip;
        req.ips;
        const data = RunTestSchema.parse(req.body);

        //Create DB Record (Pending)
        const testRun = await prisma.testRun.create({
            data: {
                testType: data.testType,
                endpoint: data.endpoint,
                method: data.method,
                status: 'PENDING',
                resultSummary: {},
            },
        });

        // Add to Queue
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

        console.log(
            `Accepted Test Run: ${testRun.id} from user with the IP address: ${currentUser}`,
        );

        res.status(202).json({
            status: 'queued',
            testRunId: testRun.id,
        });
    } catch (error: unknown) {
        if (error instanceof Error && error !== null) {
            console.error(`Error creating test run: ${error.message}`);
            throw new Error('Error creating test run');
        }
    }
};
