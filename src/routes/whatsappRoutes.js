import express from 'express';
import { 
  initializeWhatsApp, 
  getConnectionStatus, 
  refreshQRCode,
  disconnectWhatsApp,
  deleteWhatsAppInstance
} from '../controllers/whatsappController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { getTenantContext } from '../middleware/tenantMiddleware.js';

const router = express.Router();

// Todas las rutas requieren autenticación y contexto de negocio
router.use(verifyToken);
router.use(getTenantContext);

// Inicializar conexión (obtener QR)
router.post('/initialize', initializeWhatsApp);

// Obtener estado de conexión
router.get('/status', getConnectionStatus);

// Refrescar QR code
router.post('/refresh-qr', refreshQRCode);

// Desconectar WhatsApp
router.post('/disconnect', disconnectWhatsApp);

// Eliminar instancia completamente
router.delete('/delete', deleteWhatsAppInstance);

export default router;