/**
 * This is a user authentication API route demo.
 * Handle user registration, login, token management, etc.
 */
import { Router } from 'express';
import { register, login, getProfile } from '../controllers/authController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/profile', protect, getProfile);

export default router;
