import sgMail from '@sendgrid/mail';
import dotenv from 'dotenv';

dotenv.config();
console.log('[EmailService] 🔍 Carga inicial. API Key presente:', !!process.env.SENDGRID_API_KEY);
console.log('[EmailService] 🔍 FROM_EMAIL configurado:', process.env.SENDGRID_FROM_EMAIL);

// Configurar SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@agentpaul.com';
const FROM_NAME = process.env.SENDGRID_FROM_NAME || 'Agent Paul';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

class EmailService {

  /**
   * Enviar email de confirmación de cita
   */
  async sendAppointmentConfirmation(appointmentData) {
    try {
      const {
        customer_email,
        customer_name,
        appointment_date,
        appointment_time,
        services,
        business_name,
        business_phone,
        business_address,
        total_duration,
        appointment_id,
        is_restaurant = false, // ✅ NUEVO
        party_size = null      // ✅ NUEVO
      } = appointmentData;

      const formattedDate = new Date(appointment_date).toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      // ✅ SERVICIOS DINÁMICOS
      const servicesList = services.map(s =>
        `• ${s.name}${!is_restaurant ? ` (${s.duration_minutes} min)` : ''}`
      ).join('\n');

      // ✅ TERMINOLOGÍA DINÁMICA
      const bookingWord = is_restaurant ? 'Reserva' : 'Cita';
      const bookingWordLower = is_restaurant ? 'reserva' : 'cita';

      const msg = {
        to: customer_email,
        from: {
          email: FROM_EMAIL,
          name: business_name || FROM_NAME
        },
        subject: `✅ Confirmación de ${bookingWordLower} - ${business_name}`,
        text: `
Hola ${customer_name},

Tu ${bookingWordLower} ha sido confirmada.

📅 DETALLES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Fecha: ${formattedDate}
Hora: ${appointment_time}
${is_restaurant ? `Personas: ${party_size}` : `Duración: ${total_duration} minutos`}

${is_restaurant ? 'Mesa' : 'Servicios'}:
${servicesList}

📍 ${business_name}
${business_address}

📞 ${business_phone}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Importante:
* Te enviaremos un recordatorio 24 horas antes de tu ${bookingWordLower}
* Si necesitas cancelar o reprogramar, comunícate al ${business_phone}

¡Te esperamos!

Este es un email automático de ${business_name}
ID de ${bookingWordLower}: ${appointment_id}
            `,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Arial', sans-serif; background-color: #f4f4f4;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px;">✅ ${bookingWord} Confirmada</h1>
    </div>
    
    <div style="padding: 40px 30px;">
      
      <p style="font-size: 16px; color: #333; margin-bottom: 30px;">
        Hola <strong>${customer_name}</strong>,
      </p>
      
      <div style="background-color: #f8f9fa; border-left: 4px solid #667eea; padding: 20px; margin-bottom: 30px;">
        <h2 style="color: #667eea; margin-top: 0; font-size: 20px;">Detalles de tu ${bookingWord}</h2>
        
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 10px 0; color: #666; width: 120px;"><strong>Fecha:</strong></td>
            <td style="padding: 10px 0; color: #333;">${formattedDate}</td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #666;"><strong>Hora:</strong></td>
            <td style="padding: 10px 0; color: #333;">${appointment_time}</td>
          </tr>
          ${is_restaurant ? `
          <tr>
            <td style="padding: 10px 0; color: #666;"><strong>Personas:</strong></td>
            <td style="padding: 10px 0; color: #333;">${party_size} ${party_size === 1 ? 'persona' : 'personas'}</td>
          </tr>
          ` : `
          <tr>
            <td style="padding: 10px 0; color: #666;"><strong>Duración:</strong></td>
            <td style="padding: 10px 0; color: #333;">${total_duration} minutos</td>
          </tr>
          `}
          <tr>
            <td style="padding: 10px 0; color: #666; vertical-align: top;"><strong>${is_restaurant ? 'Mesa:' : 'Servicios:'}</strong></td>
            <td style="padding: 10px 0; color: #333; white-space: pre-line;">${servicesList}</td>
          </tr>
        </table>
      </div>
      
      <div style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
        <h3 style="color: #856404; margin-top: 0; font-size: 16px;">📍 Ubicación</h3>
        <p style="margin: 0; color: #856404;"><strong>${business_name}</strong></p>
        <p style="margin: 5px 0; color: #856404;">${business_address}</p>
      </div>
      
      <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
        <h3 style="color: #0c5460; margin-top: 0; font-size: 16px;">📞 Contacto</h3>
        <p style="margin: 0; color: #0c5460;">${business_phone}</p>
      </div>
      
      <div style="background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
        <h3 style="color: #721c24; margin-top: 0; font-size: 16px;">⚠️ Importante:</h3>
        <ul style="margin: 10px 0; padding-left: 20px; color: #721c24;">
          <li>Te enviaremos un recordatorio 24 horas antes de tu ${bookingWordLower}</li>
          <li>Si necesitas cancelar o reprogramar, comunícate al ${business_phone}</li>
        </ul>
      </div>
      
      <p style="font-size: 16px; color: #333; text-align: center; font-weight: bold;">
        ¡Te esperamos! 🎉
      </p>
    </div>
      
    <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #dee2e6;">
      <p style="margin: 0; font-size: 12px; color: #6c757d;">Este es un email automático de ${business_name}</p>
      <p style="margin: 5px 0; font-size: 12px; color: #6c757d;">ID de ${bookingWordLower}: ${appointment_id}</p>
    </div>
  </div>
</body>
</html>
            `
      };

      await sgMail.send(msg);
      console.log(`[Email] Confirmación enviada a: ${customer_email}`);

      return { success: true };

    } catch (error) {
      console.error('[Email] Error enviando confirmación:', error);
      throw error;
    }
  }

  /**
   * Enviar recordatorio de cita (24h antes)
   */
  async sendAppointmentReminder(appointmentData) {
    try {
      const {
        customer_email,
        customer_name,
        appointment_date,
        appointment_time,
        services,
        business_name,
        business_phone,
        business_address,
        appointment_id
      } = appointmentData;

      const formattedDate = new Date(appointment_date).toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      const servicesList = services.map(s => `• ${s.name}`).join('\n');

      const msg = {
        to: customer_email,
        from: {
          email: FROM_EMAIL,
          name: business_name || FROM_NAME
        },
        subject: `🔔 Recordatorio: Tu cita mañana en ${business_name}`,
        text: `
Hola ${customer_name},

Este es un recordatorio de tu cita programada para mañana.

📅 DETALLES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Fecha: ${formattedDate}
Hora: ${appointment_time}

Servicios:
${servicesList}

📍 ${business_name}
${business_address}

📞 ${business_phone}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Si necesitas cancelar o reprogramar, comunícate lo antes posible al ${business_phone}

¡Te esperamos!

${business_name}
        `,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .card { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .highlight { background: #fff3cd; padding: 20px; border-radius: 8px; border-left: 4px solid #ffc107; margin: 20px 0; }
    .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔔 Recordatorio de Cita</h1>
      <p>Tu cita es mañana</p>
    </div>
    
    <div class="content">
      <p>Hola <strong>${customer_name}</strong>,</p>
      
      <div class="highlight">
        <h2 style="margin-top: 0; color: #f5576c;">⏰ Tu cita es mañana</h2>
        <p style="font-size: 18px; margin: 15px 0;">
          <strong>${formattedDate}</strong><br>
          <strong style="font-size: 24px; color: #f5576c;">${appointment_time}</strong>
        </p>
      </div>
      
      <div class="card">
        <h3 style="color: #f5576c;">Servicios:</h3>
        ${services.map(s => `<p style="margin: 5px 0;">• ${s.name}</p>`).join('')}
      </div>
      
      <div class="card">
        <h3 style="color: #f5576c;">📍 Ubicación</h3>
        <p><strong>${business_name}</strong><br>${business_address}</p>
        
        <h3 style="color: #f5576c;">📞 Contacto</h3>
        <p>${business_phone}</p>
      </div>
      
      <div style="background: #ffebee; padding: 15px; border-radius: 5px; text-align: center;">
        <p><strong>¿Necesitas cancelar o reprogramar?</strong><br>
        Comunícate lo antes posible al ${business_phone}</p>
      </div>
      
      <div style="text-align: center; margin-top: 30px;">
        <p style="color: #f5576c; font-size: 18px;">¡Te esperamos! 👋</p>
      </div>
      
      <div class="footer">
        <p>Este es un recordatorio automático de ${business_name}</p>
        <p>ID de cita: ${appointment_id}</p>
      </div>
    </div>
  </div>
</body>
</html>
        `
      };

      await sgMail.send(msg);
      console.log(`[Email] Recordatorio enviado a: ${customer_email}`);

      return { success: true };

    } catch (error) {
      console.error('[Email] Error enviando recordatorio:', error);
      throw error;
    }
  }
}

export default new EmailService();