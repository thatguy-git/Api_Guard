import { Redis } from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
    throw new Error('REDIS_HOST and REDIS_PORT must be set');
}

export const createRedisConnection = () => {
    return new Redis({
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
        maxRetriesPerRequest: null, // BullMQ requirement
    });
};

export const redisConnection = createRedisConnection();
