import express from 'express';
import { getClients, createClient, updateClient, deleteClient } from '../controllers/clientController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.route('/')
  .get(protect, getClients)
  .post(protect, createClient);

router.route('/:id')
  .put(protect, updateClient)
  .delete(protect, deleteClient);

export default router;