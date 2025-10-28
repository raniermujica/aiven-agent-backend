import express from 'express';
import {
  getServices,
  createService,
  updateService,
  deleteService,
} from '../controllers/servicesController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { loadBusinessFromSlug, validateBusinessAccess } from '../middleware/tenant.js';

const router = express.Router();

// Middleware de autenticación y tenant
router.use(authenticateToken);
router.use(loadBusinessFromSlug);
router.use(validateBusinessAccess);

// GET /api/services - Todos pueden ver servicios
router.get('/', getServices);

// POST /api/services - Solo ADMIN puede crear
router.post('/', requireRole('ADMIN'), createService);

// PATCH /api/services/:serviceId - Solo ADMIN puede actualizar
router.patch('/:serviceId', requireRole('ADMIN'), updateService);

// DELETE /api/services/:serviceId - Solo ADMIN puede eliminar
router.delete('/:serviceId', requireRole('ADMIN'), deleteService);

export default router;