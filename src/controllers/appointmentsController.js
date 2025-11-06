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
// CHECK AVAILABILITY (MODIFICADO)
// ================================================================
export async function checkAvailability(req, res) {
  try {
    const businessId = req.business.id;
    const { date, time, duration_minutes = 60, services } = req.body;

    const totalDuration = services && services.length > 0
      ? services.reduce((sum, s) => sum + (s.durationMinutes || 60), 0)
      : duration_minutes;

    if (!date || !time) {
      return res.status(400).json({
        error: 'Fecha y hora son requeridas'
      });
    }

    // 1. CARGAR TIMEZONE Y CONFIG DEL NEGOCIO
    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('timezone, config') // <-- MODIFICADO (ya lo tenías)
      .eq('id', businessId)
      .single();

    if (businessError || !business) {
      console.error('Error cargando negocio:', businessError);
      return res.status(500).json({ error: 'Error cargando configuración del negocio' });
    }

    const businessTimezone = business?.timezone || 'Europe/Madrid';

    // 2. OBTENER REGLA DE HORARIO DEL DÍA (Tu código - sin cambios)
    const requestedDateObj = parseISO(date);
    const dayOfWeek = requestedDateObj.getDay();

    const { data: dayRules, error: rulesError } = await supabase
      .from('availability_rules')
      .select('open_time, close_time, is_closed')
      .eq('restaurant_id', businessId)
      .eq('day_of_week', dayOfWeek)
      .is('specific_date', null)
      .order('priority', { ascending: false })
      .limit(1)
      .single();

    if (rulesError && rulesError.code !== 'PGRST116') { // No rows found
      console.error('Error cargando reglas de disponibilidad:', rulesError);
      return res.status(500).json({ error: 'Error cargando reglas de disponibilidad' });
    }

    const daySchedule = dayRules || { is_closed: true };

    // =======================================================================
    // ✅ PASO 1: VERIFICAR HORARIOS DEL NEGOCIO (Tu código - sin cambios)
    // =======================================================================

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

    const requestedTimeStr = time.substring(0, 5);
    const openTimeNormalized = openTime.substring(0, 5);
    const closeTimeNormalized = closeTime.substring(0, 5);

    if (requestedTimeStr < openTimeNormalized) {
      return res.json({
        available: false,
        is_within_business_hours: false,
        business_hours_message: `El horario de atención empieza a las ${openTimeNormalized}`,
        conflicting_appointment: null,
      });
    }

    // 3. CALCULAR HORA DE FIN DE CITA EN HORA LOCAL
    const requestedStartUTC = getUTCFromLocal(date, time, businessTimezone);
    const requestedEndUTC = new Date(requestedStartUTC.getTime() + (totalDuration * 60 * 1000));

    const requestedEndLocal = toZonedTime(requestedEndUTC, businessTimezone);
    const endTimeStr = format(requestedEndLocal, 'HH:mm', { timeZone: businessTimezone });

    if (endTimeStr > closeTimeNormalized) {
      return res.json({
        available: false,
        is_within_business_hours: false,
        business_hours_message: `La cita terminaría a las ${endTimeStr}, después del horario de cierre (${closeTimeNormalized})`,
        conflicting_appointment: null,
      });
    }

    // =======================================================================
    // ✅ PASO 2: VERIFICAR CONFLICTOS (Lógica 💡 MODIFICADA)
    // =======================================================================

    // Llamamos al nuevo helper centralizado
    const availabilityCheck = await checkSlotCapacity(
      businessId,
      requestedStartUTC,
      totalDuration
    );

    // Formatear la respuesta del helper
    let conflictingAppointmentData = null;
    if (availabilityCheck.conflicting_appointment) {
      const conflict = availabilityCheck.conflicting_appointment;
      const conflictStartUTC = new Date(conflict.appointment_time);

      conflictingAppointmentData = {
        id: conflict.id,
        client_name: conflict.client_name,
        service_name: conflict.service_name,
        // Devolvemos la hora en el timezone del negocio
        time: format(toZonedTime(conflictStartUTC, businessTimezone), 'HH:mm', { timeZone: businessTimezone }),
        duration: conflict.duration_minutes
      };
    }

    res.json({
      available: availabilityCheck.available,
      has_conflict: !availabilityCheck.available, // Inverso de 'available'
      is_within_business_hours: true,
      business_hours_message: availabilityCheck.available ? null : availabilityCheck.reason,
      conflicting_appointment: conflictingAppointmentData,
      // Opcional: puedes eliminar esta línea si ya no la usas en el frontend
      total_appointments_that_day: 0,
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

    // CARGAR TIMEZONE DEL NEGOCIO
    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('timezone')
      .eq('id', restaurantId)
      .single();

    if (businessError || !business) {
      return res.status(500).json({ error: 'Error cargando configuración del negocio' });
    }

    const businessTimezone = business?.timezone || 'Europe/Madrid';

    const appointmentDateTime = getUTCFromLocal(
      scheduledDate,
      appointmentTime,
      businessTimezone
    );

    const scheduledDateOnly = `${scheduledDate}T00:00:00Z`;

    console.log('📅 Creando cita:');
    console.log('Input Local:', scheduledDate, appointmentTime);
    console.log('Timezone:', businessTimezone);
    console.log('Saving appointment_time (UTC):', appointmentDateTime.toISOString());
    console.log('Saving scheduled_date:', scheduledDateOnly);

    // =======================================================================
    // ✅ 💡 PASO 0: DOBLE VERIFICACIÓN DE DISPONIBILIDAD
    // =======================================================================
    console.log(`[Create Check] Verificando capacidad para ${restaurantId} en ${appointmentDateTime.toISOString()}`);

    // Llama al helper 'checkSlotCapacity'
    const availabilityCheck = await checkSlotCapacity(
      restaurantId,
      appointmentDateTime,
      totalDuration
    );

    if (!availabilityCheck.available) {
      console.warn(`[Create Check] CONFLICT 409: ${availabilityCheck.reason}`);
      // Error 409: Conflicto
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

      //  Actualizar email si se proporciona
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

    // PASO 2: Crear cita principal
    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .insert({
        restaurant_id: restaurantId,
        client_name: clientName,
        client_phone: clientPhone,
        client_email: clientEmail || null,
        scheduled_date: scheduledDateOnly,
        appointment_time: appointmentDateTime.toISOString(),
        service_name: servicesList[0].serviceName,
        service_id: servicesList[0].serviceId || null,
        duration_minutes: totalDuration,
        notes: notes || null,
        status: 'confirmado',
        customer_id: customerId,
      })
      .select()
      .single();

    if (appointmentError) throw appointmentError;

    // Insertar servicios en appointment_services
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
      // Rollback: eliminar la cita si falla
      await supabase.from('appointments').delete().eq('id', appointment.id);
      throw servicesError;
    }

    console.log('✅ Cita creada con', servicesList.length, 'servicios');

    res.status(201).json({
      message: 'Cita creada correctamente',
      appointment: {
        ...appointment,
        services: servicesList,
      },
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