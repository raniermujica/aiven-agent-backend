import express from 'express';
import {
  getSettings,
  updateSettings,
  getBusinessUsers,
  createBusinessUser,
  updateBusinessUser,
  deleteBusinessUser,
  getBusinessHours,      
  updateBusinessHours, 
} from '../controllers/settingsController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { loadBusinessFromSlug, validateBusinessAccess } from '../middleware/tenant.js';

const router = express.Router();

// Middleware de autenticación y tenant
router.use(authenticateToken);
router.use(loadBusinessFromSlug);
router.use(validateBusinessAccess);

// Solo ADMIN puede acceder a settings
router.use(requireRole('ADMIN'));

// GET /api/settings
router.get('/', getSettings);

// PATCH /api/settings
router.patch('/', updateSettings);

// GET /api/settings/users
router.get('/users', getBusinessUsers);

// POST /api/settings/users
router.post('/users', createBusinessUser);

// PATCH /api/settings/users/:userId
router.patch('/users/:userId', updateBusinessUser);

// DELETE /api/settings/users/:userId
router.delete('/users/:userId', deleteBusinessUser);

// GET /api/settings/hours
router.get('/hours', getBusinessHours);

// POST /api/settings/hours
router.post('/hours', updateBusinessHours);

export default router;