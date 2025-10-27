import express from 'express';
import {
  getServices,
  getService,
  createService,
  updateService,
  deleteService,
} from '../controllers/servicesController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { loadBusinessFromSlug, validateBusinessAccess } from '../middleware/tenant.js';

const router = express.Router();

// Todas las rutas requieren autenticación + acceso al negocio
router.use(authenticateToken);
router.use(loadBusinessFromSlug);
router.use(validateBusinessAccess);

// GET /api/services
router.get('/', getServices);

// GET /api/services/:serviceId
router.get('/:serviceId', getService);

// POST /api/services
router.post('/', requireRole('ADMIN', 'MANAGER'), createService);

// PATCH /api/services/:serviceId
router.patch('/:serviceId', requireRole('ADMIN', 'MANAGER'), updateService);

// DELETE /api/services/:serviceId
router.delete('/:serviceId', requireRole('ADMIN', 'MANAGER'), deleteService);

export default router;