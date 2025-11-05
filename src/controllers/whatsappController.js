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
    
    const exists = await evolutionService.instanceExists(businessSlug);
    
    if (exists) {
      console.log(`[WhatsApp] Instancia ${businessSlug} ya existe. Verificando estado.`);
      const status = await evolutionService.getConnectionStatus(businessSlug);
      
      if (status.isConnected) {
        console.log(`[WhatsApp] Instancia ${businessSlug} ya está conectada.`);
        return res.json({
          success: true,
          message: 'WhatsApp ya está conectado',
          isConnected: true
        });
      } else {
        console.log(`[WhatsApp] Instancia ${businessSlug} existe pero está desconectada. Obteniendo QR.`);
        const qr = await evolutionService.getQRCode(businessSlug);
        
        if (!qr.qrCode) {
           console.warn('[WhatsApp] getQRCode no devolvió un QR. La instancia puede estar "connecting".');
           return res.json({
              success: true,
              message: 'La instancia está conectando. Espera un momento y refresca el estado.',
              isConnecting: true,
              qrCode: null
           });
        }

        return res.json({
          success: true,
          qrCode: qr.qrCode,
          message: 'Escanea el código QR con WhatsApp Business',
          existingInstance: true
        });
      }
    }
    
    // 3. Si no existe, crearla
    console.log(`[WhatsApp] Instancia ${businessSlug} no existe. Creando...`);
    
    const instance = await evolutionService.createInstance(businessSlug);
    
    console.log('[WhatsApp] Esperando a que la instancia esté lista...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('[WhatsApp] Configurando webhook en segundo plano...');
    evolutionService.setWebhook(businessSlug).catch(err => {
      console.error(`[WhatsApp] Error grave configurando webhook en segundo plano: ${err.message}`);
    });
    
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
    
    return res.json({
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
    
    // 1. Obtener estado básico (como antes)
    const status = await evolutionService.getConnectionStatus(businessSlug);
    
    let details = {
      instanceName: businessSlug, // Devolver el slug como nombre por defecto
      phoneNumber: null 
    };

    // 2. Si está conectado, obtener más detalles
    if (status.isConnected) {
      const instanceDetails = await evolutionService.getInstanceDetails(businessSlug);
      if (instanceDetails) {
        details.phoneNumber = instanceDetails.phoneNumber;
        details.instanceName = instanceDetails.instanceName; // Actualizar con el nombre real
      }
    }
    
    // 3. Enviar respuesta combinada al frontend
    res.json({
      success: true,
      ...status,  // Esto incluye { isConnected, state }
      ...details // Esto incluye { instanceName, phoneNumber }
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