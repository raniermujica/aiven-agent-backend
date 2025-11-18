import express from 'express';
import {
  getTables,
  createTable,
  updateTable,
  deleteTable,
  assignTable,
  getTableStatus,
  createTableAssignment,
  getOccupancyByShift  // 🆕 NUEVO
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
 * @desc    Get all tables for the restaurant
 * @access  Private (Admin, Manager, Staff)
 */
router.get('/', getTables);

/**
 * @route   POST /api/tables
 * @desc    Create a new table
 * @access  Private (Admin, Manager)
 */
router.post('/', createTable);

/**
 * @route   PUT /api/tables/:id
 * @desc    Update a table
 * @access  Private (Admin, Manager)
 */
router.put('/:id', updateTable);

/**
 * @route   DELETE /api/tables/:id
 * @desc    Delete a table (soft delete)
 * @access  Private (Admin)
 */
router.delete('/:id', deleteTable);

/**
 * @route   POST /api/tables/assign
 * @desc    Automatically assign a table
 * @access  Private (Admin, Manager, Staff)
 */
router.post('/assign', assignTable);

/**
 * @route   GET /api/tables/status
 * @desc    Get table status for a specific day
 * @access  Private (Admin, Manager, Staff)
 */
router.get('/status', getTableStatus);

/**
 * @route   GET /api/tables/occupancy
 * @desc    Get table occupancy by shift (all day, lunch, dinner)
 * @query   date - Date in YYYY-MM-DD format
 * @access  Private (Admin, Manager, Staff)
 * @example GET /api/tables/occupancy?date=2025-01-18
 */
router.get('/occupancy', getOccupancyByShift);

/**
 * @route   POST /api/tables/assignments
 * @desc    Create manual table assignment
 * @access  Private (Admin, Manager, Staff)
 */
router.post('/assignments', createTableAssignment);

export default router;