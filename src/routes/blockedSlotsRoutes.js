import express from 'express';
import {
  getBlockedSlots,
  createBlockedSlot,
  updateBlockedSlot,
  deleteBlockedSlot,
  checkBlocked, 
} from '../controllers/blockedSlotsController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { loadBusinessFromSlug, validateBusinessAccess } from '../middleware/tenant.js';

const router = express.Router();

router.use(authenticateToken);
router.use(loadBusinessFromSlug);
router.use(validateBusinessAccess);

router.get('/', getBlockedSlots);
router.post('/', requireRole('ADMIN'), createBlockedSlot);
router.post('/check', checkBlocked); 
router.patch('/:blockId', requireRole('ADMIN'), updateBlockedSlot);
router.delete('/:blockId', requireRole('ADMIN'), deleteBlockedSlot);

export default router;