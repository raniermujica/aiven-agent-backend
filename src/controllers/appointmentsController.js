import { supabase } from '../config/database.js';

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
// CREATE APPOINTMENT
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
      durationMinutes,
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

    // Buscar o crear conversación
    let conversationId = null;
    
    // Buscar conversación existente por teléfono
    const { data: existingConv } = await supabase
      .from('conversations')
      .select('id')
      .eq('phone_number', clientPhone)
      .eq('restaurant_id', businessId)
      .single();

    if (existingConv) {
      conversationId = existingConv.id;
    } else {
      // Crear nueva conversación
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
        duration_minutes: durationMinutes || 60,
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

    // Si se marca como confirmada
    if (status === 'confirmado') {
      updates.confirmed_at = new Date().toISOString();
    }

    // Si se marca como cancelada
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