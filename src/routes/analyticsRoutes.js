import express from 'express';
import {
  getDashboardStats,
  getMonthlyStats,
  getTopCustomers,
} from '../controllers/analyticsController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { loadBusinessFromSlug, validateBusinessAccess } from '../middleware/tenant.js';

const router = express.Router();

router.use(authenticateToken);
router.use(loadBusinessFromSlug);
router.use(validateBusinessAccess);

// Solo ADMIN y MANAGER pueden ver analytics
router.use(requireRole('ADMIN', 'MANAGER'));

// GET /api/analytics/dashboard
router.get('/dashboard', getDashboardStats);

// GET /api/analytics/monthly
router.get('/monthly', getMonthlyStats);

// GET /api/analytics/top-customers
router.get('/top-customers', getTopCustomers);

export default router;