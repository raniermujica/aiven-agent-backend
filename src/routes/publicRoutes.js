import express from 'express';
import { supabase } from '../config/database.js';
import { sendConfirmationEmail } from '../controllers/emailController.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { fromZonedTime, toZonedTime } = require('date-fns-tz');

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

// GET /api/public/:businessSlug/info
router.get('/:businessSlug/info', async (req, res) => {
  try {
    const { businessSlug } = req.params;

    // Obtener restaurant por slug
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id, name, slug, phone, email, address, logo_url, description, business_hours')
      .eq('slug', businessSlug)
      .single();

    if (restaurantError || !restaurant) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    res.json({ business: restaurant });
  } catch (error) {
    console.error('Error obteniendo info del negocio:', error);
    res.status(500).json({ error: 'Error al obtener información del negocio' });
  }
});

// POST /api/public/:businessSlug/check-availability
router.post('/:businessSlug/check-availability', async (req, res) => {
  try {
    const { businessSlug } = req.params;
    const { date, serviceId, durationMinutes } = req.body;

    console.log('[Availability] Checking for:', { businessSlug, date, durationMinutes });

    // Obtener restaurant
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id, timezone')
      .eq('slug', businessSlug)
      .single();

    if (restaurantError || !restaurant) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const timezone = restaurant.timezone || 'Europe/Madrid';
    const requestedDateObj = new Date(date + 'T00:00:00');
    const dayOfWeek = requestedDateObj.getDay();

    // Obtener reglas de disponibilidad
    const { data: availabilityRules, error: rulesError } = await supabase
      .from('availability_rules')
      .select('*')
      .eq('restaurant_id', restaurant.id)
      .or(`specific_date.eq.${date},and(day_of_week.eq.${dayOfWeek},specific_date.is.null)`)
      .order('priority', { ascending: false });

    if (rulesError || !availabilityRules || availabilityRules.length === 0) {
      console.log('[Availability] No rules found');
      return res.json({ availableSlots: [] });
    }

    const rule = availabilityRules[0];

    if (rule.is_closed) {
      return res.json({ availableSlots: [] });
    }

    // Parsear horarios
    const [openHour, openMinute] = rule.open_time.split(':').map(Number);
    const [closeHour, closeMinute] = rule.close_time.split(':').map(Number);

    // Crear timestamps en hora local
    const openTimeLocal = new Date(date);
    openTimeLocal.setHours(openHour, openMinute, 0, 0);
    
    const closeTimeLocal = new Date(date);
    closeTimeLocal.setHours(closeHour, closeMinute, 0, 0);

    // Obtener citas del día (consulta en UTC)
    const startOfDayLocal = new Date(date + 'T00:00:00');
    const endOfDayLocal = new Date(date + 'T23:59:59');
    
    const startOfDayUTC = fromZonedTime(startOfDayLocal, timezone);
    const endOfDayUTC = fromZonedTime(endOfDayLocal, timezone);

    const { data: appointments, error: appointmentsError } = await supabase
      .from('appointments')
      .select('appointment_time, duration_minutes')
      .eq('restaurant_id', restaurant.id)
      .gte('appointment_time', startOfDayUTC.toISOString())
      .lte('appointment_time', endOfDayUTC.toISOString())
      .in('status', ['confirmado', 'pendiente']);

    if (appointmentsError) {
      console.error('[Availability] Error getting appointments:', appointmentsError);
    }

    console.log('[Availability] Found appointments:', appointments?.length || 0);

    // Convertir citas de UTC a hora local
    const busyBlocks = (appointments || []).map(apt => {
      const startUTC = new Date(apt.appointment_time);
      const startLocal = toZonedTime(startUTC, timezone);
      const endLocal = new Date(startLocal.getTime() + (apt.duration_minutes || 60) * 60000);
      return { start: startLocal, end: endLocal };
    });

    const maxCapacity = rule.max_reservations_per_slot || 1;
    const availableSlots = [];
    const SLOT_INTERVAL = 15; // minutos
    
    let currentTime = new Date(openTimeLocal);

    while (currentTime < closeTimeLocal) {
      const serviceEndTime = new Date(currentTime.getTime() + durationMinutes * 60000);
      
      if (serviceEndTime > closeTimeLocal) {
        break;
      }

      // Contar superposiciones en hora local
      const overlappingAppointments = busyBlocks.filter(block => {
        return (
          (currentTime >= block.start && currentTime < block.end) ||
          (serviceEndTime > block.start && serviceEndTime <= block.end) ||
          (currentTime <= block.start && serviceEndTime >= block.end)
        );
      }).length;

      if (overlappingAppointments < maxCapacity) {
        const hours = currentTime.getHours();
        const minutes = currentTime.getMinutes();
        const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        availableSlots.push(timeString);
      }

      currentTime = new Date(currentTime.getTime() + SLOT_INTERVAL * 60000);
    }

    console.log('[Availability] Available slots:', availableSlots.length);

    res.json({ availableSlots });

  } catch (error) {
    console.error('[Availability] Error:', error);
    res.status(500).json({ error: 'Error al verificar disponibilidad' });
  }
});

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