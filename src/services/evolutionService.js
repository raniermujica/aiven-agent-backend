import axios from 'axios';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'https://whatsapp-reservas-demo-evolution-api.wuqirc.easypanel.host';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '429683C4C977415CAAFCCE10F7D57E11';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://tu-n8n.com/webhook/agent-paul';

class EvolutionService {
  
  /**
   * Crear instancia para un negocio
   */
 async createInstance(businessSlug) {
    try {
      console.log(`[Evolution] Creando instancia: ${businessSlug}`);
      
      const response = await axios.post(
        `${EVOLUTION_API_URL}/instance/create`,
        {
          instanceName: businessSlug,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS'
        },
        {
          headers: {
            'apikey': EVOLUTION_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`[Evolution DEBUG] createInstance response para ${businessSlug}:`, JSON.stringify(response.data, null, 2));
      console.log(`[Evolution] Instancia creada: ${businessSlug}`);
      
      // La ruta correcta es response.data.qrcode.base64
      const qrCode = response.data.qrcode?.base64 || response.data.qrcode?.code;
  
      return {
        success: true,
        instanceName: businessSlug,
        qrCode: qrCode, 
        status: 'created'
      };
      
    } catch (error) {
      console.error('[Evolution] Error creando instancia:', error.response?.data || error.message);
      
      if (error.response?.status === 403 && error.response?.data?.response?.message?.[0]?.includes('already in use')) {
        const err = new Error('INSTANCE_EXISTS');
        err.instanceName = businessSlug;
        throw err;
      }
      
      throw new Error('No se pudo crear la instancia de WhatsApp');
    }
  }
  
  /**
   * Configurar webhook para la instancia
   */
async setWebhook(businessSlug, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        console.log(`[Evolution] Configurando webhook para: ${businessSlug} (intento ${attempt}/${retries})`);
        
        // Esperar 2 segundos antes de configurar
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await axios.post(
          `${EVOLUTION_API_URL}/webhook/set/${businessSlug}`,
          {
            webhook: {
              url: N8N_WEBHOOK_URL,
              enabled: true,
              events: ['MESSAGES_UPSERT'] 
            },    
            webhook_by_events: false, 
            webhook_base64: false
          },
          {
            headers: {
              'apikey': EVOLUTION_API_KEY,
              'Content-Type': 'application/json'
            }
          }
        );
        
        console.log(`[Evolution] Webhook configurado: ${businessSlug}`);
        
        return { success: true };
        
      } catch (error) {
        console.error(`[Evolution] Error configurando webhook (intento ${attempt}):`, error.response?.data || error.message);
        
        if (attempt === retries) {
          console.error('[Evolution] Error detallado del webhook:', JSON.stringify(error.response?.data, null, 2));
          throw new Error(`No se pudo configurar el webhook después de ${retries} intentos`);
        }
        
        console.log(`[Evolution] Reintentando en 3 segundos...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }
  
  /**
   * Obtener estado de conexión de la instancia
   */
  async getConnectionStatus(businessSlug) {
    try {
      const response = await axios.get(
        `${EVOLUTION_API_URL}/instance/connectionState/${businessSlug}`,
        {
          headers: {
            'apikey': EVOLUTION_API_KEY
          }
        }
      );

      console.log(`[Evolution DEBUG] connectionState para ${businessSlug}:`, JSON.stringify(response.data, null, 2));

      const state = response.data.instance?.state;
      
      return {
        state: state, // 'open', 'close', 'connecting'
        isConnected: state === 'open'
      };
      
    } catch (error) {
      console.error('[Evolution] Error obteniendo estado:', error.response?.data || error.message);
      return { state: 'disconnected', isConnected: false };
    }
  }
  
  /**
   * Obtener QR code para reconexión
   */
 async getQRCode(businessSlug) {
    try {
      console.log(`[Evolution] Obteniendo QR para: ${businessSlug}`);
      
      const response = await axios.get(
        `${EVOLUTION_API_URL}/instance/connect/${businessSlug}`,
        {
          headers: {
            'apikey': EVOLUTION_API_KEY
          }
        }
      );
      
      // DEBUG LOG (puedes quitarlo después)
      console.log('[Evolution DEBUG] getQRCode response:', JSON.stringify(response.data, null, 2));
      
      // --- CORRECCIÓN AQUÍ ---
      // La API devuelve "base64" en la raíz, no dentro de "qrcode"
      const qrCode = response.data.base64 || response.data.code;
      // --- FIN DE CORRECCIÓN ---
      
      return {
        success: true,
        qrCode: qrCode 
      };
      
    } catch (error) {
      console.error('[Evolution] Error obteniendo QR:', error.response?.data || error.message);
      throw new Error('No se pudo generar el código QR');
    }
  }
  
  /**
   * Desconectar instancia (logout)
   */
  async logout(businessSlug) {
    try {
      console.log(`[Evolution] Desconectando: ${businessSlug}`);
      
      await axios.delete(
        `${EVOLUTION_API_URL}/instance/logout/${businessSlug}`,
        {
          headers: {
            'apikey': EVOLUTION_API_KEY
          }
        }
      );
      
      console.log(`[Evolution] Desconectado: ${businessSlug}`);
      
      return { success: true };
      
    } catch (error) {
      console.error('[Evolution] Error desconectando:', error.response?.data || error.message);
      throw new Error('No se pudo desconectar WhatsApp');
    }
  }
  
  /**
   * Eliminar instancia completamente
   */
  async deleteInstance(businessSlug) {
    try {
      console.log(`[Evolution] Eliminando instancia: ${businessSlug}`);
      
      await axios.delete(
        `${EVOLUTION_API_URL}/instance/delete/${businessSlug}`,
        {
          headers: {
            'apikey': EVOLUTION_API_KEY
          }
        }
      );
      
      console.log(`[Evolution] Instancia eliminada: ${businessSlug}`);
      
      return { success: true };
      
    } catch (error) {
      console.error('[Evolution] Error eliminando instancia:', error.response?.data || error.message);
      throw new Error('No se pudo eliminar la instancia');
    }
  }
  
  /**
   * Verificar si la instancia existe
   */
  async instanceExists(businessSlug) {
    try {
      const response = await axios.get(
        `${EVOLUTION_API_URL}/instance/fetchInstances`,
        {
          headers: {
            'apikey': EVOLUTION_API_KEY
          },
          // No es necesario 'params', fetchInstances devuelve todas.
          // Filtraremos localmente.
        }
      );
      
      // DEBUG LOG (puedes quitarlo después)
      console.log('[Evolution DEBUG] fetchInstances response:', JSON.stringify(response.data, null, 2));
      
      const instances = response.data || [];
      
      // --- CORRECCIÓN AQUÍ ---
      // La API devuelve la propiedad como "name", no "instanceName"
      const exists = instances.some(inst => inst.name === businessSlug);
      // --- FIN DE CORRECCIÓN ---
      
      console.log(`[Evolution] Instancia ${businessSlug} existe: ${exists}`);
      
      return exists;
      
    } catch (error) {
      console.error('[Evolution] Error verificando instancia:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Obtener detalles de una instancia (nombre, número)
   */
  async getInstanceDetails(businessSlug) {
    try {
      console.log(`[Evolution] Obteniendo detalles de: ${businessSlug}`);
      const response = await axios.get(
        `${EVOLUTION_API_URL}/instance/fetchInstances`,
        { headers: { 'apikey': EVOLUTION_API_KEY } }
      );
      
      const instances = response.data || [];
      // Buscar la instancia específica
      const instance = instances.find(inst => inst.name === businessSlug);
      
      if (instance) {
        return {
          instanceName: instance.name,
          phoneNumber: instance.ownerJid ? instance.ownerJid.split('@')[0] : null 
        };
      }
      return null;

    } catch (error) {
      console.error('[Evolution] Error en getInstanceDetails:', error.response?.data || error.message);
      return null;
    }
  }

};

export default new EvolutionService();