import { supabase } from '../config/database.js';

export async function getReservations(req, res) {
  try {
    const { date, status } = req.query;
    const businessId = req.business.id;

    let query = supabase
      .from('reservations')
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
          table_name
        ),
        services (
          id,
          name
        )
      `)
      .eq('restaurant_id', businessId)
      .order('reservation_date', { ascending: true })
      .order('reservation_time', { ascending: true });

    // Filtrar por fecha si se proporciona
    if (date) {
      query = query.eq('reservation_date', date);
    }

    // Filtrar por estado si se proporciona
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error obteniendo reservas:', error);
      return res.status(500).json({ error: 'Error obteniendo reservas' });
    }

    res.json({ reservations: data });

  } catch (error) {
    console.error('Error en getReservations:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

export async function getTodayReservations(req, res) {
  try {
    const businessId = req.business.id;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const { data, error } = await supabase
      .from('reservations')
      .select(`
        *,
        customers (
          id,
          name,
          phone,
          email,
          is_vip,
          customer_preferences (
            allergies,
            dietary_restrictions
          )
        ),
        tables (
          id,
          table_number,
          table_name
        )
      `)
      .eq('restaurant_id', businessId)
      .eq('reservation_date', today)
      .order('reservation_time', { ascending: true });

    if (error) {
      console.error('Error obteniendo reservas de hoy:', error);
      return res.status(500).json({ error: 'Error obteniendo reservas' });
    }

    res.json({ reservations: data });

  } catch (error) {
    console.error('Error en getTodayReservations:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

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
    } = req.body;

    // Validaciones
    if (!reservationDate || !reservationTime || !partySize) {
      return res.status(400).json({
        error: 'Fecha, hora y número de personas son requeridos'
      });
    }

    // Si no hay customerId, necesitamos crear el cliente
    let finalCustomerId = customerId;

    if (!finalCustomerId) {
      if (!customerName || !customerPhone) {
        return res.status(400).json({
          error: 'Nombre y teléfono del cliente son requeridos'
        });
      }

      // Buscar si el cliente ya existe por teléfono
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('id')
        .eq('restaurant_id', businessId)
        .eq('phone', customerPhone)
        .single();

      if (existingCustomer) {
        finalCustomerId = existingCustomer.id;
      } else {
        // Crear nuevo cliente
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

    // Crear la reserva
    const { data: reservation, error: reservationError } = await supabase
      .from('reservations')
      .insert({
        restaurant_id: businessId,
        customer_id: finalCustomerId,
        table_id: tableId,
        service_id: serviceId,
        reservation_date: reservationDate,
        reservation_time: reservationTime,
        party_size: partySize,
        special_occasion: specialOccasion,
        special_requests: specialRequests,
        source,
        status: 'confirmed',
        created_by: req.user.id,
      })
      .select(`
        *,
        customers (
          id,
          name,
          phone,
          email,
          is_vip
        )
      `)
      .single();

    if (reservationError) {
      console.error('Error creando reserva:', reservationError);
      return res.status(500).json({ error: 'Error creando reserva' });
    }

    res.status(201).json({ reservation });

  } catch (error) {
    console.error('Error en createReservation:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

export async function updateReservationStatus(req, res) {
  try {
    const { reservationId } = req.params;
    const { status } = req.body;
    const businessId = req.business.id;
    const businessType = req.business.type; // ← AGREGAR ESTO

    // Validar estados según tipo de negocio
    let validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];

    // Solo restaurantes pueden usar "seated"
    if (businessType === 'restaurant') {
      validStatuses.push('seated');
    }

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Estado inválido para este tipo de negocio',
        validStatuses
      });
    }

    // Verificar que la reserva pertenezca al negocio
    const { data: reservation, error: checkError } = await supabase
      .from('reservations')
      .select('id, customer_id')
      .eq('id', reservationId)
      .eq('restaurant_id', businessId)
      .single();

    if (checkError || !reservation) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    // Actualizar estado
    const updates = { status };

    // Si se marca como seated, guardar hora de check-in
    if (status === 'seated') {
      updates.checked_in_at = new Date().toISOString();
    }

    // Si se marca como completed, guardar hora de check-out
    if (status === 'completed') {
      updates.checked_out_at = new Date().toISOString();

      // Actualizar estadísticas del cliente
      await supabase.rpc('increment_customer_visits', {
        customer_id_input: reservation.customer_id
      });
    }

    const { data, error } = await supabase
      .from('reservations')
      .update(updates)
      .eq('id', reservationId)
      .select()
      .single();

    if (error) {
      console.error('Error actualizando reserva:', error);
      return res.status(500).json({ error: 'Error actualizando reserva' });
    }

    res.json({ reservation: data });

  } catch (error) {
    console.error('Error en updateReservationStatus:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};

export async function getReservationStats(req, res) {
  try {
    const businessId = req.business.id;
    const today = new Date().toISOString().split('T')[0];

    // Contar reservas de hoy por estado
    const { data: todayStats, error: todayError } = await supabase
      .from('reservations')
      .select('status')
      .eq('restaurant_id', businessId)
      .eq('reservation_date', today);

    if (todayError) {
      console.error('Error obteniendo stats:', todayError);
      return res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }

    // Contar comensales de hoy
    const totalCovers = todayStats.reduce((sum, r) => sum + (r.party_size || 0), 0);

    const stats = {
      today: {
        total: todayStats.length,
        pending: todayStats.filter(r => r.status === 'pending').length,
        confirmed: todayStats.filter(r => r.status === 'confirmed').length,
        seated: todayStats.filter(r => r.status === 'seated').length,
        completed: todayStats.filter(r => r.status === 'completed').length,
        cancelled: todayStats.filter(r => r.status === 'cancelled').length,
        noShows: todayStats.filter(r => r.status === 'no_show').length,
        totalCovers,
      }
    };

    res.json(stats);

  } catch (error) {
    console.error('Error en getReservationStats:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};