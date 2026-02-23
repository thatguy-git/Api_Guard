import { Router } from 'express';
import { createTestRun } from '../controllers/test.controller.js';
import { ssrfProtection } from '../middlewares/ssrfGuard.js';

const router = Router();

router.post('/', ssrfProtection, createTestRun);

export default router;
