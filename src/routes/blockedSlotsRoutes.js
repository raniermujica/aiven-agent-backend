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

// Aplicar autenticación y tenant a todas las rutas
router.use(authenticateToken);
router.use(loadBusinessFromSlug);
router.use(validateBusinessAccess);

// GET /api/blocked-slots - Obtener todos los bloqueos
router.get('/', getBlockedSlots);

// POST /api/blocked-slots - Crear nuevo bloqueo (solo ADMIN y MANAGER)
router.post('/', requireRole(['ADMIN', 'MANAGER']), createBlockedSlot);

// POST /api/blocked-slots/check - Verificar si hay bloqueo en fecha/hora
router.post('/check', checkBlocked); 

// PATCH /api/blocked-slots/:blockId - Actualizar bloqueo (solo ADMIN y MANAGER)
router.patch('/:blockId', requireRole(['ADMIN', 'MANAGER']), updateBlockedSlot);

// DELETE /api/blocked-slots/:blockId - Eliminar bloqueo (solo ADMIN y MANAGER)
router.delete('/:blockId', requireRole(['ADMIN', 'MANAGER']), deleteBlockedSlot);

export default router;