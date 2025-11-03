import evolutionService from '../services/evolutionService.js';
import { supabase } from '../config/database.js';

/**
 * Inicializar conexión de WhatsApp
 * POST /api/whatsapp/initialize
 */
export async function initializeWhatsApp(req, res) {
  try {
    const businessId = req.business.id;
    const businessSlug = req.business.slug;
    
    console.log(`[WhatsApp] Inicializando para: ${businessSlug}`);
    
    // Verificar si la instancia ya existe
    const exists = await evolutionService.instanceExists(businessSlug);
    
    if (exists) {
      console.log(`[WhatsApp] Instancia ya existe, obteniendo QR`);
      // Si existe, solo obtener el QR
      const qr = await evolutionService.getQRCode(businessSlug);
      
      return res.json({
        success: true,
        qrCode: qr.qrCode,
        message: 'Escanea el código QR con WhatsApp Business'
      });
    }
    
    // 1. Crear instancia en Evolution API
    const instance = await evolutionService.createInstance(businessSlug);
    
    // 2. Configurar webhook
    await evolutionService.setWebhook(businessSlug);
    
    // 3. Guardar en BD que la integración está activa
    const { error } = await supabase
      .from('restaurant_integrations')
      .upsert({
        restaurant_id: businessId,
        integration_type: 'whatsapp_business',
        is_enabled: true,
        config: {
          instance_name: businessSlug,
          created_at: new Date().toISOString()
        }
      }, {
        onConflict: 'restaurant_id,integration_type'
      });
    
    if (error) {
      console.error('[WhatsApp] Error guardando en BD:', error);
    }
    
    res.json({
      success: true,
      qrCode: instance.qrCode,
      message: 'Escanea el código QR con WhatsApp Business'
    });
    
  } catch (error) {
    console.error('[WhatsApp] Error en initializeWhatsApp:', error);
    res.status(500).json({ 
      error: 'Error al inicializar WhatsApp',
      details: error.message 
    });
  }
}

/**
 * Obtener estado de conexión
 * GET /api/whatsapp/status
 */
export async function getConnectionStatus(req, res) {
  try {
    const businessSlug = req.business.slug;
    
    const status = await evolutionService.getConnectionStatus(businessSlug);
    
    res.json({
      success: true,
      ...status
    });
    
  } catch (error) {
    console.error('[WhatsApp] Error obteniendo estado:', error);
    res.status(500).json({ error: 'Error al verificar conexión' });
  }
}

/**
 * Obtener nuevo QR code
 * POST /api/whatsapp/refresh-qr
 */
export async function refreshQRCode(req, res) {
  try {
    const businessSlug = req.business.slug;
    
    const qr = await evolutionService.getQRCode(businessSlug);
    
    res.json({
      success: true,
      qrCode: qr.qrCode
    });
    
  } catch (error) {
    console.error('[WhatsApp] Error obteniendo QR:', error);
    res.status(500).json({ error: 'Error al generar código QR' });
  }
}

/**
 * Desconectar WhatsApp
 * POST /api/whatsapp/disconnect
 */
export async function disconnectWhatsApp(req, res) {
  try {
    const businessId = req.business.id;
    const businessSlug = req.business.slug;
    
    await evolutionService.logout(businessSlug);
    
    // Actualizar BD
    await supabase
      .from('restaurant_integrations')
      .update({ is_enabled: false })
      .eq('restaurant_id', businessId)
      .eq('integration_type', 'whatsapp_business');
    
    res.json({
      success: true,
      message: 'WhatsApp desconectado correctamente'
    });
    
  } catch (error) {
    console.error('[WhatsApp] Error desconectando:', error);
    res.status(500).json({ error: 'Error al desconectar WhatsApp' });
  }
}

/**
 * Eliminar instancia completamente
 * DELETE /api/whatsapp/delete
 */
export async function deleteWhatsAppInstance(req, res) {
  try {
    const businessId = req.business.id;
    const businessSlug = req.business.slug;
    
    await evolutionService.deleteInstance(businessSlug);
    
    // Eliminar de BD
    await supabase
      .from('restaurant_integrations')
      .delete()
      .eq('restaurant_id', businessId)
      .eq('integration_type', 'whatsapp_business');
    
    res.json({
      success: true,
      message: 'Instancia de WhatsApp eliminada completamente'
    });
    
  } catch (error) {
    console.error('[WhatsApp] Error eliminando instancia:', error);
    res.status(500).json({ error: 'Error al eliminar instancia' });
  }
};