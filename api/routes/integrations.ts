import express from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import { requireClient } from '../middlewares/clientMiddleware.js';
import {
  getMetaAdsIntegration,
  updateMetaAdsIntegration,
  testMetaAdsEvent,
  getMetaLeadLogs,
  getMetaEventLogs,
  retryMetaEvent,
} from '../controllers/integrationsController.js';

const router = express.Router();

router.get('/meta', protect, requireClient, getMetaAdsIntegration);
router.put('/meta', protect, requireClient, updateMetaAdsIntegration);
router.post('/meta/test-event', protect, requireClient, testMetaAdsEvent);
router.get('/meta/logs', protect, requireClient, getMetaLeadLogs);
router.get('/meta/events', protect, requireClient, getMetaEventLogs);
router.post('/meta/events/:id/retry', protect, requireClient, retryMetaEvent);

export default router;
