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

    // ✅ OBTENER DATOS CON BUSINESS_TYPE
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
          email,
          business_type
        ),
        appointment_services (
          service_name,
          duration_minutes,
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

    // ✅ DETECTAR SI ES RESTAURANTE
    const isRestaurant = appointment.restaurants.business_type === 'restaurant';

    // ✅ FORMATEAR SERVICIOS (Manejar service_id null)
    const services = appointment.appointment_services.map(as => ({
      name: as.service_name || as.services?.name || 'Servicio',
      duration_minutes: as.duration_minutes || as.services?.duration_minutes || 60
    }));

    // Formatear datos para el email
    const emailData = {
      customer_email: appointment.customers.email,
      customer_name: appointment.customers.name,
      appointment_date: appointment.scheduled_date,
      appointment_time: timeString,
      services,
      business_name: appointment.restaurants.name,
      business_phone: appointment.restaurants.phone,
      business_address: appointment.restaurants.address,
      business_email: appointment.restaurants.email,
      total_duration: appointment.duration_minutes,
      appointment_id: appointment.id,
      is_restaurant: isRestaurant, // ✅ AÑADIR
      party_size: appointment.party_size // ✅ AÑADIR
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

    console.log('[Email] Buscando citas para:', tomorrow);

    // Buscar citas que necesitan recordatorio
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
          email,
          business_type
        ),
        appointment_services (
          service_name,
          duration_minutes,
          services (
            name,
            duration_minutes
          )
        )
      `)
      .eq('status', 'confirmado')
      .is('reminder_sent_at', null)
      .gte('appointment_time', tomorrow.toISOString())
      .lte('appointment_time', new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000).toISOString());

    if (error) throw error;

    if (!appointments || appointments.length === 0) {
      console.log('[Email] No hay citas para recordar');
      return res.json({ success: true, sent: 0 });
    }

    console.log(`[Email] Enviando ${appointments.length} recordatorios...`);

    let sent = 0;
    for (const appointment of appointments) {
      if (!appointment.customers?.email) continue;

      try {
        const appointmentTimeObj = new Date(appointment.appointment_time);
        const timeString = appointmentTimeObj.toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });

        const isRestaurant = appointment.restaurants.business_type === 'restaurant';
        
        const services = appointment.appointment_services.map(as => ({
          name: as.service_name || as.services?.name || 'Servicio',
          duration_minutes: as.duration_minutes || as.services?.duration_minutes || 60
        }));

        await emailService.sendAppointmentReminder({
          customer_email: appointment.customers.email,
          customer_name: appointment.customers.name,
          appointment_date: appointment.scheduled_date,
          appointment_time: timeString,
          services,
          business_name: appointment.restaurants.name,
          business_phone: appointment.restaurants.phone,
          business_address: appointment.restaurants.address,
          appointment_id: appointment.id,
          is_restaurant: isRestaurant,
          party_size: appointment.party_size
        });

        await supabase
          .from('appointments')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', appointment.id);

        sent++;
      } catch (emailError) {
        console.error(`[Email] Error enviando recordatorio para ${appointment.id}:`, emailError);
      }
    }

    res.json({ success: true, sent });

  } catch (error) {
    console.error('[Email] Error en sendPendingReminders:', error);
    res.status(500).json({ error: 'Error al enviar recordatorios' });
  }
};