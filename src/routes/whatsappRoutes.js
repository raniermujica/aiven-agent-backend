import express from 'express';
import { 
  initializeWhatsApp, 
  getConnectionStatus, 
  refreshQRCode,
  disconnectWhatsApp,
  deleteWhatsAppInstance
} from '../controllers/whatsappController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

// Middleware para establecer req.business desde el usuario autenticado
router.use((req, res, next) => {
  if (!req.user || !req.user.restaurants) {
    return res.status(400).json({ error: 'No se pudo identificar el negocio del usuario' });
  }
  
  // El usuario ya tiene el restaurant cargado desde authenticateToken
  req.business = req.user.restaurants;
  next();
});

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