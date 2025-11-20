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

// ================================================================
// CHECK AVAILABILITY 
// ================================================================

export async function checkAvailability(req, res) {
  try {
    const businessId = req.business.id;
    const { date, time, duration_minutes = 60, services } = req.body;

    if (!date || !time) {
      return res.status(400).json({ error: 'Fecha y hora son requeridas' });
    }

    // ✅ CALCULAR DURACIÓN TOTAL
    const totalDuration = services && services.length > 0
      ? services.reduce((sum, s) => sum + (s.durationMinutes || 60), 0)
      : duration_minutes;

    // ✅ CARGAR NEGOCIO CON TIMEZONE Y TIPO
    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('timezone, config, business_type')
      .eq('id', businessId)
      .single();

    if (businessError || !business) {
      console.error('Error cargando negocio:', businessError);
      return res.status(500).json({ error: 'Error cargando configuración del negocio' });
    }

    const timezone = business?.timezone || 'Europe/Madrid';
    const isRestaurant = business?.business_type === 'restaurant';

    console.log(`\n[CHECK AVAILABILITY] Tipo de negocio: ${business.business_type}`);
    console.log(`[CHECK AVAILABILITY] Es restaurante: ${isRestaurant}`);
    console.log(`[CHECK AVAILABILITY] Duración total: ${totalDuration} minutos`);

    // ✅ BIFURCACIÓN: RESTAURANTES vs OTROS NICHOS
    if (isRestaurant) {
      return await checkAvailabilityForRestaurant(req, res, {
        business,
        businessId,
        date,
        time,
        totalDuration,
        timezone
      });
    } else {
      return await checkAvailabilityForBeauty(req, res, {
        business,
        businessId,
        date,
        time,
        totalDuration,
        timezone,
        services
      });
    }

  } catch (error) {
    console.error('Error en checkAvailability:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// CHECK AVAILABILITY - RESTAURANTES (con asignación de mesas)
// ================================================================
async function checkAvailabilityForRestaurant(req, res, params) {
  const { business, businessId, date, time, totalDuration, timezone } = params;

  console.log('[RESTAURANT] Verificando disponibilidad con algoritmo de mesas...');

  // Aquí va tu lógica actual de restaurantes (asignación de mesas, etc.)
  // Por ahora mantengo la estructura básica

  const requestedDateObj = parseISO(date);
  const dayOfWeek = requestedDateObj.getDay();

  // Obtener reglas de disponibilidad
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

  // Verificar horario de apertura/cierre
  const openTime = daySchedule.open_time || '10:00:00';
  const closeTime = daySchedule.close_time || '20:00:00';

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

  // Lógica de mesas para restaurantes (mantén tu algoritmo actual)
  // ...

  return res.json({
    available: true,
    has_conflict: false,
    is_within_business_hours: true,
    business_hours_message: 'Slot disponible',
    suggested_times: []
  });
}

// ================================================================
// CHECK AVAILABILITY - BEAUTY/OTROS NICHOS (Lógica estricta por duración de servicio)
// ================================================================

async function checkAvailabilityForBeauty(req, res, params) {
  const { business, businessId, date, time, totalDuration, timezone, services } = params;

  console.log('[BEAUTY] Verificando disponibilidad...');
  console.log(`[BEAUTY] Servicios: ${services?.length || 0} | Duración Total: ${totalDuration} min`);
  console.log(`[BEAUTY] Timezone Negocio: ${timezone}`);

  const requestedDateObj = parseISO(date);
  const dayOfWeek = requestedDateObj.getDay();

  // 1. VERIFICAR REGLAS DE APERTURA (Días cerrados, horarios especiales)
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
    return res.status(500).json({ error: 'Error cargando reglas de horario' });
  }

  const daySchedule = dayRules || { is_closed: true };

  if (daySchedule.is_closed) {
    const dayNames = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
    return res.json({
      available: false,
      is_within_business_hours: false,
      business_hours_message: `Cerrado los ${dayNames[dayOfWeek]}`,
      suggested_times: []
    });
  }

  // 2. VERIFICAR LÍMITES DE HORARIO (Apertura / Cierre)
  const openTime = daySchedule.open_time || '09:00:00';
  const closeTime = daySchedule.close_time || '20:00:00';

  const [openHour, openMinute] = openTime.split(':').map(Number);
  const [closeHour, closeMinute] = closeTime.split(':').map(Number);
  const [requestedHour, requestedMinute] = time.split(':').map(Number);

  const requestedMinutes = requestedHour * 60 + requestedMinute;
  const openMinutes = openHour * 60 + openMinute;
  const closeMinutes = closeHour * 60 + closeMinute;

  // La cita no puede empezar antes de abrir
  if (requestedMinutes < openMinutes) {
    return res.json({
      available: false,
      is_within_business_hours: false,
      business_hours_message: `Abrimos a las ${openTime.substring(0, 5)}`,
      suggested_times: []
    });
  }

  // La cita no puede terminar después de cerrar (IMPORTANTE para servicios largos)
  const serviceEndMinutes = requestedMinutes + totalDuration;
  if (serviceEndMinutes > closeMinutes) {
    return res.json({
      available: false,
      is_within_business_hours: false,
      business_hours_message: `El servicio dura ${totalDuration} min y terminaría después del cierre (${closeTime.substring(0, 5)})`,
      suggested_times: []
    });
  }

  // 3. OBTENER CAPACIDAD (Personal / Sillas disponibles)
  // En Beauty, max_capacity suele ser el número de estilistas o sillas simultáneas.
  let maxCapacity = 1; 
  if (business.config) {
    if (typeof business.config === 'object') {
      maxCapacity = business.config.max_appointments_per_slot || 1;
    } else if (typeof business.config === 'string') {
      try {
        const parsed = JSON.parse(business.config);
        maxCapacity = parsed.max_appointments_per_slot || 1;
      } catch (e) {}
    }
  }

  // 4. OBTENER CITAS EXISTENTES (Bloqueo de agenda)
  // Usamos date-fns-tz para definir el inicio y fin del día en la zona horaria correcta
  const startOfDayLocalStr = `${date}T00:00:00`;
  const endOfDayLocalStr = `${date}T23:59:59`;

  // Convertir a UTC para consultar la base de datos
  const startOfDayUTC = fromZonedTime(startOfDayLocalStr, timezone);
  const endOfDayUTC = fromZonedTime(endOfDayLocalStr, timezone);

  const { data: appointments, error: appointmentsError } = await supabase
    .from('appointments')
    .select('appointment_time, duration_minutes')
    .eq('restaurant_id', businessId)
    .gte('appointment_time', startOfDayUTC.toISOString())
    .lte('appointment_time', endOfDayUTC.toISOString())
    .in('status', ['confirmado', 'pendiente']);

  if (appointmentsError) {
    console.error('Error consultando citas:', appointmentsError);
    return res.status(500).json({ error: 'Error verificando agenda' });
  }

  // 5. MAPEAR CITAS A BLOQUES DE TIEMPO LOCALES
  // Convertimos todo a objetos Date locales para comparar matemáticamente
  const busyBlocks = (appointments || []).map(apt => {
    const startUTC = new Date(apt.appointment_time);
    const startLocal = toZonedTime(startUTC, timezone); // Convertir UTC -> Hora Local Negocio
    const duration = apt.duration_minutes || 60; // Fallback solo si la cita no tiene duración guardada
    const endLocal = new Date(startLocal.getTime() + duration * 60000);
    return { start: startLocal, end: endLocal };
  });

  // 6. VALIDAR EL SLOT SOLICITADO (Minuto a minuto)
  const localDateTimeString = `${date}T${time}:00`;
  const requestedStartUTC = fromZonedTime(localDateTimeString, timezone); // UTC Real del slot pedido
  const requestedStartLocal = toZonedTime(requestedStartUTC, timezone); // Hora local equivalente
  
  let maxConcurrentFound = 0;

  // Barremos cada minuto de la duración del servicio solicitado
  for (let minute = 0; minute < totalDuration; minute += 5) { // Optimización: paso de 5 min
    const checkTime = new Date(requestedStartLocal.getTime() + minute * 60000);

    // Contar cuántas citas están activas en este minuto específico
    const activeAppointments = busyBlocks.filter(block => {
      return checkTime >= block.start && checkTime < block.end;
    }).length;

    if (activeAppointments > maxConcurrentFound) {
      maxConcurrentFound = activeAppointments;
    }

    // Si en algún momento superamos la capacidad, el slot no es válido
    if (activeAppointments >= maxCapacity) {
      console.log(`[BEAUTY] Slot ocupado a las ${checkTime.getHours()}:${checkTime.getMinutes()}`);
      
      // Generar sugerencias (opcional, lógica simplificada aquí)
      return res.json({
        available: false,
        has_conflict: true,
        is_within_business_hours: true,
        business_hours_message: 'Lo sentimos, no hay personal disponible en ese horario.',
        suggested_times: [] // Aquí podrías implementar la búsqueda de huecos libres
      });
    }
  }

  // Si llegamos aquí, el slot es válido
  return res.json({
    available: true,
    has_conflict: false,
    is_within_business_hours: true,
    business_hours_message: 'Horario disponible',
    suggested_times: []
  });
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
      tablePreference, 
      partySize // Asegurarnos de recibir esto
    } = req.body;

    const restaurantId = req.business.id;

    // 1. VALIDACIONES BÁSICAS
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

    // 2. CARGAR NEGOCIO (MOVIDO AL PRINCIPIO PARA SABER EL TIPO)
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

    // 3. PREPARAR SERVICIOS (Lógica condicional)
    let servicesList = services && services.length > 0
      ? services
      : (serviceId ? [{ serviceId, serviceName, durationMinutes }] : []);

    // VALIDACIÓN DE SERVICIOS: Solo si NO es restaurante
    if (!isRestaurant && servicesList.length === 0) {
      return res.status(400).json({
        error: 'Debe seleccionar al menos un servicio',
      });
    }

    // SI ES RESTAURANTE y no hay servicios, crear uno dummy para consistencia
    if (isRestaurant && servicesList.length === 0) {
      servicesList = [{
        serviceName: 'Reserva de Mesa',
        durationMinutes: durationMinutes || 90, // Default 90 min para restaurantes si no viene nada
        price: 0
      }];
    }

    const totalDuration = servicesList.reduce((sum, s) => sum + (s.durationMinutes || 60), 0);

    // 4. CONVERTIR fecha/hora local a UTC correctamente
    const appointmentDateTime = getUTCFromLocal(
      scheduledDate,
      appointmentTime,
      timezone
    );

    const scheduledDateOnly = `${scheduledDate}T00:00:00Z`;

    console.log('📅 Creando cita (Tipo:', isRestaurant ? 'Restaurante' : 'Beauty', '):');
    console.log('Input Local:', scheduledDate, appointmentTime);
    console.log('Saving appointment_time (UTC):', appointmentDateTime.toISOString());

    // 5. VERIFICAR DISPONIBILIDAD (Solo capacidad general o mesas)
    if (isRestaurant) {
       // Para restaurantes, la disponibilidad se chequea al buscar mesa (más abajo)
       // Opcional: podrías hacer un chequeo rápido de aforo aquí si quisieras
    } else {
       // Para Beauty, chequeamos slots
       const availabilityCheck = await checkSlotCapacity(
        restaurantId,
        appointmentDateTime,
        totalDuration
      );

      if (!availabilityCheck.available) {
        return res.status(409).json({
          error: 'Este horario ya no está disponible.',
          reason: availabilityCheck.reason
        });
      }
    }

    // PASO 6: Buscar o crear cliente
    let customerId;
    const { data: existingCustomer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('phone', clientPhone)
      .single();

    if (existingCustomer && !customerError) {
      customerId = existingCustomer.id;
      // Actualizar email/nombre si cambiaron
      if (clientEmail || clientName !== existingCustomer.name) {
        await supabase.from('customers').update({
            email: clientEmail || existingCustomer.email,
            name: clientName,
            updated_at: new Date().toISOString()
          }).eq('id', customerId);
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

    // PASO 7: ASIGNACIÓN AUTOMÁTICA DE MESA (Solo Restaurantes)
    let assignedTableId = null;
    let assignmentReason = null;

    if (isRestaurant) {
      console.log('[Appointment] Restaurante detectado - Asignando mesa...');
      
      // Importar dinámicamente
      const { tableAssignmentEngine } = await import('../services/restaurant/tableAssignmentEngine.js');

      const finalPartySize = parseInt(partySize || req.body.partySize || 2);

      const assignmentResult = await tableAssignmentEngine.findBestTable({
        restaurantId,
        date: scheduledDate,
        time: appointmentTime,
        partySize: finalPartySize,
        duration: totalDuration,
        preference: tablePreference,
      });

      if (assignmentResult.success) {
        assignedTableId = assignmentResult.table.id;
        assignmentReason = assignmentResult.reason;
        console.log('[Appointment] Mesa asignada:', assignmentReason);
      } else {
        console.warn('[Appointment] No se pudo asignar mesa:', assignmentResult.message);
        // Opcional: Si es estricto, podrías retornar error aquí:
        // return res.status(409).json({ error: 'No hay mesas disponibles' });
      }
    }

    // PASO 8: Crear cita principal
    const appointmentInsert = {
      restaurant_id: restaurantId,
      customer_id: customerId,
      table_id: assignedTableId,
      scheduled_date: scheduledDateOnly,
      appointment_time: appointmentDateTime.toISOString(),
      client_name: clientName,
      client_phone: clientPhone,
      client_email: clientEmail || null,
      // Usar el nombre del primer servicio o "Reserva"
      service_name: servicesList[0].serviceName || 'Reserva', 
      service_id: servicesList[0].serviceId || null,
      duration_minutes: totalDuration,
      notes: notes || null,
      status: 'confirmado',
      source: 'manual', // O lo que venga en body
      created_by: req.user?.id || null,
    };

    if (isRestaurant) {
      appointmentInsert.party_size = parseInt(partySize || 2);
    }

    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .insert(appointmentInsert)
      .select()
      .single();

    if (appointmentError) throw appointmentError;

    // PASO 9: Insertar servicios en appointment_services
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
      // No borramos la cita, pero logueamos el error
    }

    // PASO 10: Crear registro de asignación de mesa
    if (assignedTableId && isRestaurant) {
      await supabase.from('table_assignments').insert({
        appointment_id: appointment.id,
        table_id: assignedTableId,
        assigned_by: req.user?.id || null,
        assignment_type: 'automatic',
      });
    }

    // PASO 11: Enviar email (Opcional, no bloqueante)
    // ... (código de email existente) ...

    // Respuesta
    const response = {
      appointment,
      message: 'Cita creada exitosamente',
    };

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
    res.status(500).json({ error: 'Error en el servidor', details: error.message });
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
    ),
    tables (
      id,
      table_number,
      table_type,
      capacity
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
}

/**
 * Mark customer as "Seated" (Check-in)
 */
export async function checkInAppointment(req, res) {
  try {
    const { appointmentId } = req.params;
    const businessId = req.business.id;

    // Verify appointment belongs to restaurant
    const { data: appointment, error: checkError } = await supabase
      .from('appointments')
      .select('id, status, table_id')
      .eq('id', appointmentId)
      .eq('restaurant_id', businessId)
      .single();

    if (checkError || !appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Update status
    const { data, error } = await supabase
      .from('appointments')
      .update({
        checked_in_at: new Date().toISOString(),
        status: 'confirmado', // Keep confirmed but with checked_in_at
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .select()
      .single();

    if (error) {
      console.error('Error checking in:', error);
      return res.status(500).json({ error: 'Error updating appointment' });
    }

    res.json({
      message: 'Customer marked as seated',
      appointment: data,
    });

  } catch (error) {
    console.error('Error in checkInAppointment:', error);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * Mark customer as "Left" (Check-out)
 */
export async function checkOutAppointment(req, res) {
  try {
    const { appointmentId } = req.params;
    const businessId = req.business.id;

    // Verify appointment belongs to restaurant
    const { data: appointment, error: checkError } = await supabase
      .from('appointments')
      .select('id, status')
      .eq('id', appointmentId)
      .eq('restaurant_id', businessId)
      .single();

    if (checkError || !appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Update status to completed
    const { data, error } = await supabase
      .from('appointments')
      .update({
        checked_out_at: new Date().toISOString(),
        status: 'completada',
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .select()
      .single();

    if (error) {
      console.error('Error checking out:', error);
      return res.status(500).json({ error: 'Error updating appointment' });
    }

    res.json({
      message: 'Customer checked out, table is now free',
      appointment: data,
    });

  } catch (error) {
    console.error('Error in checkOutAppointment:', error);
    res.status(500).json({ error: 'Server error' });
  }
};