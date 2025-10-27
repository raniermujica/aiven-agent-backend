import express from 'express';
import {
  getOverviewStats,
  getAppointmentsByStatus,
  getTopServices,
  getAppointmentsTimeline,
  getRevenueStats,
} from '../controllers/analyticsController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { loadBusinessFromSlug, validateBusinessAccess } from '../middleware/tenant.js';

const router = express.Router();

// Todas las rutas requieren autenticación + acceso al negocio
router.use(authenticateToken);
router.use(loadBusinessFromSlug);
router.use(validateBusinessAccess);

// GET /api/analytics/overview
router.get('/overview', getOverviewStats);

// GET /api/analytics/appointments-by-status
router.get('/appointments-by-status', getAppointmentsByStatus);

// GET /api/analytics/top-services
router.get('/top-services', getTopServices);

// GET /api/analytics/timeline
router.get('/timeline', getAppointmentsTimeline);

// GET /api/analytics/revenue
router.get('/revenue', requireRole('ADMIN', 'MANAGER'), getRevenueStats);

export default router;