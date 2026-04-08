import { Router } from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import { requireClient } from '../middlewares/clientMiddleware.js';
import { getMqlRules, scoreConversation, updateMqlRules } from '../controllers/mqlController.js';

const router = Router();

router.get('/rules', protect, requireClient, getMqlRules);
router.put('/rules', protect, requireClient, updateMqlRules);
router.post('/conversations/:id/score', protect, requireClient, scoreConversation);

export default router;

