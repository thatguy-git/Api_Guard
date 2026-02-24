import { Router } from 'express';
import { createTestRun } from '../controllers/test.controller.js';
import { ssrfProtection } from '../middlewares/ssrfGuard.js';
import {
    testCreationLimiter,
    generalApiLimiter,
} from '../middlewares/rateLimiter.js';

const router = Router();

router.post('/', testCreationLimiter, ssrfProtection, createTestRun);

export default router;
