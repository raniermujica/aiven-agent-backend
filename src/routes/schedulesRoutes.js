import express from 'express';
import {
  getSchedulesConfig,
  updateSchedulesConfig,
  checkRestaurantOpen,
} from '../controllers/schedulesController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { loadBusinessFromSlug, validateBusinessAccess } from '../middleware/tenant.js';

const router = express.Router();

router.use(authenticateToken);
router.use(loadBusinessFromSlug);
router.use(validateBusinessAccess);

// GET /api/schedules
router.get('/', getSchedulesConfig);

// PUT /api/schedules
router.put('/', requireRole('ADMIN', 'MANAGER'), updateSchedulesConfig);

// GET /api/schedules/check-open?date=2025-01-01&time=14:00
router.get('/check-open', checkRestaurantOpen);

export default router;