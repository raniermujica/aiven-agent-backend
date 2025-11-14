import express from 'express';
import { sendContactForm } from '../controllers/contactController.js';

const router = express.Router();

// Ruta pública (sin autenticación)
router.post('/demo', sendContactForm);

export default router;