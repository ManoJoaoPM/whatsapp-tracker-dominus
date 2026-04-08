import { Router } from 'express';
import {
  getConversationById,
  getConversations,
  getKanban,
  getMessages,
  sendMessage,
  updateFunnelStage,
} from '../controllers/conversationController.js';
import { protect } from '../middlewares/authMiddleware.js';
import { requireClient } from '../middlewares/clientMiddleware.js';

const router = Router();

router.get('/', protect, requireClient, getConversations);
router.get('/kanban', protect, requireClient, getKanban);
router.get('/:id', protect, requireClient, getConversationById);
router.get('/:id/messages', protect, requireClient, getMessages);
router.post('/:id/messages', protect, requireClient, sendMessage);
router.put('/:id/stage', protect, requireClient, updateFunnelStage);
router.patch('/:id/stage', protect, requireClient, updateFunnelStage);

export default router;
