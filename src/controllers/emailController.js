import emailService from '../services/emailService.js';
import { supabase } from '../config/database.js';

/**
 * Enviar email de confirmación de cita
 * POST /api/emails/send-confirmation/:appointmentId
 */
export async function sendConfirmationEmail(req, res) {
  try {
    const { appointmentId } = req.params;
     console.log(`[Email] Enviando confirmación para cita: ${appointmentId}`);

    // Obtener datos de la cita con servicios
    const { data: appointment, error } = await supabase
      .from('appointments')
      .select(`
        *,
        customers (
          name,
          email,
          phone
        ),
        restaurants (
          name,
          phone,
          address,
          email  
        ),
        appointment_services (
          services (
            name,
            duration_minutes
          )
        )
      `)
      .eq('id', appointmentId)
      .single();

    if (error || !appointment) {
      console.log('[Email] Cita no encontrada:', error);
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    if (!appointment.customers?.email) {
      console.log('[Email] Cliente no tiene email');
      return res.status(400).json({ error: 'Cliente no tiene email registrado' });
    }

    // Formatear appointment_time (es timestamp completo)
    const appointmentTimeObj = new Date(appointment.appointment_time);
    const timeString = appointmentTimeObj.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    // Formatear datos para el email
    const emailData = {
      customer_email: appointment.customers.email,
      customer_name: appointment.customers.name,
      appointment_date: appointment.scheduled_date,
      appointment_time: timeString,
      services: appointment.appointment_services.map(as => ({
        name: as.services.name,
        duration_minutes: as.services.duration_minutes
      })),
      business_name: appointment.restaurants.name,
      business_phone: appointment.restaurants.phone,
      business_address: appointment.restaurants.address,
      business_email: appointment.restaurants.email,
      total_duration: appointment.duration_minutes,
      appointment_id: appointment.id
    };

     console.log('[EmailService] 📧 Datos del email:', JSON.stringify(emailData, null, 2));

    // Enviar email
    await emailService.sendAppointmentConfirmation(emailData);

    // Actualizar que se envió confirmación
    await supabase
      .from('appointments')
      .update({
        confirmation_sent_at: new Date().toISOString()
      })
      .eq('id', appointmentId);

    res.json({
      success: true,
      message: 'Email de confirmación enviado correctamente'
    });

  } catch (error) {
    console.error('[Email] Error en sendConfirmationEmail:', error);
    console.error('📧 Detalles del error SendGrid:', error.response?.body);
    console.error('📧 Body completo:', JSON.stringify(error.response?.body, null, 2));
    res.status(500).json({
      error: 'Error al enviar email',
      details: error.message
    });
  }
}

/**
 * Enviar recordatorios pendientes (cron job)
 * POST /api/emails/send-reminders
 */
export async function sendPendingReminders(req, res) {
  try {
    console.log('[Email] Iniciando envío de recordatorios...');

    // Calcular fecha/hora 24h en el futuro
    const tomorrow = new Date();
    tomorrow.setHours(tomorrow.getHours() + 24);

    const tomorrowStart = new Date(tomorrow);
    tomorrowStart.setHours(0, 0, 0, 0);

    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(23, 59, 59, 999);

    // Buscar citas pendientes para mañana sin recordatorio enviado
    const { data: appointments, error } = await supabase
      .from('appointments')
      .select(`
        *,
        customers (
          name,
          email,
          phone
        ),
        restaurants (
          name,
          phone,
          address,
          email 
        ),
        appointment_services (
          services (
            name,
            duration_minutes
          )
        )
      `)
      .gte('scheduled_date', tomorrowStart.toISOString())
      .lte('scheduled_date', tomorrowEnd.toISOString())
      .in('status', ['confirmado', 'pendiente'])
      .is('reminder_sent_at', null);

    if (error) {
      throw error;
    }

    if (!appointments || appointments.length === 0) {
      console.log('[Email] No hay recordatorios pendientes');
      return res.json({
        success: true,
        message: 'No hay recordatorios pendientes',
        sent: 0
      });
    }

    console.log(`[Email] ${appointments.length} recordatorios por enviar`);

    let sent = 0;
    let failed = 0;

    // Enviar recordatorios
    for (const appointment of appointments) {
      try {
        if (!appointment.customers?.email) {
          console.log(`[Email] Saltando cita ${appointment.id} - sin email`);
          failed++;
          continue;
        }

        // Formatear appointment_time (es timestamp completo)
        const appointmentTimeObj = new Date(appointment.appointment_time);
        const timeString = appointmentTimeObj.toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });

        const emailData = {
          customer_email: appointment.customers.email,
          customer_name: appointment.customers.name,
          appointment_date: appointment.scheduled_date,
          appointment_time: timeString,
          services: appointment.appointment_services.map(as => ({
            name: as.services.name,
            duration_minutes: as.services.duration_minutes
          })),
          business_name: appointment.restaurants.name,
          business_phone: appointment.restaurants.phone,
          business_address: appointment.restaurants.address,
          business_email: appointment.restaurants.email, // <-- 💡 CORRECCIÓN AÑADIDA
          appointment_id: appointment.id
        };

        await emailService.sendAppointmentReminder(emailData);

        // Actualizar que se envió recordatorio
        await supabase
          .from('appointments')
          .update({
            reminder_sent_at: new Date().toISOString()
          })
          .eq('id', appointment.id);

        sent++;

      } catch (emailError) {
        console.error(`[Email] Error enviando a ${appointment.id}:`, emailError);
        failed++;
      }
    }

    console.log(`[Email] Recordatorios completados: ${sent} enviados, ${failed} fallidos`);

    res.json({
      success: true,
      message: 'Recordatorios procesados',
      sent,
      failed,
      total: appointments.length
    });

  } catch (error) {
    console.error('[Email] Error en sendPendingReminders:', error);
    res.status(500).json({
      error: 'Error al procesar recordatorios',
      details: error.message
    });
  }
};