import { Router } from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import { requireClient } from '../middlewares/clientMiddleware.js';
import {
  getConversationEvaluations,
  getMqlConfig,
  getMqlRules,
  scoreConversation,
  updateMqlConfig,
  updateMqlRules,
} from '../controllers/mqlController.js';

const router = Router();

router.get('/config', protect, requireClient, getMqlConfig);
router.put('/config', protect, requireClient, updateMqlConfig);
router.get('/rules', protect, requireClient, getMqlRules);
router.put('/rules', protect, requireClient, updateMqlRules);
router.post('/conversations/:id/score', protect, requireClient, scoreConversation);
router.get('/conversations/:id/evaluations', protect, requireClient, getConversationEvaluations);

export default router;
