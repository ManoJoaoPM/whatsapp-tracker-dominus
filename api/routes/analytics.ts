import { Router } from 'express';
import { getAnalytics } from '../controllers/analyticsController.js';
import { protect } from '../middlewares/authMiddleware.js';
import { requireClient } from '../middlewares/clientMiddleware.js';

const router = Router();

router.get('/', protect, requireClient, getAnalytics);

export default router;