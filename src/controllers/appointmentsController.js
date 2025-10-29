import { supabase } from '../config/database.js';
import { createRequire } from 'module';
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

    res.json({ appointments: data });

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
    const now = new Date(); // 'now' siempre es UTC

    // Obtiene el inicio del día (00:00) en 'Europe/Madrid' y lo convierte a UTC
    const dayStartUTC = fromZonedTime(startOfDay(now), businessTimezone);

    // Obtiene el fin del día (23:59) en 'Europe/Madrid' y lo convierte a UTC
    const dayEndUTC = fromZonedTime(endOfDay(now), businessTimezone);

    // 3. Consultar la BD con el rango UTC correcto
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

    res.json({ appointments: data });

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
    const { date, time, duration_minutes = 60 } = req.body;

    if (!date || !time) {
      return res.status(400).json({
        error: 'Fecha y hora son requeridas'
      });
    }

    // 1. CARGAR TIMEZONE DEL NEGOCIO (Sigue consultando 'restaurants')
    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('timezone') // Solo necesitamos el timezone de 'restaurants'
      .eq('id', businessId)
      .single();

    if (businessError || !business) {
      console.error('Error cargando negocio:', businessError);
      return res.status(500).json({ error: 'Error cargando configuración del negocio' });
    }

    const businessTimezone = business?.timezone || 'Europe/Madrid';

    // 2. OBTENER REGLA DE HORARIO DEL DÍA (Nueva Consulta a availability_rules)

    const requestedDateObj = parseISO(date);
    // JS Date.getDay() retorna 0 (Domingo) a 6 (Sábado), que coincide con la DB 
    const dayOfWeek = requestedDateObj.getDay();

    const { data: dayRules, error: rulesError } = await supabase
      .from('availability_rules')
      .select('open_time, close_time, is_closed')
      .eq('restaurant_id', businessId)
      .eq('day_of_week', dayOfWeek)
      .is('specific_date', null) // Solo reglas regulares
      .order('priority', { ascending: false }) // En caso de tener varias reglas, usa la de mayor prioridad
      .limit(1)
      .single();

    if (rulesError && rulesError.code !== 'PGRST116') { // PGRST116: No rows found
      console.error('Error cargando reglas de disponibilidad:', rulesError);
      return res.status(500).json({ error: 'Error cargando reglas de disponibilidad' });
    }

    const daySchedule = dayRules || { is_closed: true };

    console.log('Day of week:', dayOfWeek);
    console.log('Day schedule:', daySchedule);


    // =======================================================================
    // ✅ PASO 1: VERIFICAR HORARIOS DEL NEGOCIO (Lógica Adaptada)
    // =======================================================================

    // Verificar si el negocio está cerrado ese día
    if (daySchedule.is_closed) {
      const dayNameES = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

      return res.json({
        available: false,
        is_within_business_hours: false,
        business_hours_message: `El negocio está cerrado los ${dayNameES[dayOfWeek]}`,
        conflicting_appointment: null,
      });
    }

    const openTime = daySchedule.open_time;
    const closeTime = daySchedule.close_time;

    if (!openTime || !closeTime) {
      return res.json({
        available: false,
        is_within_business_hours: false,
        business_hours_message: 'Horario no configurado para este día',
        conflicting_appointment: null,
      });
    }

    // Usar el tiempo solicitado (HH:MM) para comparar directamente con la BD (time without timezone)
    const requestedTimeStr = time.includes(':') ? time : `${time.padStart(2, '0')}:00`;

    console.log('Comparing times:');
    console.log('  Requested:', requestedTimeStr);
    console.log('  Open:', openTime);
    console.log('  Close:', closeTime);

    // 💡 VERIFICACIÓN DE INICIO: La hora de inicio debe ser mayor o igual que la de apertura.
    if (requestedTimeStr < openTime) {
      return res.json({
        available: false,
        is_within_business_hours: false,
        business_hours_message: `El horario de atención empieza a las ${openTime}`,
        conflicting_appointment: null,
      });
    }

    // 3. CALCULAR HORA DE FIN DE CITA EN HORA LOCAL
    const requestedStartUTC = getUTCFromLocal(date, time, businessTimezone);
    const requestedEndUTC = new Date(requestedStartUTC.getTime() + (duration_minutes * 60 * 1000));

    // Convertir la hora de fin de la cita de vuelta a la hora local (HH:MM) para comparar con closeTime (HH:MM)
    const requestedEndLocal = toZonedTime(requestedEndUTC, businessTimezone);
    const endTimeStr = format(requestedEndLocal, 'HH:mm', { timeZone: businessTimezone });


    console.log('  End time local:', endTimeStr);

    // 💡 VERIFICACIÓN DE FIN: La hora de finalización debe ser menor o igual que la de cierre.
    if (endTimeStr > closeTime) {
      return res.json({
        available: false,
        is_within_business_hours: false,
        business_hours_message: `La cita terminaría a las ${endTimeStr}, después del horario de cierre (${closeTime})`,
        conflicting_appointment: null,
      });
    }

    // =======================================================================
    // ✅ PASO 2: VERIFICAR CONFLICTOS CON OTRAS CITAS (Lógica Timezone OK)
    // =======================================================================

    const dayStartInTimezone = startOfDay(requestedDateObj);
    const dayStartUTC = fromZonedTime(dayStartInTimezone, businessTimezone);
    const dayEndInTimezone = endOfDay(requestedDateObj);
    const dayEndUTC = fromZonedTime(dayEndInTimezone, businessTimezone);

    const { data: overlappingAppointments, error } = await supabase
      .from('appointments')
      .select('id, client_name, appointment_time, duration_minutes, status, service_name')
      .eq('restaurant_id', businessId)
      .neq('status', 'cancelada')
      .gte('appointment_time', dayStartUTC.toISOString())
      .lte('appointment_time', dayEndUTC.toISOString());

    // ... (manejo de error, loop de hasTimeConflict, y respuesta final) ...

    if (error) {
      console.error('Error checking availability:', error);
      return res.status(500).json({ error: 'Error verificando disponibilidad' });
    }

    let hasConflict = false;
    let conflictingAppointment = null;

    for (const apt of overlappingAppointments || []) {
      const aptStart = new Date(apt.appointment_time);
      const aptDuration = apt.duration_minutes || 60;
      const aptEnd = new Date(aptStart.getTime() + (aptDuration * 60 * 1000));

      if (hasTimeConflict(requestedStartUTC, requestedEndUTC, aptStart, aptEnd)) {
        hasConflict = true;
        conflictingAppointment = {
          id: apt.id,
          client_name: apt.client_name,
          service_name: apt.service_name,
          // Deberías convertir la hora de inicio de la cita en conflicto a la hora local para el frontend:
          time: format(toZonedTime(aptStart, businessTimezone), 'HH:mm', { timeZone: businessTimezone }),
          duration: aptDuration,
        };
        console.log('❌ CONFLICT DETECTED with:', apt.id, 'at', apt.appointment_time);
        break;
      }
    }

    res.json({
      available: !hasConflict,
      has_conflict: hasConflict,
      is_within_business_hours: true, // Se llega aquí si se pasó la validación de horarios
      business_hours_message: null,
      conflicting_appointment: conflictingAppointment,
      total_appointments_that_day: overlappingAppointments?.length || 0,
    });

  } catch (error) {
    console.error('Error en checkAvailability:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// CREATE APPOINTMENT
// ================================================================
// ================================================================
// CREATE APPOINTMENT (CORREGIDO)
// ================================================================
export async function createAppointment(req, res) {
  try {
    const {
      clientName,
      clientPhone,
      scheduledDate, // ej: "2025-10-29"
      appointmentTime, // ej: "13:00"
      serviceName,
      serviceId,
      durationMinutes,
      notes,
    } = req.body;

    const restaurantId = req.business.id;

    if (!clientName || !clientPhone || !scheduledDate || !appointmentTime) {
      return res.status(400).json({
        error: 'Nombre, teléfono, fecha y hora son requeridos',
      });
    }

    // ✅ CARGAR TIMEZONE DEL NEGOCIO
    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('timezone')
      .eq('id', restaurantId)
      .single();

    if (businessError || !business) {
      return res.status(500).json({ error: 'Error cargando configuración del negocio' });
    }

    const businessTimezone = business?.timezone || 'Europe/Madrid';
    // Convertir la hora local a UTC usando el timezone
    const appointmentDateTime = getUTCFromLocal(
      scheduledDate,
      appointmentTime,
      businessTimezone
    );
    // Usar la fecha "local" que nos llegó para la columna `scheduled_date`
    // Convertimos a Date para que Supabase la trate como timestamptz a medianoche
    const scheduledDateOnly = parseISO(scheduledDate);

    console.log('📅 Creando cita (Corregido):');
    console.log('Input Local:', scheduledDate, appointmentTime);
    console.log('Timezone:', businessTimezone);
    console.log('Saving appointment_time (UTC):', appointmentDateTime.toISOString());
    console.log('Saving scheduled_date (UTC):', scheduledDateOnly.toISOString());

    // PASO 1: Buscar o crear cliente (Tu lógica es correcta)
    let customerId;
    let isNewCustomer = false;
    // ... (tu lógica de cliente) ...
    const { data: existingCustomer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('phone', clientPhone)
      .single();

    if (existingCustomer && !customerError) {
      customerId = existingCustomer.id;
      // ... (updates)
    } else {
      isNewCustomer = true;
      // ... (insert)
      const { data: newCustomer, error: createError } = await supabase
        .from('customers')
        .insert({
          restaurant_id: restaurantId,
          Fname: clientName,
          phone: clientPhone,
        })
        .select()
        .single();
      if (createError) throw createError;
      customerId = newCustomer.id;
    }


    // PASO 2: Crear cita
    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .insert({
        restaurant_id: restaurantId,
        client_name: clientName,
        client_phone: clientPhone,
        scheduled_date: scheduledDateOnly.toISOString(),     // Columna de día
        appointment_time: appointmentDateTime.toISOString(), // Columna de hora exacta
        service_name: serviceName,
        service_id: serviceId,
        duration_minutes: durationMinutes || 60,
        notes: notes || null,
        status: 'confirmado',
        customer_id: customerId,
      })
      .select()
      .single();

    if (appointmentError) throw appointmentError;

    res.status(201).json({
      message: 'Cita creada correctamente',
      appointment,
    });
  } catch (error) {
    console.error('❌ Error creando cita:', error);
    res.status(500).json({ error: 'Error al crear la cita' });
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

    // Obtener la cita con información del servicio
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
      appointment,
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