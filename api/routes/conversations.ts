import { Router } from 'express';
import { getConversations, getMessages, sendMessage, updateFunnelStage } from '../controllers/conversationController.js';
import { protect } from '../middlewares/authMiddleware.js';
import { requireClient } from '../middlewares/clientMiddleware.js';

const router = Router();

router.get('/', protect, requireClient, getConversations);
router.get('/:id/messages', protect, requireClient, getMessages);
router.post('/:id/messages', protect, requireClient, sendMessage);
router.put('/:id/stage', protect, requireClient, updateFunnelStage);

export default router;