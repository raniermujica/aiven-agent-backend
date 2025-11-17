import { supabase } from '../config/database.js';
import { createRequire } from 'module';
import emailService from '../services/emailService.js';
const require = createRequire(import.meta.url);

const { fromZonedTime, toZonedTime, format } = require('date-fns-tz');
const { startOfDay, endOfDay, parseISO } = require('date-fns');

// ================================================================
// HELPER: Convertir (Fecha + Hora) local a un objeto Date UTC
// ================================================================

function getUTCFromLocal(dateStr, timeStr, timezone) {
  const localDateTimeStr = `${dateStr}T${timeStr.padEnd(8, ':00')}`;
  // 'zonedTimeToUtc' ahora vendrá del 'require' y estará definida
  const utcDate = fromZonedTime(localDateTimeStr, timezone);
  return utcDate;
}

// ================================================================
// HELPER: Validar si hay conflictos de horario
// ================================================================
function hasTimeConflict(newStart, newEnd, existingStart, existingEnd) {
  const newStartTime = new Date(newStart).getTime();
  const newEndTime = new Date(newEnd).getTime();
  const existingStartTime = new Date(existingStart).getTime();
  const existingEndTime = new Date(existingEnd).getTime();

  return (newStartTime < existingEndTime) && (newEndTime > existingStartTime);
}

// ================================================================
// HELPER: Validar conflictos por slots
// ================================================================
/**
 * Verifica la capacidad de un slot de cita contra la base de datos.
 * @returns {Promise<{available: boolean, reason: string, conflicting_appointment: object|null}>}
 */
async function checkSlotCapacity(restaurantId, requestedStartUTC, totalDuration) {
  try {
    // 1. Obtener la capacidad máxima de slots del negocio
    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('config') // Pedimos la config
      .eq('id', restaurantId)
      .single();

    if (businessError) throw new Error(`Error cargando negocio: ${businessError.message}`);

    // 2. Leer la capacidad (default 1 si no está definida)
    const maxCapacity = business.config?.max_appointments_per_slot || 1;
    const requestedEndUTC = new Date(requestedStartUTC.getTime() + (totalDuration * 60000));

    // 3. Calcular el rango del DÍA en UTC (para optimizar la consulta)
    const dayStartUTC = startOfDay(requestedStartUTC);
    const dayEndUTC = endOfDay(requestedStartUTC);

    // 4. Obtener TODAS las citas activas de ese día
    const { data: appointmentsOnDay, error: appointmentsError } = await supabase
      .from('appointments')
      .select('id, client_name, service_name, appointment_time, duration_minutes, status')
      .eq('restaurant_id', restaurantId)
      .in('status', ['pendiente', 'confirmado']) // Solo contar citas activas
      .gte('appointment_time', dayStartUTC.toISOString())
      .lte('appointment_time', dayEndUTC.toISOString());

    if (appointmentsError) throw new Error(`Error consultando citas: ${appointmentsError.message}`);

    // 5. Contar cuántas de esas citas se solapan
    let conflictCount = 0;
    let firstConflict = null;

    for (const apt of appointmentsOnDay) {
      const aptStart = new Date(apt.appointment_time);
      const aptDuration = apt.duration_minutes || 60;
      const aptEnd = new Date(aptStart.getTime() + (aptDuration * 60000));

      // Reutilizamos el helper que ya existe
      if (hasTimeConflict(requestedStartUTC, requestedEndUTC, aptStart, aptEnd)) {
        conflictCount++;
        if (!firstConflict) firstConflict = apt;
      }
    }

    console.log(`[Slot Check] Capacidad: ${maxCapacity}, Conflictos Encontrados: ${conflictCount}`);

    // 6. Comparar
    if (conflictCount >= maxCapacity) {
      return {
        available: false,
        reason: `El slot está lleno. Capacidad: ${maxCapacity}, Citas: ${conflictCount}`,
        conflicting_appointment: firstConflict
      };
    }

    return { available: true, reason: 'Slot disponible', conflicting_appointment: null };

  } catch (error) {
    console.error('Error en checkSlotCapacity:', error);
    return { available: false, reason: 'Error interno del servidor', conflicting_appointment: null };
  }
}

