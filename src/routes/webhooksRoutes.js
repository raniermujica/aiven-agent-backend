import express from 'express';
import {
  handleReservationFromN8N,
  checkAvailability,
  saveConversation,
} from '../controllers/webhooksController.js';

const router = express.Router();

// POST /api/webhooks/n8n/reservation
router.post('/n8n/reservation', handleReservationFromN8N);

// POST /api/webhooks/n8n/check-availability
router.post('/n8n/check-availability', checkAvailability);

// POST /api/webhooks/n8n/conversation
router.post('/n8n/conversation', saveConversation);

export default router;