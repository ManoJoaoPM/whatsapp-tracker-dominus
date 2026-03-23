import express from 'express';
import { getClients, createClient } from '../controllers/adminController.js';
import { protect, admin } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.route('/clients')
  .get(protect, admin, getClients)
  .post(protect, admin, createClient);

export default router;