// ================================================================
// HELPER: Busca los siguientes 3 slots disponibles
// ================================================================

async function findNextAvailableSlots(
  restaurantId,
  totalDuration,
  daySchedule,
  dateStr,
  businessTimezone,
  requestedStartUTC
) {
  const suggestions = [];
  const MAX_SUGGESTIONS = 3;
  const SLOT_INCREMENT_MINUTES = 30; // Buscar cada 30 min

  let currentSlotUTC = new Date(requestedStartUTC);
  const closeTime = daySchedule.close_time.substring(0, 5); // ej. "20:00"

  console.log(`[Find Slots] Buscando ${MAX_SUGGESTIONS} slots libres a partir de ${currentSlotUTC.toISOString()}`);

  while (suggestions.length < MAX_SUGGESTIONS) {
    // Avanzar al siguiente slot (ej. 15:00 -> 15:30)
    currentSlotUTC.setMinutes(currentSlotUTC.getMinutes() + SLOT_INCREMENT_MINUTES);

    // --- Validación 1: ¿Se pasa de la hora de cierre? ---
    const slotEndUTC = new Date(currentSlotUTC.getTime() + (totalDuration * 60000));
    const slotEndLocal = toZonedTime(slotEndUTC, businessTimezone);
    const slotEndTimeStr = format(slotEndLocal, 'HH:mm', { timeZone: businessTimezone });

    if (slotEndTimeStr > closeTime) {
      console.log(`[Find Slots] Búsqueda detenida: ${slotEndTimeStr} supera la hora de cierre (${closeTime})`);
      break; // Detener la búsqueda si nos pasamos del cierre
    }

    // --- Validación 2: ¿Tiene capacidad este nuevo slot? ---
    const capacityCheck = await checkSlotCapacity(
      restaurantId,
      currentSlotUTC,
      totalDuration,
      dateStr, // Pasamos la fecha local (YYYY-MM-DD)
      businessTimezone
    );

    if (capacityCheck.available) {
      const slotStartTimeLocal = toZonedTime(currentSlotUTC, businessTimezone);
      const timeStr = format(slotStartTimeLocal, 'HH:mm', { timeZone: businessTimezone });
      console.log(`[Find Slots] ✅ Slot libre encontrado: ${timeStr}`);
      suggestions.push(timeStr);
    } else {
      console.log(`[Find Slots] ❌ Slot ocupado a las ${format(toZonedTime(currentSlotUTC, businessTimezone), 'HH:mm', { timeZone: businessTimezone })}`);
    }

    // Seguridad para evitar bucles infinitos (ej. si el día está lleno)
    if (currentSlotUTC.getHours() > 23) {
      break;
    }
  }

  return suggestions;
}

