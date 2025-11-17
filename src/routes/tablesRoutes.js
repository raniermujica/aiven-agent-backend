import express from 'express';
import {
  getTables,
  createTable,
  updateTable,
  deleteTable,
  assignTable,
  getTableStatus,
  createTableAssignment
} from '../controllers/tablesController.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateBusinessAccess, loadBusinessFromSlug } from '../middleware/tenant.js';

const router = express.Router();

// Aplicar middlewares a todas las rutas
router.use(authenticateToken);           
router.use(loadBusinessFromSlug);        
router.use(validateBusinessAccess);

/**
 * @route   GET /api/tables
 * @desc    Obtener todas las mesas del restaurante
 * @access  Private (Admin, Manager, Staff)
 */
router.get('/', getTables);

/**
 * @route   POST /api/tables
 * @desc    Crear una nueva mesa
 * @access  Private (Admin, Manager)
 */
router.post('/', createTable);

/**
 * @route   PUT /api/tables/:id
 * @desc    Actualizar una mesa
 * @access  Private (Admin, Manager)
 */
router.put('/:id', updateTable);

/**
 * @route   DELETE /api/tables/:id
 * @desc    Eliminar una mesa (soft delete)
 * @access  Private (Admin)
 */
router.delete('/:id', deleteTable);

/**
 * @route   POST /api/tables/assign
 * @desc    Asignar automáticamente una mesa
 * @access  Private (Admin, Manager, Staff)
 */
router.post('/assign', assignTable);

/**
 * @route   GET /api/tables/status
 * @desc    Obtener estado de mesas para un día
 * @access  Private (Admin, Manager, Staff)
 */
router.get('/status', getTableStatus);

/**
 * @route   POST /api/tables/assignments
 * @desc    Crear asignación manual de mesa
 * @access  Private (Admin, Manager, Staff)
 */
router.post('/assignments', createTableAssignment);

export default router;