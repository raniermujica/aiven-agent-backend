import express from 'express';
import {
  getWaitlist,
  addToWaitlist,
  updateWaitlistStatus,
  getWaitlistStats,
} from '../controllers/waitlistController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { loadBusinessFromSlug, validateBusinessAccess } from '../middleware/tenant.js';

const router = express.Router();

router.use(authenticateToken);
router.use(loadBusinessFromSlug);
router.use(validateBusinessAccess);

// GET /api/waitlist
router.get('/', getWaitlist);

// GET /api/waitlist/stats
router.get('/stats', getWaitlistStats);

// POST /api/waitlist
router.post('/', requireRole('ADMIN', 'MANAGER', 'STAFF'), addToWaitlist);

// PATCH /api/waitlist/:entryId/status
router.patch('/:entryId/status', requireRole('ADMIN', 'MANAGER', 'STAFF'), updateWaitlistStatus);

export default router;