import express from 'express';
import {
  getAppointments,
  getTodayAppointments,
  createAppointment,
  updateAppointmentStatus,
  deleteAppointment,
  getAppointmentStats,
  checkAvailability,
  getAppointmentById,
  updateAppointment,
  checkInAppointment,   
  checkOutAppointment 
} from '../controllers/appointmentsController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { loadBusinessFromSlug, validateBusinessAccess } from '../middleware/tenant.js';
import { authenticateAgent } from '../middleware/authAgent.js';

const router = express.Router();

router.post(
  '/agent/check-availability',
  loadBusinessFromSlug,   
  authenticateAgent, 
  checkAvailability 
);

router.post(
  '/agent/create',
  loadBusinessFromSlug,
  authenticateAgent,
  createAppointment
);

router.use(authenticateToken);
router.use(loadBusinessFromSlug);
router.use(validateBusinessAccess);

// GET /api/appointments
router.get('/', getAppointments);

// GET /api/appointments/today
router.get('/today', getTodayAppointments);

// GET /api/appointments/stats
router.get('/stats', getAppointmentStats);

// GET /api/appointments/:appointmentId/details
router.get('/:appointmentId/details', getAppointmentById);

// POST /api/appointments/check-availability (Usado por el modal del Panel)
router.post('/check-availability', checkAvailability);

// POST /api/appointments (Usado por el modal del Panel)
router.post('/', requireRole('ADMIN', 'MANAGER', 'STAFF'), createAppointment);

// POST /api/appointments/:appointmentId/check-in
router.post('/:appointmentId/check-in', requireRole('ADMIN', 'MANAGER', 'STAFF'), checkInAppointment);

// POST /api/appointments/:appointmentId/check-out
router.post('/:appointmentId/check-out', requireRole('ADMIN', 'MANAGER', 'STAFF'), checkOutAppointment);

// PATCH /api/appointments/:appointmentId/status
router.patch('/:appointmentId/status', requireRole('ADMIN', 'MANAGER', 'STAFF'), updateAppointmentStatus);

// PATCH /api/appointments/:appointmentId
router.patch('/:appointmentId', requireRole('ADMIN', 'MANAGER', 'STAFF'), updateAppointment);

// DELETE /api/appointments/:appointmentId
router.delete('/:appointmentId', requireRole('ADMIN', 'MANAGER', 'STAFF'), deleteAppointment);

export default router;