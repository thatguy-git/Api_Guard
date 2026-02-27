import { Router } from 'express';
import { createTestRun } from '../controllers/test.controller.js';
import { ssrfProtection } from '../middlewares/ssrfGuard.js';
import {
    testCreationLimiter,
    generalApiLimiter,
} from '../middlewares/rateLimiter.js';
import { authenticateSession } from '../middlewares/authGuard.js';

const router = Router();

router.post('/', authenticateSession, testCreationLimiter, createTestRun);

export default router;
