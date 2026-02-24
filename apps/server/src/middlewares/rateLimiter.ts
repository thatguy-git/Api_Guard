import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createRedisConnection } from '../lib/redis.js';

// Reuse your existing Redis connection logic
const redisClient = createRedisConnection();

const customRedisCommand = async (...args: string[]): Promise<any> => {
    const [command, ...rest] = args;
    // Cast the result to 'any' so it satisfies rate-limit-redis's strict RedisReply type
    return (await redisClient.call(command, ...rest)) as any;
};

// 1. Strict Limiter: For creating new test runs (POST /api/tests)
export const testCreationLimiter = rateLimit({
    // Use Redis to store the request counts
    store: new RedisStore({
        sendCommand: customRedisCommand,
    }),
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        console.warn(
            `🛑 Rate Limit Exceeded: ${req.ip} tried to run too many tests.`,
        );
        res.status(429).json({
            error: 'Too Many Requests',
            message:
                'You have exceeded your testing quota (10 tests per 15 minutes). Please try again later.',
        });
    },
});

// 2. Standard Limiter: For generic API endpoints (GET /api/tests/:id)
export const generalApiLimiter = rateLimit({
    store: new RedisStore({
        sendCommand: customRedisCommand,
    }),
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // Limit each IP to 60 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.status(429).json({
            error: 'Too Many Requests',
            message: 'You are polling the API too fast. Slow down.',
        });
    },
});
