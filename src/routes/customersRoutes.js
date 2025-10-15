import express from 'express';
import {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  getCustomerStats,
} from '../controllers/customersController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { loadBusinessFromSlug, validateBusinessAccess } from '../middleware/tenant.js';

const router = express.Router();

// Autenticación + tenant
router.use(authenticateToken);
router.use(loadBusinessFromSlug);
router.use(validateBusinessAccess);

// GET /api/customers
router.get('/', getCustomers);

// GET /api/customers/stats
router.get('/stats', getCustomerStats);

// GET /api/customers/:customerId
router.get('/:customerId', getCustomer);

// POST /api/customers
router.post('/', requireRole('ADMIN', 'MANAGER'), createCustomer);

// PATCH /api/customers/:customerId
router.patch('/:customerId', requireRole('ADMIN', 'MANAGER'), updateCustomer);

export default router;