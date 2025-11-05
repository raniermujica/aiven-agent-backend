import sgMail from '@sendgrid/mail';
import dotenv from 'dotenv';

dotenv.config();

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
                business_email,
                total_duration,
                appointment_id
            } = appointmentData;

            // Formatear fecha
            const formattedDate = new Date(appointment_date).toLocaleDateString('es-ES', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            // Lista de servicios
            const servicesList = services.map(s => `• ${s.name} (${s.duration_minutes} min)`).join('\n');

            const msg = {
                to: customer_email,
                from: {
                    email: FROM_EMAIL, 
                    name: business_name 
                },
                replyTo: {
                    email: business_email, 
                    name: business_name
                },
                subject: `✅ Cita Confirmada - ${business_name}`,
                text: `
Hola ${customer_name},

Tu cita ha sido confirmada exitosamente.

📅 DETALLES DE TU CITA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Fecha: ${formattedDate}
Hora: ${appointment_time}
Duración estimada: ${total_duration} minutos

Servicios:
${servicesList}

📍 UBICACIÓN:
${business_name}
${business_address}

📞 CONTACTO:
${business_phone}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IMPORTANTE:
• Te enviaremos un recordatorio 24 horas antes
• Si necesitas cancelar o reprogramar, comunícate al ${business_phone}

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
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .card { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
    .detail-label { font-weight: bold; color: #667eea; }
    .services { background: #f0f4ff; padding: 15px; border-radius: 5px; margin: 15px 0; }
    .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
    .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ Cita Confirmada</h1>
      <p>Tu reserva ha sido procesada exitosamente</p>
    </div>
    
    <div class="content">
      <p>Hola <strong>${customer_name}</strong>,</p>
      
      <div class="card">
        <h2 style="color: #667eea; margin-top: 0;">📅 Detalles de tu Cita</h2>
        
        <div class="detail-row">
          <span class="detail-label">Fecha:</span>
          <span>${formattedDate}</span>
        </div>
        
        <div class="detail-row">
          <span class="detail-label">Hora:</span>
          <span>${appointment_time}</span>
        </div>
        
        <div class="detail-row">
          <span class="detail-label">Duración:</span>
          <span>${total_duration} minutos</span>
        </div>
        
        <div class="services">
          <strong>Servicios:</strong><br>
          ${services.map(s => `• ${s.name} (${s.duration_minutes} min)`).join('<br>')}
        </div>
      </div>
      
      <div class="card">
        <h3 style="color: #667eea; margin-top: 0;">📍 Ubicación</h3>
        <p><strong>${business_name}</strong><br>${business_address}</p>
        
        <h3 style="color: #667eea;">📞 Contacto</h3>
        <p>${business_phone}</p>
      </div>
      
      <div style="background: #fff3cd; padding: 15px; border-radius: 5px; border-left: 4px solid #ffc107;">
        <strong>⚠️ Importante:</strong>
        <ul style="margin: 10px 0;">
          <li>Te enviaremos un recordatorio 24 horas antes de tu cita</li>
          <li>Si necesitas cancelar o reprogramar, comunícate al ${business_phone}</li>
        </ul>
      </div>
      
      <div style="text-align: center; margin-top: 30px;">
        <p style="color: #667eea; font-size: 18px;">¡Te esperamos! 🎉</p>
      </div>
      
      <div class="footer">
        <p>Este es un email automático de ${business_name}</p>
        <p>ID de cita: ${appointment_id}</p>
      </div>
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
                    name: FROM_NAME
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