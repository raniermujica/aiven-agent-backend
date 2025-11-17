import { supabase } from '../config/database.js';
import { tableAssignmentEngine } from '../services/restaurant/tableAssignmentEngine.js';

/**
 * Obtener todas las reservas/citas
 */
export async function getReservations(req, res) {
  try {
    const businessId = req.business.id;
    const { date, status } = req.query;

    let query = supabase
      .from('appointments')
      .select(`
        *,
        customers (
          id,
          name,
          phone,
          email,
          is_vip
        ),
        tables (
          id,
          table_number,
          table_type,
          capacity
        )
      `)
      .eq('restaurant_id', businessId)
      .order('appointment_time', { ascending: true });

    if (date) {
      query = query.eq('scheduled_date', date);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data: appointments, error } = await query;

    if (error) {
      console.error('Error obteniendo citas:', error);
      return res.status(500).json({ error: 'Error obteniendo citas' });
    }

    res.json({ appointments });

  } catch (error) {
    console.error('Error en getReservations:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

/**
 * Obtener reservas/citas de hoy
 */
export async function getTodayReservations(req, res) {
  try {
    const businessId = req.business.id;
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('appointments')
      .select(`
        *,
        customers (
          id,
          name,
          phone,
          email,
          is_vip
        ),
        tables (
          id,
          table_number,
          table_type,
          capacity
        )
      `)
      .eq('restaurant_id', businessId)
      .gte('scheduled_date', today)
      .lt('scheduled_date', new Date(Date.now() + 86400000).toISOString().split('T')[0])
      .order('appointment_time', { ascending: true });

    if (error) {
      console.error('Error obteniendo citas de hoy:', error);
      return res.status(500).json({ error: 'Error obteniendo citas' });
    }

    res.json({ appointments: data });

  } catch (error) {
    console.error('Error en getTodayReservations:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

/**
 * Crear nueva reserva/cita
 */
export async function createReservation(req, res) {
  try {
    const businessId = req.business.id;
    const {
      customerId,
      customerName,
      customerPhone,
      customerEmail,
      reservationDate,
      reservationTime,
      partySize,
      tableId,
      serviceId,
      specialOccasion,
      specialRequests,
      source = 'manual',
      tablePreference,
    } = req.body;

    if (!reservationDate || !reservationTime || !partySize) {
      return res.status(400).json({ 
        error: 'Fecha, hora y número de personas son requeridos' 
      });
    }

    // Verificar si es restaurante
    const { data: business } = await supabase
      .from('restaurants')
      .select('business_type')
      .eq('id', businessId)
      .single();

    const isRestaurant = business?.business_type === 'restaurant';

    let finalCustomerId = customerId;

    // Crear o buscar cliente
    if (!finalCustomerId) {
      if (!customerName || !customerPhone) {
        return res.status(400).json({ 
          error: 'Nombre y teléfono del cliente son requeridos' 
        });
      }

      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('id')
        .eq('restaurant_id', businessId)
        .eq('phone', customerPhone)
        .single();

      if (existingCustomer) {
        finalCustomerId = existingCustomer.id;
      } else {
        const { data: newCustomer, error: customerError } = await supabase
          .from('customers')
          .insert({
            restaurant_id: businessId,
            name: customerName,
            phone: customerPhone,
            email: customerEmail,
            first_visit_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (customerError) {
          console.error('Error creando cliente:', customerError);
          return res.status(500).json({ error: 'Error creando cliente' });
        }

        finalCustomerId = newCustomer.id;
      }
    }

    // Asignación automática de mesa (solo para restaurantes)
    let assignedTableId = tableId;
    let assignmentReason = null;

    if (isRestaurant && !tableId) {
      console.log('[Reservation] Asignando mesa automáticamente...');
      
      const assignmentResult = await tableAssignmentEngine.findBestTable({
        restaurantId: businessId,
        date: reservationDate,
        time: reservationTime,
        partySize: parseInt(partySize),
        duration: 90,
        preference: tablePreference,
      });

      if (assignmentResult.success) {
        assignedTableId = assignmentResult.table.id;
        assignmentReason = assignmentResult.reason;
        console.log('[Reservation] Mesa asignada:', assignmentReason);
      } else {
        console.warn('[Reservation] No se pudo asignar mesa:', assignmentResult.message);
      }
    }

    // Crear cita en appointments (no reservations)
    const appointmentData = {
      restaurant_id: businessId,
      customer_id: finalCustomerId,
      table_id: assignedTableId,
      service_id: serviceId,
      scheduled_date: new Date(reservationDate).toISOString(),
      appointment_time: new Date(`${reservationDate}T${reservationTime}:00Z`).toISOString(),
      client_name: customerName,
      client_phone: customerPhone,
      client_email: customerEmail,
      service_name: specialRequests || 'Reserva',
      duration_minutes: 90,
      party_size: partySize,
      special_occasion: specialOccasion,
      notes: specialRequests,
      status: 'pendiente',
      source,
      created_by: req.user.id,
    };

    const { data: appointment, error } = await supabase
      .from('appointments')
      .insert(appointmentData)
      .select(`
        *,
        customers (
          id,
          name,
          phone,
          email,
          is_vip
        ),
        tables (
          id,
          table_number,
          table_type,
          capacity
        )
      `)
      .single();

    if (error) {
      console.error('Error creando cita:', error);
      return res.status(500).json({ error: 'Error creando cita' });
    }

    // Crear registro de asignación si hay mesa
    if (assignedTableId && isRestaurant) {
      await supabase
        .from('table_assignments')
        .insert({
          appointment_id: appointment.id,
          table_id: assignedTableId,
          assigned_by: req.user.id,
          assignment_type: tableId ? 'manual' : 'automatic',
        });
    }

    res.status(201).json({ 
      reservation: appointment, // Mantener nombre "reservation" para compatibilidad con frontend
      tableAssignment: assignmentReason ? {
        tableNumber: appointment.tables?.table_number,
        reason: assignmentReason,
      } : null,
    });

  } catch (error) {
    console.error('Error en createReservation:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

/**
 * Actualizar estado de reserva/cita
 */
export async function updateReservationStatus(req, res) {
  try {
    const businessId = req.business.id;
    const { reservationId } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Estado es requerido' });
    }

    const validStatuses = ['pendiente', 'confirmado', 'completada', 'cancelada', 'no_show'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    // Verificar que la cita pertenece al restaurante
    const { data: existing } = await supabase
      .from('appointments')
      .select('id')
      .eq('id', reservationId)
      .eq('restaurant_id', businessId)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const updateData = { 
      status,
      updated_at: new Date().toISOString()
    };

    // Si se marca como confirmado, guardar timestamp
    if (status === 'confirmado') {
      updateData.confirmed_at = new Date().toISOString();
    }

    // Si se cancela, guardar timestamp
    if (status === 'cancelada') {
      updateData.cancelled_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('appointments')
      .update(updateData)
      .eq('id', reservationId)
      .select()
      .single();

    if (error) {
      console.error('Error actualizando estado:', error);
      return res.status(500).json({ error: 'Error actualizando estado' });
    }

    res.json({ reservation: data });

  } catch (error) {
    console.error('Error en updateReservationStatus:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

/**
 * Obtener estadísticas de reservas/citas
 */
export async function getReservationStats(req, res) {
  try {
    const businessId = req.business.id;
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('appointments')
      .select('status, party_size')
      .eq('restaurant_id', businessId)
      .gte('scheduled_date', today);

    if (error) {
      console.error('Error obteniendo estadísticas:', error);
      return res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }

    const stats = {
      today: {
        total: data.length,
        pendiente: data.filter(r => r.status === 'pendiente').length,
        confirmado: data.filter(r => r.status === 'confirmado').length,
        completada: data.filter(r => r.status === 'completada').length,
        cancelada: data.filter(r => r.status === 'cancelada').length,
        totalCovers: data.reduce((sum, r) => sum + (r.party_size || 1), 0),
      }
    };

    res.json(stats);

  } catch (error) {
    console.error('Error en getReservationStats:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

/**
 * Obtener citas para el calendario
 */
export async function getCalendarReservations(req, res) {
  try {
    const businessId = req.business.id;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ 
        error: 'Se requieren startDate y endDate' 
      });
    }

    const { data: appointments, error } = await supabase
      .from('appointments')
      .select(`
        *,
        customers (
          id,
          name,
          phone,
          email,
          is_vip
        ),
        tables (
          id,
          table_number,
          table_type,
          capacity
        )
      `)
      .eq('restaurant_id', businessId)
      .gte('scheduled_date', startDate)
      .lte('scheduled_date', endDate)
      .order('appointment_time', { ascending: true });

    if (error) {
      console.error('Error obteniendo citas del calendario:', error);
      return res.status(500).json({ error: 'Error obteniendo citas' });
    }

    const formattedReservations = appointments.map(apt => ({
      id: apt.id,
      customerName: apt.customers?.name || apt.client_name,
      customerPhone: apt.customers?.phone || apt.client_phone,
      isVip: apt.customers?.is_vip || false,
      service: apt.service_name || 'Reserva',
      date: apt.scheduled_date,
      time: new Date(apt.appointment_time).toLocaleTimeString('es-ES', { 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Europe/Madrid'
      }),
      duration: apt.duration_minutes || 90,
      status: apt.status,
      partySize: apt.party_size,
      tableNumber: apt.tables?.table_number,
      specialRequests: apt.notes
    }));

    res.json({ 
      reservations: formattedReservations,
      count: formattedReservations.length 
    });

  } catch (error) {
    console.error('Error en getCalendarReservations:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};