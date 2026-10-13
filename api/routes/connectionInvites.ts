import { Router } from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import { requireClient } from '../middlewares/clientMiddleware.js';
import {
  createConnectionInvite,
  deleteConnectionInvite,
  listConnectionInvites,
} from '../controllers/connectionInviteController.js';

const router = Router();

router.get('/', protect, requireClient, listConnectionInvites);
router.post('/', protect, requireClient, createConnectionInvite);
router.delete('/:id', protect, requireClient, deleteConnectionInvite);

export default router;
