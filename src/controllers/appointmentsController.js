import { supabase } from '../config/database.js';

// ================================================================
// HELPER: Validar si hay conflictos de horario
// ================================================================
function hasTimeConflict(newStart, newEnd, existingStart, existingEnd) {
  const newStartTime = new Date(newStart).getTime();
  const newEndTime = new Date(newEnd).getTime();
  const existingStartTime = new Date(existingStart).getTime();
  const existingEndTime = new Date(existingEnd).getTime();
  
  // ✅ Lógica correcta: Hay conflicto si hay solapamiento
  // La nueva cita solapa si empieza antes de que termine la existente
  // Y termina después de que empiece la existente
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

    // Filtrar por fecha si se proporciona
    if (date) {
      const startOfDay = `${date}T00:00:00Z`;
      const endOfDay = `${date}T23:59:59Z`;
      query = query.gte('scheduled_date', startOfDay).lte('scheduled_date', endOfDay);
    }

    // Filtrar por estado si se proporciona
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
    
    // Obtener fecha actual en Madrid
    const now = new Date();
    const madridDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
    const today = madridDate.toISOString().split('T')[0];
    
    const startOfDay = `${today}T00:00:00Z`;
    const endOfDay = `${today}T23:59:59Z`;

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
      .gte('scheduled_date', startOfDay)
      .lte('scheduled_date', endOfDay)
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
    const { date, time, duration_minutes = 60 } = req.query;

    if (!date || !time) {
      return res.status(400).json({ 
        error: 'Fecha y hora son requeridas' 
      });
    }

    // ✅ CORRECCIÓN: Construir timestamp correcto
    // Si `time` viene como "12:30", construir ISO completo
    let requestedStart;
    
    if (time.includes(':')) {
      // Formato: "12:30" o "12:30:00"
      requestedStart = new Date(`${date}T${time.padEnd(8, ':00')}Z`);
    } else {
      // Formato: "12" (solo hora)
      requestedStart = new Date(`${date}T${time.padStart(2, '0')}:00:00Z`);
    }
    
    const requestedEnd = new Date(requestedStart.getTime() + (duration_minutes * 60 * 1000));

    console.log('=== Check Availability (DEBUG) ===');
    console.log('Input date:', date);
    console.log('Input time:', time);
    console.log('Input duration:', duration_minutes);
    console.log('Requested start (UTC):', requestedStart.toISOString());
    console.log('Requested end (UTC):', requestedEnd.toISOString());
    console.log('Requested start (timestamp):', requestedStart.getTime());
    console.log('Requested end (timestamp):', requestedEnd.getTime());

    // Buscar citas del mismo día (excluyendo canceladas)
    const { data: overlappingAppointments, error } = await supabase
      .from('appointments')
      .select('id, client_name, scheduled_date, appointment_time, duration_minutes, status, service_name')
      .eq('restaurant_id', businessId)
      .neq('status', 'cancelada')
      .gte('scheduled_date', `${date}T00:00:00Z`)
      .lte('scheduled_date', `${date}T23:59:59Z`);

    if (error) {
      console.error('Error checking availability:', error);
      return res.status(500).json({ error: 'Error verificando disponibilidad' });
    }

    console.log('Total appointments that day:', overlappingAppointments?.length || 0);

    // ✅ Verificar solapamientos
    let hasConflict = false;
    let conflictingAppointment = null;

    for (const apt of overlappingAppointments || []) {
      // ✅ USAR appointment_time, NO scheduled_date
      const aptStart = new Date(apt.appointment_time);
      const aptDuration = apt.duration_minutes || 60;
      const aptEnd = new Date(aptStart.getTime() + (aptDuration * 60 * 1000));

      console.log(`\nChecking: ${apt.client_name} - ${apt.service_name}`);
      console.log(`  Start (UTC): ${aptStart.toISOString()}`);
      console.log(`  End (UTC): ${aptEnd.toISOString()}`);
      console.log(`  Start (timestamp): ${aptStart.getTime()}`);
      console.log(`  End (timestamp): ${aptEnd.getTime()}`);
      console.log(`  Duration: ${aptDuration} min`);

      // ✅ Comparación de timestamps
      console.log(`  Comparison:`);
      console.log(`    requestedStart < aptEnd: ${requestedStart.getTime()} < ${aptEnd.getTime()} = ${requestedStart.getTime() < aptEnd.getTime()}`);
      console.log(`    requestedEnd > aptStart: ${requestedEnd.getTime()} > ${aptStart.getTime()} = ${requestedEnd.getTime() > aptStart.getTime()}`);

      if (hasTimeConflict(requestedStart, requestedEnd, aptStart, aptEnd)) {
        hasConflict = true;
        conflictingAppointment = {
          id: apt.id,
          client_name: apt.client_name,
          service_name: apt.service_name,
          time: aptStart.toISOString(),
          duration: aptDuration,
        };
        console.log('  ❌ CONFLICT DETECTED!');
        break;
      } else {
        console.log('  ✅ No conflict');
      }
    }

    // Obtener horario del negocio
    const { data: business } = await supabase
      .from('restaurants')
      .select('config')
      .eq('id', businessId)
      .single();

    let businessHours = null;
    if (business?.config?.business_hours_detailed) {
      businessHours = business.config.business_hours_detailed;
    }

    // Verificar si está dentro del horario de apertura
    const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][requestedStart.getUTCDay()];
    let isWithinBusinessHours = true;
    let businessHoursMessage = '';

    if (businessHours && businessHours[dayOfWeek]) {
      const daySchedule = businessHours[dayOfWeek];
      
      if (daySchedule.closed) {
        isWithinBusinessHours = false;
        businessHoursMessage = `El negocio está cerrado los ${dayOfWeek}`;
      } else if (daySchedule.open && daySchedule.close) {
        const requestedTime = time;
        if (requestedTime < daySchedule.open || requestedTime >= daySchedule.close) {
          isWithinBusinessHours = false;
          businessHoursMessage = `Horario de apertura: ${daySchedule.open} - ${daySchedule.close}`;
        }
      }
    }

    console.log('\n=== FINAL RESULT ===');
    console.log('Has conflict:', hasConflict);
    console.log('Within business hours:', isWithinBusinessHours);
    console.log('Available:', !hasConflict && isWithinBusinessHours);

    res.json({
      available: !hasConflict && isWithinBusinessHours,
      has_conflict: hasConflict,
      is_within_business_hours: isWithinBusinessHours,
      business_hours_message: businessHoursMessage,
      conflicting_appointment: conflictingAppointment,
      total_appointments_that_day: overlappingAppointments?.length || 0,
    });

  } catch (error) {
    console.error('Error en checkAvailability:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// CREATE APPOINTMENT (CON VALIDACIÓN DE CONFLICTOS)
// ================================================================
export async function createAppointment(req, res) {
  try {
    const businessId = req.business.id;
    const {
      clientName,
      clientPhone,
      scheduledDate,
      appointmentTime,
      serviceName,
      serviceId,
      durationMinutes = 60,
      notes,
      googleCalendarEventId,
    } = req.body;

    // Validaciones
    if (!clientName || !clientPhone) {
      return res.status(400).json({ 
        error: 'Nombre y teléfono del cliente son requeridos' 
      });
    }

    if (!scheduledDate || !appointmentTime) {
      return res.status(400).json({ 
        error: 'Fecha y hora son requeridas' 
      });
    }

    // VALIDAR CONFLICTOS ANTES DE CREAR
    const newStart = new Date(appointmentTime);
    const newEnd = new Date(newStart.getTime() + (durationMinutes * 60 * 1000));

    console.log('=== Create Appointment ===');
    console.log('New appointment:', clientName, '-', serviceName);
    console.log('Start:', newStart.toISOString());
    console.log('End:', newEnd.toISOString());
    console.log('Duration:', durationMinutes, 'min');

    // Obtener citas del mismo día
    const dayDate = newStart.toISOString().split('T')[0];
    const { data: existingAppointments, error: checkError } = await supabase
      .from('appointments')
      .select('id, client_name, service_name, appointment_time, duration_minutes')
      .eq('restaurant_id', businessId)
      .neq('status', 'cancelada')
      .gte('scheduled_date', `${dayDate}T00:00:00Z`)
      .lte('scheduled_date', `${dayDate}T23:59:59Z`);

    if (checkError) {
      console.error('Error checking conflicts:', checkError);
      return res.status(500).json({ error: 'Error verificando conflictos' });
    }

    console.log('Existing appointments that day:', existingAppointments?.length || 0);

    // Verificar conflictos
    for (const apt of existingAppointments || []) {
      const aptStart = new Date(apt.appointment_time);
      const aptDuration = apt.duration_minutes || 60;
      const aptEnd = new Date(aptStart.getTime() + (aptDuration * 60 * 1000));

      console.log(`Checking vs: ${apt.client_name} - ${apt.service_name}`);
      console.log(`  Their time: ${aptStart.toISOString()} - ${aptEnd.toISOString()}`);

      if (hasTimeConflict(newStart, newEnd, aptStart, aptEnd)) {
        console.log('  ❌ CONFLICT!');
        return res.status(409).json({
          error: 'Conflicto de horario',
          conflict: {
            client_name: apt.client_name,
            service_name: apt.service_name,
            time: aptStart.toISOString(),
            duration: aptDuration
          },
          message: `Ya existe una cita a esa hora: ${apt.client_name} - ${apt.service_name}`
        });
      } else {
        console.log('  ✅ No conflict');
      }
    }

    // No hay conflictos, crear la cita
    console.log('✅ No conflicts found, creating appointment...');

    // Buscar o crear conversación
    let conversationId = null;
    
    const { data: existingConv } = await supabase
      .from('conversations')
      .select('id')
      .eq('phone_number', clientPhone)
      .eq('restaurant_id', businessId)
      .single();

    if (existingConv) {
      conversationId = existingConv.id;
    } else {
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          phone_number: clientPhone,
          client_name: clientName,
          restaurant_id: businessId,
        })
        .select()
        .single();

      if (!convError && newConv) {
        conversationId = newConv.id;
      }
    }

    // Crear la cita
    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .insert({
        restaurant_id: businessId,
        conversation_id: conversationId,
        client_name: clientName,
        client_phone: clientPhone,
        scheduled_date: scheduledDate,
        appointment_time: appointmentTime,
        service_name: serviceName,
        service_id: serviceId,
        duration_minutes: durationMinutes,
        notes: notes || '',
        status: 'confirmado',
        google_calendar_event_id: googleCalendarEventId,
        sync_calendar: !!googleCalendarEventId,
      })
      .select(`
        *,
        services (
          id,
          name,
          price,
          duration_minutes
        )
      `)
      .single();

    if (appointmentError) {
      console.error('Error creando cita:', appointmentError);
      return res.status(500).json({ error: 'Error creando cita' });
    }

    console.log('✅ Appointment created successfully:', appointment.id);

    res.status(201).json({ appointment });

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

    // Actualizar estado
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

    // Eliminar cita
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
    
    // Obtener fecha actual en Madrid
    const now = new Date();
    const madridDate = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
    const today = madridDate.toISOString().split('T')[0];
    
    const startOfDay = `${today}T00:00:00Z`;
    const endOfDay = `${today}T23:59:59Z`;

    // Contar citas de hoy por estado
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
};