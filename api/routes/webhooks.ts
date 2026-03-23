import { Router } from 'express';
import { handleEvolutionWebhook } from '../controllers/webhookController.js';

const router = Router();

router.post('/evolution', handleEvolutionWebhook);

export default router;