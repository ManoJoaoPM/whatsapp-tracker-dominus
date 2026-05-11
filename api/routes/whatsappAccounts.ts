import { Router } from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import { requireClient } from '../middlewares/clientMiddleware.js';
import {
  createWhatsAppAccount,
  disconnectWhatsAppAccount,
  getWhatsAppAccountStatus,
  listWhatsAppAccounts,
  refreshWhatsAppAccountQr,
} from '../controllers/whatsappAccountsController.js';

const router = Router();

router.get('/', protect, requireClient, listWhatsAppAccounts);
router.post('/', protect, requireClient, createWhatsAppAccount);
router.get('/:id/status', protect, requireClient, getWhatsAppAccountStatus);
router.post('/:id/refresh-qr', protect, requireClient, refreshWhatsAppAccountQr);
router.post('/:id/disconnect', protect, requireClient, disconnectWhatsAppAccount);

export default router;

