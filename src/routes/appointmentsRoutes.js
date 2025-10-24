import express from 'express';
import {
  getAppointments,
  getTodayAppointments,
  createAppointment,
  updateAppointmentStatus,
  deleteAppointment,
  getAppointmentStats,
} from '../controllers/appointmentsController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { loadBusinessFromSlug, validateBusinessAccess } from '../middleware/tenant.js';

const router = express.Router();

// Todas las rutas requieren autenticación + acceso al negocio
router.use(authenticateToken);
router.use(loadBusinessFromSlug);
router.use(validateBusinessAccess);

// GET /api/appointments
router.get('/', getAppointments);

// GET /api/appointments/today
router.get('/today', getTodayAppointments);

// GET /api/appointments/stats
router.get('/stats', getAppointmentStats);

// POST /api/appointments
router.post('/', requireRole('ADMIN', 'MANAGER', 'STAFF'), createAppointment);

// PATCH /api/appointments/:appointmentId/status
router.patch('/:appointmentId/status', requireRole('ADMIN', 'MANAGER', 'STAFF'), updateAppointmentStatus);

// DELETE /api/appointments/:appointmentId
router.delete('/:appointmentId', requireRole('ADMIN', 'MANAGER', 'STAFF'), deleteAppointment);

export default router;