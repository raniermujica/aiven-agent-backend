import express from 'express';
import { supabase } from '../config/database.js';
import { sendConfirmationEmail } from '../controllers/emailController.js';

const router = express.Router();

// GET /api/public/:businessSlug/services
router.get('/:businessSlug/services', async (req, res) => {
  try {
    const { businessSlug } = req.params;

    // Obtener restaurant por slug
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id')
      .eq('slug', businessSlug)
      .single();

    if (restaurantError || !restaurant) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Obtener servicios activos
    const { data: services, error: servicesError } = await supabase
      .from('services')
      .select('*')
      .eq('restaurant_id', restaurant.id)
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (servicesError) {
      throw servicesError;
    }

    res.json({ services: services || [] });
  } catch (error) {
    console.error('Error obteniendo servicios:', error);
    res.status(500).json({ error: 'Error al obtener servicios' });
  }
});

// POST /api/public/:businessSlug/check-availability
router.post('/:businessSlug/check-availability', async (req, res) => {
  try {
    const { businessSlug } = req.params;
    const { date, serviceId, durationMinutes } = req.body;

    // Obtener restaurant por slug
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id')
      .eq('slug', businessSlug)
      .single();

    if (restaurantError || !restaurant) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Aquí puedes implementar la lógica de disponibilidad
    // Por ahora retornamos slots de ejemplo
    const availableSlots = [
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '12:00', '12:30', '15:00', '15:30', '16:00', '16:30',
      '17:00', '17:30', '18:00', '18:30', '19:00'
    ];

    res.json({ availableSlots });
  } catch (error) {
    console.error('Error verificando disponibilidad:', error);
    res.status(500).json({ error: 'Error al verificar disponibilidad' });
  }
});

// POST /api/public/:businessSlug/appointments
// POST /api/public/:businessSlug/appointments
router.post('/:businessSlug/appointments', async (req, res) => {
  try {
    const { businessSlug } = req.params;
    const {
      clientName,
      clientPhone,
      clientEmail,
      serviceId,
      serviceName,
      durationMinutes,
      scheduledDate,
      appointmentTime,
      services,
      notes
    } = req.body;

    // Obtener restaurant por slug
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id')
      .eq('slug', businessSlug)
      .single();

    if (restaurantError || !restaurant) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Crear o buscar cliente
    let customerId;
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', clientPhone)
      .eq('restaurant_id', restaurant.id)
      .single();

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          restaurant_id: restaurant.id,
          name: clientName,
          phone: clientPhone,
          email: clientEmail,
        })
        .select()
        .single();

      if (customerError) throw customerError;
      customerId = newCustomer.id;
    }

    // Crear cita
    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .insert({
        restaurant_id: restaurant.id,
        customer_id: customerId,
        service_id: serviceId,
        service_name: serviceName,
        duration_minutes: durationMinutes,
        scheduled_date: scheduledDate || appointmentTime,
        appointment_time: appointmentTime,
        client_name: clientName,
        client_phone: clientPhone,
        client_email: clientEmail,
        status: 'confirmado',
        notes: notes ? `${notes}\n\n[Agendado desde enlace público]` : '[Agendado desde enlace público]',
      })
      .select('*')
      .single();

    if (appointmentError) throw appointmentError;

    // ← NUEVO: Crear relación en appointment_services
    const { error: appointmentServiceError } = await supabase
      .from('appointment_services')
      .insert({
        appointment_id: appointment.id,
        service_id: serviceId,
      });

    if (appointmentServiceError) {
      console.error('Error creando appointment_service:', appointmentServiceError);
      // No fallar si esto falla, solo loguear
    }

    // ← Enviar email de confirmación
    try {
      const mockReq = {
        params: { appointmentId: appointment.id }
      };

      const mockRes = {
        status: (code) => ({
          json: (data) => console.log(`Email response ${code}:`, data)
        }),
        json: (data) => console.log('Email response:', data)
      };

      await sendConfirmationEmail(mockReq, mockRes);
      console.log('✅ Email de confirmación enviado');
    } catch (emailError) {
      console.error('❌ Error enviando email:', emailError);
    }

    res.status(201).json({
      success: true,
      appointment: {
        id: appointment.id,
        appointment_time: appointment.appointment_time,
        service_name: appointment.service_name,
        duration_minutes: appointment.duration_minutes,
        customer_name: appointment.client_name,
        customer_phone: appointment.client_phone,
        customer_email: appointment.client_email,
        date: appointment.scheduled_date,
        time: appointmentTime,
        status: appointment.status,
      }
    });
  } catch (error) {
    console.error('Error creando cita:', error);
    res.status(500).json({ error: 'Error al crear la cita' });
  }
});

export default router;