import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createRedisConnection } from '../lib/redis.js';
import { Request } from 'express';

const redisClient = createRedisConnection();

const customRedisCommand = async (...args: string[]): Promise<any> => {
    const [command, ...rest] = args;
    return (await redisClient.call(command, ...rest)) as any;
};

// 1. Strict Limiter: For creating new test runs (POST /api/tests)
export const testCreationLimiter = rateLimit({
    store: new RedisStore({
        sendCommand: customRedisCommand,
    }),
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyGenerator: (req: Request): string => {
        if (typeof req.userId === 'string') {
            return req.userId;
        }

        return req.ip ?? req.socket.remoteAddress ?? 'anonymous';
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.warn(
            `Rate Limit Exceeded: ${req.ip} tried to run too many tests.`,
        );
        res.status(429).json({
            error: 'Too Many Requests',
            message:
                'You have exceeded your testing quota. Please try again later.',
        });
    },
});

// 2. Standard Limiter: For generic API endpoints (GET /api/tests/:id)
export const generalApiLimiter = rateLimit({
    store: new RedisStore({
        sendCommand: customRedisCommand,
    }),
    windowMs: 1 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
        res.status(429).json({
            error: 'Too Many Requests',
            message: 'You are polling the API too fast. Slow down.',
        });
    },
});
