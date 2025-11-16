import express from 'express';
import { 
  sendConfirmationEmail,
  sendPendingReminders
} from '../controllers/emailController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Enviar confirmación de cita (no requiere autenticación)
router.post('/send-confirmation/:appointmentId', sendConfirmationEmail);

// Enviar recordatorios pendientes (cron job - sin auth para permitir servicios externos)
// TODO: Agregar API key secret para proteger este endpoint
router.post('/send-reminders', sendPendingReminders);

export default router;