import express from 'express';
import { supabase } from '../config/database.js';
import { sendConfirmationEmail } from '../controllers/emailController.js';
import { createRequire } from 'module';
import { sendBatchReminders } from '../controllers/appointmentsController.js';

const require = createRequire(import.meta.url);
const { fromZonedTime, toZonedTime } = require('date-fns-tz');

const router = express.Router();


// POST /api/public/cron/run-reminders
router.post('/cron/run-reminders', sendBatchReminders);

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
      .select('id, name, slug, phone, email, address, logo_url, description, business_hours, business_type')
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

    // Obtener restaurant con config
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id, timezone, config')
      .eq('slug', businessSlug)
      .single();

    if (restaurantError || !restaurant) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const timezone = restaurant.timezone || 'Europe/Madrid';
    
    // Obtener capacidad de config
    let maxCapacity = 1;
    if (restaurant.config && typeof restaurant.config === 'object') {
      maxCapacity = restaurant.config.max_appointments_per_slot || 1;
    } else if (typeof restaurant.config === 'string') {
      try {
        const configParsed = JSON.parse(restaurant.config);
        maxCapacity = restaurant.config.max_appointments_per_slot || 1;
      } catch (e) {
        console.warn('[Availability] Error parsing config:', e);
      }
    }

    console.log('[Availability] Max capacity from config:', maxCapacity);

    const requestedDateObj = new Date(date + 'T00:00:00');
    const dayOfWeek = requestedDateObj.getDay();

    // ========================================
    // OBTENER BLOQUEOS DEL DÍA
    // ========================================
    const dayStartUTC = fromZonedTime(new Date(date + 'T00:00:00'), timezone);
    const dayEndUTC = fromZonedTime(new Date(date + 'T23:59:59'), timezone);

    const { data: dayBlocks, error: blocksError } = await supabase
      .from('blocked_slots')
      .select('blocked_from, blocked_until, reason, block_type')
      .eq('restaurant_id', restaurant.id)
      .eq('is_active', true)
      .is('table_id', null)
      .or(`and(blocked_from.lte.${dayEndUTC.toISOString()},blocked_until.gte.${dayStartUTC.toISOString()})`);

    if (blocksError) {
      console.error('[Availability] Error getting blocks:', blocksError);
    }

    // Convertir bloqueos a hora local
    const blockedRanges = (dayBlocks || []).map(block => ({
      start: toZonedTime(new Date(block.blocked_from), timezone),
      end: toZonedTime(new Date(block.blocked_until), timezone),
      reason: block.reason,
      type: block.block_type
    }));

    console.log('[Availability] Blocked ranges:', blockedRanges.length);

    // ========================================
    // OBTENER REGLAS DE DISPONIBILIDAD
    // ========================================
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
      console.log('[Availability] Business closed');
      return res.json({ availableSlots: [] });
    }

    // Parsear horarios
    const [openHour, openMinute] = rule.open_time.split(':').map(Number);
    const [closeHour, closeMinute] = rule.close_time.split(':').map(Number);

    const openTimeLocal = new Date(date);
    openTimeLocal.setHours(openHour, openMinute, 0, 0);
    
    const closeTimeLocal = new Date(date);
    closeTimeLocal.setHours(closeHour, closeMinute, 0, 0);

    console.log('[Availability] Business hours:', {
      open: `${openHour}:${openMinute}`,
      close: `${closeHour}:${closeMinute}`
    });

    // ========================================
    // OBTENER CITAS DEL DÍA
    // ========================================
    const { data: appointments, error: appointmentsError } = await supabase
      .from('appointments')
      .select('appointment_time, duration_minutes')
      .eq('restaurant_id', restaurant.id)
      .gte('appointment_time', dayStartUTC.toISOString())
      .lte('appointment_time', dayEndUTC.toISOString())
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

    console.log('[Availability] Busy blocks:', busyBlocks.map(b => ({
      start: `${b.start.getHours()}:${String(b.start.getMinutes()).padStart(2, '0')}`,
      end: `${b.end.getHours()}:${String(b.end.getMinutes()).padStart(2, '0')}`
    })));

    // ========================================
    // GENERAR SLOTS DISPONIBLES
    // ========================================
    const availableSlots = [];
    const SLOT_INTERVAL = 15;
    
    let currentTime = new Date(openTimeLocal);

    while (currentTime < closeTimeLocal) {
      const serviceEndTime = new Date(currentTime.getTime() + durationMinutes * 60000);
      
      if (serviceEndTime > closeTimeLocal) {
        break;
      }

      // Verificar si el slot está en un rango bloqueado
      const isInBlockedRange = blockedRanges.some(block => {
        return (
          (currentTime >= block.start && currentTime < block.end) ||
          (serviceEndTime > block.start && serviceEndTime <= block.end) ||
          (currentTime <= block.start && serviceEndTime >= block.end)
        );
      });

      if (isInBlockedRange) {
        currentTime = new Date(currentTime.getTime() + SLOT_INTERVAL * 60000);
        continue;
      }

      // Verificar capacidad minuto a minuto
      let isSlotAvailable = true;
      let maxConcurrentFound = 0;

      for (let minute = 0; minute < durationMinutes; minute++) {
        const checkTime = new Date(currentTime.getTime() + minute * 60000);
        
        const activeAppointments = busyBlocks.filter(block => {
          return checkTime >= block.start && checkTime < block.end;
        }).length;

        if (activeAppointments > maxConcurrentFound) {
          maxConcurrentFound = activeAppointments;
        }

        if (activeAppointments >= maxCapacity) {
          isSlotAvailable = false;
        }
      }

      const hours = currentTime.getHours();
      const minutes = currentTime.getMinutes();
      const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

      if (!isSlotAvailable) {
        console.log(`[Availability] Slot ${timeString} BLOCKED - max concurrent: ${maxConcurrentFound}/${maxCapacity}`);
      }

      if (isSlotAvailable) {
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
      notes,
      partySize // ✅ AÑADIR
    } = req.body;

    console.log('📥 Datos recibidos:', { clientName, scheduledDate, appointmentTime, services, partySize });

    // Obtener restaurant con timezone y business_type
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id, timezone, name, phone, email, address, business_type') // ✅ AÑADIR business_type
      .eq('slug', businessSlug)
      .single();

    if (restaurantError || !restaurant) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const timezone = restaurant.timezone || 'Europe/Madrid';
    const isRestaurant = restaurant.business_type === 'restaurant';

    // ✅ CONVERTIR HORA LOCAL A UTC
    const localDateTimeString = `${scheduledDate}T${appointmentTime}:00`;
    const appointmentDateTimeUTC = fromZonedTime(localDateTimeString, timezone);
    
    console.log('🕐 Conversión de hora:');
    console.log('  - Local:', localDateTimeString);
    console.log('  - UTC:', appointmentDateTimeUTC.toISOString());

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
      
      if (clientEmail) {
        await supabase
          .from('customers')
          .update({ email: clientEmail, name: clientName })
          .eq('id', customerId);
      }
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

    const servicesList = services && services.length > 0
      ? services
      : [{ id: serviceId, name: serviceName, duration_minutes: durationMinutes }];

    console.log('📋 Servicios a guardar:', servicesList);

    // ✅ ASIGNACIÓN DE MESA (SOLO RESTAURANTES)
    let assignedTableId = null;
    let assignmentReason = null;

    if (isRestaurant && partySize) {
      console.log('🍽️ Iniciando asignación de mesa...');
      
      const { tableAssignmentEngine } = await import('../services/restaurant/tableAssignmentEngine.js');

      const assignmentResult = await tableAssignmentEngine.findBestTable({
        restaurantId: restaurant.id,
        date: scheduledDate,
        time: appointmentTime,
        partySize: parseInt(partySize),
        duration: durationMinutes || 90,
        preference: null
      });

      if (assignmentResult.success) {
        assignedTableId = assignmentResult.table.id;
        assignmentReason = assignmentResult.reason;
        console.log(`✅ Mesa asignada: ${assignmentResult.table.table_number}`);
      } else {
        console.warn('⚠️ No se pudo asignar mesa:', assignmentResult.message);
      }
    }

    // Crear cita
    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .insert({
        restaurant_id: restaurant.id,
        customer_id: customerId,
        table_id: assignedTableId, 
        service_id: servicesList[0].id || serviceId,
        service_name: servicesList[0].name || serviceName,
        duration_minutes: durationMinutes,
        scheduled_date: scheduledDate,
        appointment_time: appointmentDateTimeUTC.toISOString(),
        client_name: clientName,
        client_phone: clientPhone,
        client_email: clientEmail,
        status: 'confirmado',
        notes: notes ? `${notes}\n\n[Agendado desde enlace público]` : '[Agendado desde enlace público]',
        party_size: isRestaurant ? parseInt(partySize) : null, 
        source: 'web' 
      })
      .select('*')
      .single();

    if (appointmentError) throw appointmentError;

    console.log('✅ Cita creada:', appointment.id);

    // ✅ CREAR REGISTRO DE ASIGNACIÓN DE MESA
    if (assignedTableId && isRestaurant) {
      await supabase.from('table_assignments').insert({
        appointment_id: appointment.id,
        table_id: assignedTableId,
        assigned_by: null, // Sistema automático
        assignment_type: 'automatic',
      });
      console.log('✅ Table assignment creado');
    }

    // ✅ INSERTAR TODOS LOS SERVICIOS
    const appointmentServicesData = servicesList.map((service, index) => ({
      appointment_id: appointment.id,
      service_id: service.id || null,
      service_name: service.name,
      duration_minutes: service.duration_minutes || 60,
      price: service.price || 0,
      display_order: index
    }));

    const { error: servicesError } = await supabase
      .from('appointment_services')
      .insert(appointmentServicesData);

    if (servicesError) {
      console.error('❌ Error insertando servicios:', servicesError);
    } else {
      console.log(`✅ ${appointmentServicesData.length} servicio(s) guardado(s)`);
    }

    // ✅ ENVIAR EMAIL DE CONFIRMACIÓN
    try {
      const mockReq = {
        params: { appointmentId: appointment.id }
      };

      const mockRes = {
        status: (code) => ({
          json: (data) => console.log(`📧 Email response ${code}:`, data)
        }),
        json: (data) => console.log('📧 Email enviado:', data)
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
        party_size: appointment.party_size,
        table_id: assignedTableId
      }
    });
  } catch (error) {
    console.error('❌ Error creando cita:', error);
    res.status(500).json({ error: 'Error al crear la cita' });
  }
});

export default router;