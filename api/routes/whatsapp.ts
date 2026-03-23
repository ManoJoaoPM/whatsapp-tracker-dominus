import { Router } from 'express';
import { connectWhatsApp, getStatus, disconnectWhatsApp } from '../controllers/whatsappController.js';
import { protect } from '../middlewares/authMiddleware.js';
import { requireClient } from '../middlewares/clientMiddleware.js';

const router = Router();

router.post('/connect', protect, requireClient, connectWhatsApp);
router.get('/status', protect, requireClient, getStatus);
router.post('/disconnect', protect, requireClient, disconnectWhatsApp);

export default router;