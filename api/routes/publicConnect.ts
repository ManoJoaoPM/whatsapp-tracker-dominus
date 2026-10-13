import { Router } from 'express';
import { rateLimit } from '../middlewares/rateLimit.js';
import {
  getConnectionStatus,
  getInviteInfo,
  requestPairing,
  startConnection,
} from '../controllers/publicConnectController.js';

/**
 * Public routes of the customer connection link. No login: every route is limited per IP and per
 * link, and the token has 256 bits, so guessing one is not feasible.
 */
const router = Router();

const MINUTE = 60_000;

const perToken = (name: string, max: number) =>
  rateLimit({ windowMs: MINUTE, max, key: (req) => `${name}:${String(req.params.token)}` });

router.use(rateLimit({ windowMs: MINUTE, max: 300 }));

router.get('/:token', perToken('info', 60), getInviteInfo);
router.get('/:token/status', perToken('status', 90), getConnectionStatus);
router.post('/:token/start', perToken('start', 12), startConnection);
router.post('/:token/pairing', perToken('pairing', 8), requestPairing);

export default router;
