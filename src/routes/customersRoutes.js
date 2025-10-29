import express from 'express';
import {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  toggleVipStatus,
  getCustomerStats,
  getCustomerProfile, 
} from '../controllers/customersController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { loadBusinessFromSlug, validateBusinessAccess } from '../middleware/tenant.js';

const router = express.Router();

// Todas las rutas requieren autenticación + acceso al negocio
router.use(authenticateToken);
router.use(loadBusinessFromSlug);
router.use(validateBusinessAccess);

// GET /api/customers
router.get('/', getCustomers);

// GET /api/customers/stats
router.get('/stats', getCustomerStats);

// GET /api/customers/:customerId/profile
router.get('/:customerId/profile', getCustomerProfile);

// GET /api/customers/:customerId
router.get('/:customerId', getCustomer);

// POST /api/customers
router.post('/', requireRole('ADMIN', 'MANAGER', 'STAFF'), createCustomer);

// PATCH /api/customers/:customerId
router.patch('/:customerId', requireRole('ADMIN', 'MANAGER', 'STAFF'), updateCustomer);

// PATCH /api/customers/:customerId/vip
router.patch('/:customerId/vip', requireRole('ADMIN', 'MANAGER'), toggleVipStatus);

// DELETE /api/customers/:customerId
router.delete('/:customerId', requireRole('ADMIN', 'MANAGER'), deleteCustomer);

export default router;