import { Router } from 'express';
import { createTestRun } from '../controllers/test.controller.js';

const router = Router();

router.post('/', createTestRun);

export default router;
