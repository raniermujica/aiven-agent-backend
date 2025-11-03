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
      
      console.log(`[Evolution] Instancia creada: ${businessSlug}`);
      
      return {
        success: true,
        instanceName: businessSlug,
        qrCode: response.data.qrcode?.code || response.data.qrcode?.base64,
        status: 'created'
      };
      
    } catch (error) {
      console.error('[Evolution] Error creando instancia:', error.response?.data || error.message);
      throw new Error('No se pudo crear la instancia de WhatsApp');
    }
  }
  
  /**
   * Configurar webhook para la instancia
   */
  async setWebhook(businessSlug) {
    try {
      console.log(`[Evolution] Configurando webhook para: ${businessSlug}`);
      
      await axios.post(
        `${EVOLUTION_API_URL}/webhook/set/${businessSlug}`,
        {
          url: N8N_WEBHOOK_URL,
          webhook_by_events: false,
          webhook_base64: false,
          events: ['MESSAGES_UPSERT']
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
      console.error('[Evolution] Error configurando webhook:', error.response?.data || error.message);
      throw new Error('No se pudo configurar el webhook');
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
      
      return {
        state: response.data.state, // 'open', 'close', 'connecting'
        isConnected: response.data.state === 'open'
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
      
      return {
        success: true,
        qrCode: response.data.qrcode?.code || response.data.qrcode?.base64
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
          }
        }
      );
      
      const instances = response.data || [];
      return instances.some(inst => inst.instance?.instanceName === businessSlug);
      
    } catch (error) {
      console.error('[Evolution] Error verificando instancia:', error.response?.data || error.message);
      return false;
    }
  }
}

export default new EvolutionService();