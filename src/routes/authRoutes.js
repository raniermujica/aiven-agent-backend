import express from 'express';
import { login, getMe } from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// POST /api/auth/login
router.post('/login', login);

// GET /api/auth/me
router.get('/me', authenticateToken, getMe);

export default router;