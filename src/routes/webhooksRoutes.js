import express from 'express';
import {
  getBusinessConfig,
  getBusinessInfo,
  checkAvailability,
  createReservationFromWhatsApp,
  saveConversation
} from '../controllers/webhooksController.js';

const router = express.Router();

// ================================================================
// RUTAS PÚBLICAS (NO REQUIEREN JWT)
// Estas rutas son llamadas por N8N, no por el frontend
// ================================================================

// ⭐ NUEVO: Endpoint principal para obtener config completa
// GET /api/webhooks/n8n/business-config/:businessSlug
router.get('/n8n/business-config/:businessSlug', getBusinessConfig);

// Endpoint simplificado (compatibilidad)
// GET /api/webhooks/n8n/business/:businessSlug
router.get('/n8n/business/:businessSlug', getBusinessInfo);

// Verificar disponibilidad
// POST /api/webhooks/n8n/check-availability
router.post('/n8n/check-availability', checkAvailability);

// Crear reserva desde WhatsApp
// POST /api/webhooks/n8n/reservation
router.post('/n8n/reservation', createReservationFromWhatsApp);

// Guardar conversación
// POST /api/webhooks/n8n/conversation
router.post('/n8n/conversation', saveConversation);

export default router;