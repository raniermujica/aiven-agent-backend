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

    // Obtener restaurant por slug
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id')
      .eq('slug', businessSlug)
      .single();

    if (restaurantError || !restaurant) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Parsear fecha
    const requestedDate = new Date(date);
    const dayOfWeek = requestedDate.getDay(); // 0 = Domingo, 6 = Sábado

    // Buscar reglas de disponibilidad
    // 1. Primero buscar fecha específica
    // 2. Si no existe, buscar día de la semana
    const { data: availabilityRules, error: rulesError } = await supabase
      .from('availability_rules')
      .select('*')
      .eq('restaurant_id', restaurant.id)
      .or(`specific_date.eq.${date},and(day_of_week.eq.${dayOfWeek},specific_date.is.null)`)
      .order('priority', { ascending: false });

    if (rulesError) {
      console.error('Error obteniendo reglas:', rulesError);
      return res.status(500).json({ error: 'Error al obtener disponibilidad' });
    }

    // Si no hay reglas, el negocio está cerrado
    if (!availabilityRules || availabilityRules.length === 0) {
      return res.json({ availableSlots: [] });
    }

    // Tomar la regla con mayor prioridad (fecha específica > día de semana)
    const rule = availabilityRules[0];

    // Si está cerrado
    if (rule.is_closed) {
      return res.json({ availableSlots: [] });
    }

    // Generar slots basados en slot_duration_minutes
    const slots = [];
    const slotDuration = rule.slot_duration_minutes || 30;
    
    // Parsear horarios (formato HH:MM:SS)
    const [openHour, openMinute] = rule.open_time.split(':').map(Number);
    const [closeHour, closeMinute] = rule.close_time.split(':').map(Number);

    let currentHour = openHour;
    let currentMinute = openMinute;

    while (
      currentHour < closeHour ||
      (currentHour === closeHour && currentMinute < closeMinute)
    ) {
      const timeString = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
      slots.push(timeString);

      // Incrementar según slot_duration_minutes
      currentMinute += slotDuration;
      if (currentMinute >= 60) {
        currentMinute = currentMinute % 60;
        currentHour += Math.floor((currentMinute + slotDuration) / 60);
      }
    }

    // Obtener citas existentes para ese día
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const { data: appointments, error: appointmentsError } = await supabase
      .from('appointments')
      .select('appointment_time, duration_minutes')
      .eq('restaurant_id', restaurant.id)
      .gte('appointment_time', startOfDay.toISOString())
      .lte('appointment_time', endOfDay.toISOString())
      .in('status', ['confirmado', 'pendiente']);

    if (appointmentsError) {
      console.error('Error obteniendo citas:', appointmentsError);
    }

    // Filtrar slots ocupados
    const availableSlots = slots.filter(slot => {
      const [slotHour, slotMinute] = slot.split(':').map(Number);
      
      // Crear timestamp del slot
      const slotTime = new Date(date);
      slotTime.setHours(slotHour, slotMinute, 0, 0);

      // El slot solicitado termina en
      const slotEnd = new Date(slotTime.getTime() + durationMinutes * 60000);

      // Verificar que hay tiempo suficiente antes del cierre
      const closeTime = new Date(date);
      closeTime.setHours(closeHour, closeMinute, 0, 0);

      if (slotEnd > closeTime) {
        return false;
      }

      // Contar cuántas citas hay en este slot
      const appointmentsInSlot = appointments?.filter(apt => {
        const aptStart = new Date(apt.appointment_time);
        const aptEnd = new Date(aptStart.getTime() + (apt.duration_minutes || 60) * 60000);

        // Hay superposición si los rangos se cruzan
        return (
          (slotTime >= aptStart && slotTime < aptEnd) || // Slot empieza durante cita
          (slotEnd > aptStart && slotEnd <= aptEnd) ||   // Slot termina durante cita
          (slotTime <= aptStart && slotEnd >= aptEnd)    // Slot envuelve toda la cita
        );
      }) || [];

      // Verificar capacidad máxima por slot
      const maxReservations = rule.max_reservations_per_slot || 1;
      return appointmentsInSlot.length < maxReservations;
    });

    res.json({ availableSlots });

  } catch (error) {
    console.error('Error verificando disponibilidad:', error);
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