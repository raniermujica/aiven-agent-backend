import express from 'express';
import { createBusiness, listBusinesses, updateBusiness } from '../controllers/superAdminController.js';
import { authenticateToken, requireSuperAdmin } from '../middleware/auth.js';

const router = express.Router();

// Todas las rutas requieren autenticación + SuperAdmin
router.use(authenticateToken);
router.use(requireSuperAdmin);

// POST /api/superadmin/businesses
router.post('/businesses', createBusiness);

// GET /api/superadmin/businesses
router.get('/businesses', listBusinesses);

// PATCH /api/superadmin/businesses/:businessId
router.patch('/businesses/:businessId', updateBusiness);

export default router;