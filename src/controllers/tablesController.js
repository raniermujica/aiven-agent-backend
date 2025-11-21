import { supabase } from '../config/database.js';
import { tableAssignmentEngine } from '../services/restaurant/tableAssignmentEngine.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { toZonedTime, format } = require('date-fns-tz');

// Helper para obtener zona horaria del negocio
async function getBusinessTimezone(restaurantId) {
  const { data } = await supabase
    .from('restaurants')
    .select('timezone')
    .eq('id', restaurantId)
    .single();
  return data?.timezone || 'Europe/Madrid';
}

/**
 * Obtener todas las mesas de un restaurante
 */
export async function getTables(req, res) {
  try {
    const businessId = req.business.id;

    const { data: tables, error } = await supabase
      .from('tables')
      .select('*')
      .eq('restaurant_id', businessId)
      .order('table_number', { ascending: true });

    if (error) {
      console.error('Error obteniendo mesas:', error);
      return res.status(500).json({ error: 'Error obteniendo mesas' });
    }

    res.json({ tables });
  } catch (error) {
    console.error('Error en getTables:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};

/**
 * Crear una nueva mesa
 */
export async function createTable(req, res) {
    // ... (El código de createTable se mantiene igual)
    // Copia tu código existente de createTable aquí
    // Para ahorrar espacio, asumo que no cambia
    try {
        const businessId = req.business.id;
        const {
          table_number,
          table_type,
          capacity,
          min_capacity,
          priority,
          auto_assignable,
          notes,
          location,
          position_x,
          position_y
        } = req.body;
    
        if (!table_number || !capacity) {
          return res.status(400).json({ 
            error: 'Número de mesa y capacidad son requeridos' 
          });
        }
    
        // Verificar que no exista mesa con ese número
        const { data: existing } = await supabase
          .from('tables')
          .select('id')
          .eq('restaurant_id', businessId)
          .eq('table_number', table_number)
          .single();
    
        if (existing) {
          return res.status(400).json({ 
            error: `Ya existe una mesa con el número ${table_number}` 
          });
        }
    
        const { data: table, error } = await supabase
          .from('tables')
          .insert({
            restaurant_id: businessId,
            table_number,
            table_type: table_type || 'salon',
            capacity,
            min_capacity: min_capacity || 1,
            priority: priority || 0,
            auto_assignable: auto_assignable !== false,
            status: 'available',
            notes,
            location,
            position_x,
            position_y,
            is_active: true
          })
          .select()
          .single();
    
        if (error) {
          console.error('Error creando mesa:', error);
          return res.status(500).json({ error: 'Error creando mesa' });
        }
    
        res.status(201).json({ table });
      } catch (error) {
        console.error('Error en createTable:', error);
        res.status(500).json({ error: 'Error en el servidor' });
      }
}

/**
 * Actualizar una mesa
 */
export async function updateTable(req, res) {
    // ... (Mantener igual)
    try {
        const businessId = req.business.id;
        const { id } = req.params;
        const {
          table_number,
          table_type,
          capacity,
          min_capacity,
          priority,
          auto_assignable,
          status,
          notes,
          location,
          position_x,
          position_y,
          is_active
        } = req.body;
    
        // Verificar que la mesa pertenece al restaurante
        const { data: existing, error: checkError } = await supabase
          .from('tables')
          .select('id')
          .eq('id', id)
          .eq('restaurant_id', businessId)
          .single();
    
        if (checkError || !existing) {
          return res.status(404).json({ error: 'Mesa no encontrada' });
        }
    
        const updateData = {};
        if (table_number !== undefined) updateData.table_number = table_number;
        if (table_type !== undefined) updateData.table_type = table_type;
        if (capacity !== undefined) updateData.capacity = capacity;
        if (min_capacity !== undefined) updateData.min_capacity = min_capacity;
        if (priority !== undefined) updateData.priority = priority;
        if (auto_assignable !== undefined) updateData.auto_assignable = auto_assignable;
        if (status !== undefined) updateData.status = status;
        if (notes !== undefined) updateData.notes = notes;
        if (location !== undefined) updateData.location = location;
        if (position_x !== undefined) updateData.position_x = position_x;
        if (position_y !== undefined) updateData.position_y = position_y;
        if (is_active !== undefined) updateData.is_active = is_active;
    
        const { data: table, error } = await supabase
          .from('tables')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();
    
        if (error) {
          console.error('Error actualizando mesa:', error);
          return res.status(500).json({ error: 'Error actualizando mesa' });
        }
    
        res.json({ table });
      } catch (error) {
        console.error('Error en updateTable:', error);
        res.status(500).json({ error: 'Error en el servidor' });
      }
}

/**
 * Eliminar una mesa
 */
export async function deleteTable(req, res) {
    // ... (Mantener igual)
    try {
        const businessId = req.business.id;
        const { id } = req.params;
    
        // Verificar que la mesa pertenece al restaurante
        const { data: existing, error: checkError } = await supabase
          .from('tables')
          .select('id')
          .eq('id', id)
          .eq('restaurant_id', businessId)
          .single();
    
        if (checkError || !existing) {
          return res.status(404).json({ error: 'Mesa no encontrada' });
        }
    
        // Verificar que no tenga reservas futuras
        const { data: futureReservations, error: resError } = await supabase
          .from('reservations')
          .select('id')
          .eq('table_id', id)
          .in('status', ['pending', 'confirmed'])
          .gte('reservation_date', new Date().toISOString().split('T')[0]);
    
        if (resError) {
          console.error('Error verificando reservas:', resError);
          return res.status(500).json({ error: 'Error verificando reservas' });
        }
    
        if (futureReservations && futureReservations.length > 0) {
          return res.status(400).json({ 
            error: 'No se puede eliminar una mesa con reservas futuras' 
          });
        }
    
        // Soft delete
        const { error } = await supabase
          .from('tables')
          .update({ is_active: false })
          .eq('id', id);
    
        if (error) {
          console.error('Error eliminando mesa:', error);
          return res.status(500).json({ error: 'Error eliminando mesa' });
        }
    
        res.json({ message: 'Mesa eliminada correctamente' });
      } catch (error) {
        console.error('Error en deleteTable:', error);
        res.status(500).json({ error: 'Error en el servidor' });
      }
}

/**
 * Asignar mesa automáticamente
 */
export async function assignTable(req, res) {
   // ... (Mantener igual)
   try {
    const businessId = req.business.id;
    const {
      date,
      time,
      partySize,
      duration,
      preference
    } = req.body;

    if (!date || !time || !partySize) {
      return res.status(400).json({ 
        error: 'Fecha, hora y número de personas son requeridos' 
      });
    }

    // Buscar mejor mesa
    const result = await tableAssignmentEngine.findBestTable({
      restaurantId: businessId,
      date,
      time,
      partySize,
      duration: duration || 90,
      preference
    });

    if (!result.success) {
      return res.status(404).json({ 
        message: result.message,
        suggestedTimes: result.suggestedTimes || []
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Error en assignTable:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

/**
 * Obtener estado de mesas para un día específico (CORREGIDO TIMEZONE)
 */
export async function getTableStatus(req, res) {
  try {
    const businessId = req.business.id;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Fecha es requerida' });
    }

    // Obtener Timezone del negocio
    const timezone = await getBusinessTimezone(businessId);

    // Obtener todas las mesas
    const { data: tables, error: tablesError } = await supabase
      .from('tables')
      .select('*')
      .eq('restaurant_id', businessId)
      .eq('is_active', true);

    if (tablesError) throw tablesError;

    // Obtener citas del día (Todo el día en UTC para cubrir todos los husos)
    // Optimizamos pidiendo un rango amplio (-1 día / +1 día) y filtrando después si es necesario,
    // o confiamos en que date-fns hace bien el filtrado en el front, 
    // pero aquí pedimos el día específico
    const { data: appointments, error: appError } = await supabase
      .from('appointments')
      .select(`
        id,
        table_id,
        appointment_time,
        duration_minutes,
        party_size,
        status,
        client_name,
        client_phone,
        checked_in_at,
        customers (name, phone)
      `)
      .eq('restaurant_id', businessId)
      .gte('scheduled_date', date)
      .lte('scheduled_date', date)
      .in('status', ['pendiente', 'confirmado']);

    if (appError) throw appError;

    // Agrupar reservas por mesa CON CORRECCIÓN HORARIA
    const tableStatus = tables.map(table => {
      const tableReservations = (appointments || [])
        .filter(r => r.table_id === table.id)
        .map(r => {
          // 2. CORRECCIÓN: Convertir UTC de BD a Hora Local del Negocio
          const utcDate = new Date(r.appointment_time);
          const zonedDate = toZonedTime(utcDate, timezone);
          const timeStr = format(zonedDate, 'HH:mm', { timeZone: timezone });

          return {
            id: r.id,
            time: timeStr, // Ahora envía "21:00" en vez de "20:00"
            duration: r.duration_minutes,
            partySize: r.party_size,
            status: r.status,
            customerName: r.customers?.name || r.client_name,
            customerPhone: r.customers?.phone || r.client_phone
          };
        });

      return {
        ...table,
        reservations: tableReservations,
        isOccupied: tableReservations.some(r => r.status === 'confirmado' && appointments.find(a => a.id === r.id)?.checked_in_at),
        nextReservation: tableReservations[0] || null
      };
    });

    res.json({ tables: tableStatus, date });
  } catch (error) {
    console.error('Error en getTableStatus:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

/**
 * Crear asignación manual de mesa
 */
export async function createTableAssignment(req, res) {
  // ... (Mantener igual)
  try {
    const businessId = req.business.id;
    const userId = req.user.id;
    const {
      reservationId, // Puede venir como reservationId o appointmentId
      appointmentId,
      tableId,
      combinationId
    } = req.body;

    const finalAppointmentId = appointmentId || reservationId;

    if (!finalAppointmentId || (!tableId && !combinationId)) {
      return res.status(400).json({ 
        error: 'ID de cita y ID de mesa o combinación son requeridos' 
      });
    }

    // 🔧 CAMBIO: Verificar que la cita pertenece al restaurante
    const { data: appointment, error: appError } = await supabase
      .from('appointments')
      .select('id, restaurant_id')
      .eq('id', finalAppointmentId)
      .single();

    if (appError || !appointment || appointment.restaurant_id !== businessId) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    // Desactivar asignaciones previas
    await supabase
      .from('table_assignments')
      .update({ is_active: false })
      .eq('appointment_id', finalAppointmentId);

    // Crear nueva asignación
    const { data: assignment, error } = await supabase
      .from('table_assignments')
      .insert({
        appointment_id: finalAppointmentId,
        table_id: tableId || null,
        combination_id: combinationId || null,
        assigned_by: userId,
        assignment_type: 'manual',
        is_active: true
      })
      .select()
      .single();

    if (error) {
      console.error('Error creando asignación:', error);
      return res.status(500).json({ error: 'Error creando asignación' });
    }

    // 🔧 Actualizar table_id en appointments
    if (tableId) {
      await supabase
        .from('appointments')
        .update({ table_id: tableId })
        .eq('id', finalAppointmentId);
    }

    res.status(201).json({ assignment });
  } catch (error) {
    console.error('Error en createTableAssignment:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

/**
 * Obtener ocupación de mesas por turnos (CORREGIDO TIMEZONE)
 */
export async function getOccupancyByShift(req, res) {
  try {
    const businessId = req.business.id;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Date required' });
    }

    // Obtener Timezone y config
    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('config, timezone')
      .eq('id', businessId)
      .single();

    if (businessError) throw businessError;

    const timezone = business.timezone || 'Europe/Madrid';
    
    const config = typeof business.config === 'string' 
      ? JSON.parse(business.config) 
      : business.config || {};

    const schedules = config?.schedules || {};
    const openingTime = config?.opening_time || '08:00';
    const closingTime = config?.closing_time || '23:00';

    // Get all active tables
    const { data: tables, error: tablesError } = await supabase
      .from('tables')
      .select('*')
      .eq('restaurant_id', businessId)
      .eq('is_active', true)
      .order('table_number', { ascending: true });

    if (tablesError) throw tablesError;

    // Get appointments for the day
    const { data: appointments, error: appError } = await supabase
      .from('appointments')
      .select(`
        id,
        table_id,
        appointment_time,
        duration_minutes,
        party_size,
        status,
        client_name,
        client_phone,
        checked_in_at,
        customers (name, phone, is_vip)
      `)
      .eq('restaurant_id', businessId)
      .gte('scheduled_date', date)
      .lte('scheduled_date', date)
      .in('status', ['pendiente', 'confirmado']);

    if (appError) throw appError;

    // Classify by shift
    const classifyByShift = (time) => {
      if (schedules.lunch?.enabled) {
        if (time >= schedules.lunch.start_time && time < (schedules.dinner?.start_time || closingTime)) {
          return 'lunch';
        }
      }
      if (schedules.dinner?.enabled) {
        if (time >= schedules.dinner.start_time) {
          return 'dinner';
        }
      }
      return 'all_day';
    };

    // Map tables with their reservations by shift
    const tablesWithOccupancy = tables.map(table => {
      const tableReservations = (appointments || [])
        .filter(apt => apt.table_id === table.id)
        .map(apt => {
          // 3. CORRECCIÓN: Convertir a Hora Local antes de clasificar turno
          const utcDate = new Date(apt.appointment_time);
          const zonedDate = toZonedTime(utcDate, timezone);
          const timeStr = format(zonedDate, 'HH:mm', { timeZone: timezone });
          
          return {
            id: apt.id,
            time: timeStr,
            shift: classifyByShift(timeStr),
            duration: apt.duration_minutes || 90,
            partySize: apt.party_size,
            status: apt.status,
            clientName: apt.customers?.name || apt.client_name,
            clientPhone: apt.customers?.phone || apt.client_phone,
            isVip: apt.customers?.is_vip || false,
            checkedIn: !!apt.checked_in_at,
          };
        });

      return {
        ...table,
        reservations: tableReservations,
        allDayReservations: tableReservations,
        lunchReservations: tableReservations.filter(r => r.shift === 'lunch' || r.shift === 'all_day'),
        dinnerReservations: tableReservations.filter(r => r.shift === 'dinner' || r.shift === 'all_day'),
      };
    });

    res.json({
      date,
      shifts: {
        all_day: {
          name: 'All Day',
          start_time: openingTime,
          end_time: closingTime,
        },
        lunch: schedules.lunch?.enabled ? {
          name: 'Lunch',
          start_time: schedules.lunch.start_time,
          end_time: closingTime,
        } : null,
        dinner: schedules.dinner?.enabled ? {
          name: 'Dinner',
          start_time: schedules.dinner.start_time,
          end_time: closingTime,
        } : null,
      },
      tables: tablesWithOccupancy,
    });

  } catch (error) {
    console.error('Error in getOccupancyByShift:', error);
    res.status(500).json({ error: 'Server error' });
  }
};