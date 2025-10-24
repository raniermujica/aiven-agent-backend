import express from 'express';
import {
  getReservations,
  getTodayReservations,
  createReservation,
  updateReservationStatus,
  getReservationStats,
  getCalendarReservations,
} from '../controllers/reservationsController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { loadBusinessFromSlug, validateBusinessAccess } from '../middleware/tenant.js';

const router = express.Router();

// Todas las rutas requieren autenticación + acceso al negocio
router.use(authenticateToken);
router.use(loadBusinessFromSlug);
router.use(validateBusinessAccess);

// GET /api/reservations
router.get('/', getReservations);

// GET /api/reservations/today
router.get('/today', getTodayReservations);

// GET /api/reservations/stats
router.get('/stats', getReservationStats);

// GET /api/reservations/calendar?startDate=2025-01-01&endDate=2025-01-31
router.get('/calendar', getCalendarReservations);

// POST /api/reservations
router.post('/', requireRole('ADMIN', 'MANAGER', 'STAFF'), createReservation);

// PATCH /api/reservations/:reservationId/status
router.patch('/:reservationId/status', requireRole('ADMIN', 'MANAGER', 'STAFF'), updateReservationStatus);
 

export default router;