// ================================================================
// GET ALL APPOINTMENTS
// ================================================================
export async function getAppointments(req, res) {
  try {
    const { date, status } = req.query;
    const businessId = req.business.id;

    let query = supabase
      .from('appointments')
      .select(`
        *,
        services (
          id,
          name,
          price,
          duration_minutes
        )
      `)
      .eq('restaurant_id', businessId)
      .order('scheduled_date', { ascending: true });

    if (date) {
      const startOfDay = `${date}T00:00:00Z`;
      const endOfDay = `${date}T23:59:59Z`;
      query = query.gte('scheduled_date', startOfDay).lte('scheduled_date', endOfDay);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error obteniendo citas:', error);
      return res.status(500).json({ error: 'Error obteniendo citas' });
    }

    // Agregar conteo de servicios
    const appointmentsWithServicesCount = await Promise.all(
      data.map(async (appointment) => {
        const { count } = await supabase
          .from('appointment_services')
          .select('*', { count: 'exact', head: true })
          .eq('appointment_id', appointment.id);

        return {
          ...appointment,
          services_count: count || 0,
        };
      })
    );

    res.json({ appointments: appointmentsWithServicesCount });

  } catch (error) {
    console.error('Error en getAppointments:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// GET TODAY'S APPOINTMENTS
// ================================================================

export async function getTodayAppointments(req, res) {
  try {
    const businessId = req.business.id;

    // 1. Cargar el timezone del negocio
    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('timezone')
      .eq('id', businessId)
      .single();

    if (businessError) throw businessError;
    const businessTimezone = business?.timezone || 'Europe/Madrid';

    // 2. Calcular inicio y fin del día en el timezone del negocio
    const now = new Date();
    const dayStartUTC = fromZonedTime(startOfDay(now), businessTimezone);
    const dayEndUTC = fromZonedTime(endOfDay(now), businessTimezone);

    // 3. Consultar las citas
    const { data, error } = await supabase
      .from('appointments')
      .select(`
        *,
        services (
          id,
          name,
          price,
          duration_minutes
        )
      `)
      .eq('restaurant_id', businessId)
      .gte('appointment_time', dayStartUTC.toISOString())
      .lte('appointment_time', dayEndUTC.toISOString())
      .order('appointment_time', { ascending: true });

    if (error) {
      console.error('Error obteniendo citas de hoy:', error);
      return res.status(500).json({ error: 'Error obteniendo citas' });
    }

    //  Agregar conteo de servicios a cada cita
    const appointmentsWithServicesCount = await Promise.all(
      data.map(async (appointment) => {
        const { count } = await supabase
          .from('appointment_services')
          .select('*', { count: 'exact', head: true })
          .eq('appointment_id', appointment.id);

        return {
          ...appointment,
          services_count: count || 0,
        };
      })
    );

    res.json({ appointments: appointmentsWithServicesCount });

  } catch (error) {
    console.error('Error en getTodayAppointments:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// CHECK AVAILABILITY 
// ================================================================

export async function checkAvailability(req, res) {
  try {
    const businessId = req.business.id;
    const { date, time, duration_minutes = 60, services } = req.body;

    const totalDuration = services && services.length > 0
      ? services.reduce((sum, s) => sum + (s.durationMinutes || 60), 0)
      : duration_minutes;

    if (!date || !time) {
      return res.status(400).json({ error: 'Fecha y hora son requeridas' });
    }

    // Cargar restaurant con timezone y config
    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('timezone, config')
      .eq('id', businessId)
      .single();

    if (businessError || !business) {
      console.error('Error cargando negocio:', businessError);
      return res.status(500).json({ error: 'Error cargando configuración del negocio' });
    }

    const timezone = business?.timezone || 'Europe/Madrid';

    // Obtener capacidad de config
    let maxCapacity = 1;
    if (business.config && typeof business.config === 'object') {
      maxCapacity = business.config.max_appointments_per_slot || 1;
    } else if (typeof business.config === 'string') {
      try {
        const configParsed = JSON.parse(business.config);
        maxCapacity = configParsed.max_appointments_per_slot || 1;
      } catch (e) {
        console.warn('[Availability] Error parsing config:', e);
      }
    }

    const requestedDateObj = parseISO(date);
    const dayOfWeek = requestedDateObj.getDay();

    // ========================================
    // VERIFICAR BLOQUEOS
    // ========================================
    const requestedStartLocal = new Date(`${date}T${time}:00`);
    const requestedEndLocal = new Date(requestedStartLocal.getTime() + totalDuration * 60000);
    
    const requestedStartUTC = fromZonedTime(requestedStartLocal, timezone);
    const requestedEndUTC = fromZonedTime(requestedEndLocal, timezone);

    const { data: blockedSlots, error: blockedError } = await supabase
      .from('blocked_slots')
      .select('*')
      .eq('restaurant_id', businessId)
      .eq('is_active', true)
      .is('table_id', null) // Solo bloqueos generales (no de mesas específicas)
      .or(`and(blocked_from.lte.${requestedEndUTC.toISOString()},blocked_until.gte.${requestedStartUTC.toISOString()})`);

    if (blockedError) {
      console.error('Error verificando bloqueos:', blockedError);
    }

    if (blockedSlots && blockedSlots.length > 0) {
      const block = blockedSlots[0];
      return res.json({
        available: false,
        has_conflict: false,
        is_blocked: true,
        is_within_business_hours: true,
        business_hours_message: block.reason || 'Este horario está bloqueado',
        block_type: block.block_type,
        suggested_times: []
      });
    }

    // ========================================
    // VERIFICAR HORARIOS DEL NEGOCIO
    // ========================================
    const { data: dayRules, error: rulesError } = await supabase
      .from('availability_rules')
      .select('open_time, close_time, is_closed')
      .eq('restaurant_id', businessId)
      .or(`specific_date.eq.${date},and(day_of_week.eq.${dayOfWeek},specific_date.is.null)`)
      .order('priority', { ascending: false })
      .limit(1)
      .single();

    if (rulesError && rulesError.code !== 'PGRST116') {
      console.error('Error cargando reglas:', rulesError);
      return res.status(500).json({ error: 'Error cargando reglas' });
    }

    const daySchedule = dayRules || { is_closed: true };

    if (daySchedule.is_closed) {
      const dayNames = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
      return res.json({
        available: false,
        is_within_business_hours: false,
        business_hours_message: `El negocio está cerrado los ${dayNames[dayOfWeek]}`,
        suggested_times: []
      });
    }

    const openTime = daySchedule.open_time;
    const closeTime = daySchedule.close_time;

    if (!openTime || !closeTime) {
      return res.json({ 
        available: false, 
        is_within_business_hours: false, 
        business_hours_message: 'Horario no configurado', 
        suggested_times: [] 
      });
    }

    // Normalizar horarios
    const [openHour, openMinute] = openTime.split(':').map(Number);
    const [closeHour, closeMinute] = closeTime.split(':').map(Number);
    const [requestedHour, requestedMinute] = time.split(':').map(Number);

    const requestedMinutes = requestedHour * 60 + requestedMinute;
    const openMinutes = openHour * 60 + openMinute;
    const closeMinutes = closeHour * 60 + closeMinute;

    if (requestedMinutes < openMinutes) {
      return res.json({
        available: false,
        is_within_business_hours: false,
        business_hours_message: `El horario de atención empieza a las ${openTime.substring(0, 5)}`,
        suggested_times: []
      });
    }

    const serviceEndMinutes = requestedMinutes + totalDuration;
    if (serviceEndMinutes > closeMinutes) {
      return res.json({
        available: false,
        is_within_business_hours: false,
        business_hours_message: `La cita terminaría después del cierre (${closeTime.substring(0, 5)})`,
        suggested_times: []
      });
    }

    // ========================================
    // VERIFICAR CAPACIDAD (CITAS EXISTENTES)
    // ========================================
    const startOfDayLocal = new Date(date + 'T00:00:00');
    const endOfDayLocal = new Date(date + 'T23:59:59');
    
    const startOfDayUTC = fromZonedTime(startOfDayLocal, timezone);
    const endOfDayUTC = fromZonedTime(endOfDayLocal, timezone);

    const { data: appointments, error: appointmentsError } = await supabase
      .from('appointments')
      .select('appointment_time, duration_minutes')
      .eq('restaurant_id', businessId)
      .gte('appointment_time', startOfDayUTC.toISOString())
      .lte('appointment_time', endOfDayUTC.toISOString())
      .in('status', ['confirmado', 'pendiente']);

    if (appointmentsError) {
      console.error('Error obteniendo citas:', appointmentsError);
    }

    // Convertir citas de UTC a hora local
    const busyBlocks = (appointments || []).map(apt => {
      const startUTC = new Date(apt.appointment_time);
      const startLocal = toZonedTime(startUTC, timezone);
      const endLocal = new Date(startLocal.getTime() + (apt.duration_minutes || 60) * 60000);
      return { start: startLocal, end: endLocal };
    });

    // Verificar capacidad minuto a minuto
    let maxConcurrentFound = 0;
    let isSlotAvailable = true;

    for (let minute = 0; minute < totalDuration; minute++) {
      const checkTime = new Date(requestedStartLocal.getTime() + minute * 60000);
      
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

    // Si NO está disponible, buscar sugerencias
    if (!isSlotAvailable) {
      const suggestedTimes = [];
      const SLOT_INTERVAL = 15;
      
      let currentTime = new Date(date);
      currentTime.setHours(openHour, openMinute, 0, 0);
      
      const closeDateTime = new Date(date);
      closeDateTime.setHours(closeHour, closeMinute, 0, 0);

      while (currentTime < closeDateTime && suggestedTimes.length < 5) {
        const serviceEnd = new Date(currentTime.getTime() + totalDuration * 60000);
        
        if (serviceEnd > closeDateTime) break;

        // Verificar bloqueos para esta sugerencia
        const suggestedStartUTC = fromZonedTime(currentTime, timezone);
        const suggestedEndUTC = fromZonedTime(serviceEnd, timezone);

        const { data: suggestedBlocks } = await supabase
          .from('blocked_slots')
          .select('id')
          .eq('restaurant_id', businessId)
          .eq('is_active', true)
          .is('table_id', null)
          .or(`and(blocked_from.lte.${suggestedEndUTC.toISOString()},blocked_until.gte.${suggestedStartUTC.toISOString()})`);

        // Si está bloqueado, saltar
        if (suggestedBlocks && suggestedBlocks.length > 0) {
          currentTime = new Date(currentTime.getTime() + SLOT_INTERVAL * 60000);
          continue;
        }

        // Verificar capacidad minuto a minuto
        let slotAvailable = true;
        for (let minute = 0; minute < totalDuration; minute++) {
          const checkTime = new Date(currentTime.getTime() + minute * 60000);
          
          const active = busyBlocks.filter(block => {
            return checkTime >= block.start && checkTime < block.end;
          }).length;

          if (active >= maxCapacity) {
            slotAvailable = false;
            break;
          }
        }

        if (slotAvailable) {
          const hours = currentTime.getHours();
          const minutes = currentTime.getMinutes();
          suggestedTimes.push(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
        }

        currentTime = new Date(currentTime.getTime() + SLOT_INTERVAL * 60000);
      }

      return res.json({
        available: false,
        has_conflict: true,
        is_within_business_hours: true,
        business_hours_message: `Capacidad máxima alcanzada (${maxConcurrentFound}/${maxCapacity})`,
        suggested_times: suggestedTimes
      });
    }

    // Slot disponible
    res.json({
      available: true,
      has_conflict: false,
      is_within_business_hours: true,
      business_hours_message: 'Slot disponible',
      suggested_times: []
    });

  } catch (error) {
    console.error('Error en checkAvailability:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// CREATE APPOINTMENT
// ================================================================

export async function createAppointment(req, res) {
  try {
    const {
      clientName,
      clientPhone,
      clientEmail,
      scheduledDate,
      appointmentTime,
      services,
      notes,
      serviceName,
      serviceId,
      durationMinutes,
      tablePreference, // Para restaurantes
    } = req.body;

    const restaurantId = req.business.id;

    if (!clientName || !clientPhone || !scheduledDate || !appointmentTime) {
      return res.status(400).json({
        error: 'Nombre, teléfono, fecha y hora son requeridos',
      });
    }

    if (clientEmail && !clientEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return res.status(400).json({
        error: 'El formato del email no es válido',
      });
    }

    const servicesList = services && services.length > 0
      ? services
      : (serviceId ? [{ serviceId, serviceName, durationMinutes }] : []);

    if (servicesList.length === 0) {
      return res.status(400).json({
        error: 'Debe seleccionar al menos un servicio',
      });
    }

    const totalDuration = servicesList.reduce((sum, s) => sum + (s.durationMinutes || 60), 0);

    // 🔧 CARGAR restaurant con timezone y config
    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('timezone, config, business_type')
      .eq('id', restaurantId)
      .single();

    if (businessError || !business) {
      console.error('Error cargando negocio:', businessError);
      return res.status(500).json({ error: 'Error cargando configuración del negocio' });
    }

    const timezone = business?.timezone || 'Europe/Madrid';
    const isRestaurant = business?.business_type === 'restaurant';

    // 🔧 CONVERTIR fecha/hora local a UTC correctamente
    const appointmentDateTime = getUTCFromLocal(
      scheduledDate,
      appointmentTime,
      timezone
    );

    const scheduledDateOnly = `${scheduledDate}T00:00:00Z`;

    console.log('📅 Creando cita:');
    console.log('Input Local:', scheduledDate, appointmentTime);
    console.log('Timezone:', timezone);
    console.log('Saving appointment_time (UTC):', appointmentDateTime.toISOString());

    // Verificación de disponibilidad
    console.log(`[Create Check] Verificando capacidad para ${restaurantId}`);

    const availabilityCheck = await checkSlotCapacity(
      restaurantId,
      appointmentDateTime,
      totalDuration
    );

    if (!availabilityCheck.available) {
      console.warn(`[Create Check] CONFLICT 409: ${availabilityCheck.reason}`);
      return res.status(409).json({
        error: 'Este horario ya no está disponible. Por favor, selecciona otro.',
        reason: availabilityCheck.reason
      });
    }

    console.log('[Create Check] Slot disponible. Procediendo a crear cita.');

    // PASO 1: Buscar o crear cliente
    let customerId;
    const { data: existingCustomer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('phone', clientPhone)
      .single();

    if (existingCustomer && !customerError) {
      customerId = existingCustomer.id;

      if (clientEmail) {
        await supabase
          .from('customers')
          .update({
            email: clientEmail,
            name: clientName,
            updated_at: new Date().toISOString()
          })
          .eq('id', customerId);
      }
    } else {
      const { data: newCustomer, error: createError } = await supabase
        .from('customers')
        .insert({
          restaurant_id: restaurantId,
          name: clientName,
          phone: clientPhone,
          email: clientEmail || null,
        })
        .select()
        .single();

      if (createError) throw createError;
      customerId = newCustomer.id;
    }

    // 🆕 ASIGNACIÓN AUTOMÁTICA DE MESA (solo para restaurantes)
    let assignedTableId = null;
    let assignmentReason = null;

    if (isRestaurant) {
      console.log('[Appointment] Restaurante detectado - Asignando mesa...');
      
      // Importar dinámicamente para evitar circular dependency
      const { tableAssignmentEngine } = await import('../services/restaurant/tableAssignmentEngine.js');
      
      const assignmentResult = await tableAssignmentEngine.findBestTable({
        restaurantId,
        date: scheduledDate,
        time: appointmentTime,
        partySize: parseInt(req.body.partySize || 2),
        duration: totalDuration,
        preference: tablePreference,
      });

      if (assignmentResult.success) {
        assignedTableId = assignmentResult.table.id;
        assignmentReason = assignmentResult.reason;
        console.log('[Appointment] Mesa asignada:', assignmentReason);
      } else {
        console.warn('[Appointment] No se pudo asignar mesa:', assignmentResult.message);
      }
    }

    // PASO 2: Crear cita principal
    const appointmentInsert = {
      restaurant_id: restaurantId,
      client_name: clientName,
      client_phone: clientPhone,
      client_email: clientEmail || null,
      scheduled_date: scheduledDateOnly,
      appointment_time: appointmentDateTime.toISOString(), // ✅ USA LA CONVERSIÓN UTC
      service_name: servicesList[0].serviceName,
      service_id: servicesList[0].serviceId || null,
      duration_minutes: totalDuration,
      notes: notes || null,
      status: 'confirmado',
      customer_id: customerId,
      table_id: assignedTableId, // 🆕 Asignar mesa
    };

    // 🆕 Agregar party_size solo para restaurantes
    if (isRestaurant) {
      appointmentInsert.party_size = parseInt(req.body.partySize || 2);
    }

    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .insert(appointmentInsert)
      .select()
      .single();

    if (appointmentError) throw appointmentError;

    // PASO 3: Insertar servicios en appointment_services
    const appointmentServicesData = servicesList.map((service, index) => ({
      appointment_id: appointment.id,
      service_id: service.serviceId || null,
      service_name: service.serviceName,
      duration_minutes: service.durationMinutes || 60,
      price: service.price || 0,
      display_order: index,
    }));

    const { error: servicesError } = await supabase
      .from('appointment_services')
      .insert(appointmentServicesData);

    if (servicesError) {
      console.error('Error insertando servicios:', servicesError);
      await supabase.from('appointments').delete().eq('id', appointment.id);
      throw servicesError;
    }

    // 🆕 PASO 4: Crear registro de asignación de mesa si aplica
    if (assignedTableId && isRestaurant) {
      await supabase
        .from('table_assignments')
        .insert({
          appointment_id: appointment.id,
          table_id: assignedTableId,
          assigned_by: req.user?.id || null,
          assignment_type: 'automatic',
        });
    }

    // PASO 5: Enviar email de confirmación
    console.log('📧 Enviando email de confirmación...');
    
    try {
      await emailService.sendAppointmentConfirmation({
        customer_name: clientName,
        customer_email: clientEmail,
        appointment_date: scheduledDate,
        appointment_time: appointmentTime,
        business_name: req.business.name,
        business_address: req.business.address || 'Dirección no disponible',
        business_phone: req.business.phone || 'Teléfono no disponible',
        services: servicesList,
        total_duration: totalDuration,
      });
      
      await supabase
        .from('appointments')
        .update({ confirmation_sent_at: new Date().toISOString() })
        .eq('id', appointment.id);

      console.log('✅ Email de confirmación enviado');
    } catch (emailError) {
      console.error('❌ Error enviando email:', emailError);
    }

    // Respuesta
    const response = {
      appointment,
      message: 'Cita creada exitosamente',
    };

    // 🆕 Agregar info de mesa si se asignó
    if (assignedTableId && isRestaurant) {
      const { data: tableInfo } = await supabase
        .from('tables')
        .select('table_number, table_type')
        .eq('id', assignedTableId)
        .single();

      response.tableAssignment = {
        tableNumber: tableInfo?.table_number,
        tableType: tableInfo?.table_type,
        reason: assignmentReason,
      };
    }

    res.status(201).json(response);

  } catch (error) {
    console.error('Error en createAppointment:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// UPDATE APPOINTMENT STATUS
// ================================================================
export async function updateAppointmentStatus(req, res) {
  try {
    const { appointmentId } = req.params;
    const { status } = req.body;
    const businessId = req.business.id;

    const validStatuses = ['pendiente', 'confirmado', 'cancelada', 'completada', 'no_show'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Estado inválido',
        validStatuses
      });
    }

    const { data: appointment, error: checkError } = await supabase
      .from('appointments')
      .select('id')
      .eq('id', appointmentId)
      .eq('restaurant_id', businessId)
      .single();

    if (checkError || !appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const updates = { status, updated_at: new Date().toISOString() };

    if (status === 'confirmado') {
      updates.confirmed_at = new Date().toISOString();
    }

    if (status === 'cancelada') {
      updates.cancelled_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('appointments')
      .update(updates)
      .eq('id', appointmentId)
      .select()
      .single();

    if (error) {
      console.error('Error actualizando cita:', error);
      return res.status(500).json({ error: 'Error actualizando cita' });
    }

    res.json({ appointment: data });

  } catch (error) {
    console.error('Error en updateAppointmentStatus:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// DELETE APPOINTMENT
// ================================================================
export async function deleteAppointment(req, res) {
  try {
    const { appointmentId } = req.params;
    const businessId = req.business.id;

    const { data: appointment, error: checkError } = await supabase
      .from('appointments')
      .select('id')
      .eq('id', appointmentId)
      .eq('restaurant_id', businessId)
      .single();

    if (checkError || !appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', appointmentId);

    if (error) {
      console.error('Error eliminando cita:', error);
      return res.status(500).json({ error: 'Error eliminando cita' });
    }

    res.json({ message: 'Cita eliminada correctamente' });

  } catch (error) {
    console.error('Error en deleteAppointment:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// GET APPOINTMENT STATS
// ================================================================
export async function getAppointmentStats(req, res) {
  try {
    const businessId = req.business.id;

    const now = new Date();
    const madridDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
    const today = madridDate.toISOString().split('T')[0];

    const startOfDay = `${today}T00:00:00Z`;
    const endOfDay = `${today}T23:59:59Z`;

    const { data: todayStats, error: todayError } = await supabase
      .from('appointments')
      .select('status, duration_minutes')
      .eq('restaurant_id', businessId)
      .gte('scheduled_date', startOfDay)
      .lte('scheduled_date', endOfDay);

    if (todayError) {
      console.error('Error obteniendo stats:', todayError);
      return res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }

    const stats = {
      today: {
        total: todayStats.length,
        pendiente: todayStats.filter(a => a.status === 'pendiente').length,
        confirmado: todayStats.filter(a => a.status === 'confirmado').length,
        completada: todayStats.filter(a => a.status === 'completada').length,
        cancelada: todayStats.filter(a => a.status === 'cancelada').length,
        no_show: todayStats.filter(a => a.status === 'no_show').length,
        totalMinutes: todayStats.reduce((sum, a) => sum + (a.duration_minutes || 0), 0),
      }
    };

    res.json(stats);

  } catch (error) {
    console.error('Error en getAppointmentStats:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// GET APPOINTMENT BY ID (DETALLE)
// ================================================================
export async function getAppointmentById(req, res) {
  try {
    const { appointmentId } = req.params;
    const businessId = req.business.id;

    // Obtener la cita con información del servicio principal
    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .select(`
        *,
        services (
          id,
          name,
          price,
          duration_minutes
        )
      `)
      .eq('id', appointmentId)
      .eq('restaurant_id', businessId)
      .single();

    if (appointmentError || !appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    // ✅ NUEVO: Obtener todos los servicios asociados a la cita
    const { data: appointmentServices, error: servicesError } = await supabase
      .from('appointment_services')
      .select('*')
      .eq('appointment_id', appointmentId)
      .order('display_order', { ascending: true });

    if (servicesError) {
      console.error('Error obteniendo servicios de la cita:', servicesError);
    }

    // Buscar información del cliente por teléfono
    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('restaurant_id', businessId)
      .eq('phone', appointment.client_phone)
      .single();

    // Obtener historial de citas del cliente (últimas 5)
    const { data: customerHistory } = await supabase
      .from('appointments')
      .select('id, scheduled_date, appointment_time, service_name, status, amount_paid')
      .eq('restaurant_id', businessId)
      .eq('client_phone', appointment.client_phone)
      .neq('id', appointmentId)
      .order('scheduled_date', { ascending: false })
      .limit(5);

    res.json({
      appointment: {
        ...appointment,
        services: appointmentServices || [], // ✅ Agregar servicios
      },
      customer: customer || null,
      customerHistory: customerHistory || []
    });

  } catch (error) {
    console.error('Error en getAppointmentById:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}
// ================================================================
// UPDATE APPOINTMENT
// ================================================================
export async function updateAppointment(req, res) {
  try {
    const { appointmentId } = req.params;
    const businessId = req.business.id;
    const updateData = req.body;

    // Verificar que la cita pertenezca al negocio
    const { data: appointment, error: checkError } = await supabase
      .from('appointments')
      .select('id')
      .eq('id', appointmentId)
      .eq('restaurant_id', businessId)
      .single();

    if (checkError || !appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    // Actualizar cita
    const { data, error } = await supabase
      .from('appointments')
      .update({
        ...updateData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .select()
      .single();

    if (error) {
      console.error('Error actualizando cita:', error);
      return res.status(500).json({ error: 'Error actualizando cita' });
    }

    res.json({ appointment: data });

  } catch (error) {
    console.error('Error en updateAppointment:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};