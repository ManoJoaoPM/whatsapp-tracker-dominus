import { Router } from 'express';
import {
  handleEvolutionWebhook,
  handleWhatsAppCloudWebhook,
  verifyWhatsAppCloudWebhook,
} from '../controllers/webhookController.js';

const router = Router();

router.post('/evolution', handleEvolutionWebhook);
router.get('/whatsapp-cloud', verifyWhatsAppCloudWebhook);
router.post('/whatsapp-cloud', handleWhatsAppCloudWebhook);

export default router;
