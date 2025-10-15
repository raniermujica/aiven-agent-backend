import { supabase } from '../config/database.js';

export async function getWaitlist(req, res) {
  try {
    const businessId = req.business.id;
    const { status } = req.query;

    let query = supabase
      .from('waitlist')
      .select(`
        *,
        customers (
          id,
          name,
          phone,
          is_vip
        )
      `)
      .eq('restaurant_id', businessId)
      .order('added_at', { ascending: true });

    if (status) {
      query = query.eq('status', status);
    } else {
      // Por defecto, solo mostrar waiting y called
      query = query.in('status', ['waiting', 'called']);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error obteniendo waitlist:', error);
      return res.status(500).json({ error: 'Error obteniendo lista de espera' });
    }

    res.json({ waitlist: data });

  } catch (error) {
    console.error('Error en getWaitlist:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

export async function addToWaitlist(req, res) {
  try {
    const businessId = req.business.id;
    const {
      customerId,
      customerName,
      customerPhone,
      partySize,
      estimatedWaitMinutes,
      notes,
    } = req.body;

    // Validaciones
    if (!partySize) {
      return res.status(400).json({ error: 'Número de personas es requerido' });
    }

    // Si no hay customerId, buscar/crear cliente
    let finalCustomerId = customerId;

    if (!finalCustomerId) {
      if (!customerName || !customerPhone) {
        return res.status(400).json({ 
          error: 'Nombre y teléfono son requeridos' 
        });
      }

      // Buscar cliente existente
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

    // Agregar a lista de espera
    const { data: entry, error } = await supabase
      .from('waitlist')
      .insert({
        restaurant_id: businessId,
        customer_id: finalCustomerId,
        party_size: partySize,
        estimated_wait_minutes: estimatedWaitMinutes,
        notes,
        status: 'waiting',
      })
      .select(`
        *,
        customers (
          id,
          name,
          phone,
          is_vip
        )
      `)
      .single();

    if (error) {
      console.error('Error agregando a waitlist:', error);
      return res.status(500).json({ error: 'Error agregando a lista de espera' });
    }

    res.status(201).json({ entry });

  } catch (error) {
    console.error('Error en addToWaitlist:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

export async function updateWaitlistStatus(req, res) {
  try {
    const { entryId } = req.params;
    const { status } = req.body;
    const businessId = req.business.id;

    const validStatuses = ['waiting', 'called', 'seated', 'cancelled', 'no_show'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Estado inválido',
        validStatuses 
      });
    }

    const updates = { status };

    if (status === 'called') {
      updates.notified_at = new Date().toISOString();
    }

    if (status === 'seated') {
      updates.seated_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('waitlist')
      .update(updates)
      .eq('id', entryId)
      .eq('restaurant_id', businessId)
      .select()
      .single();

    if (error) {
      console.error('Error actualizando waitlist:', error);
      return res.status(500).json({ error: 'Error actualizando entrada' });
    }

    res.json({ entry: data });

  } catch (error) {
    console.error('Error en updateWaitlistStatus:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

export async function getWaitlistStats(req, res) {
  try {
    const businessId = req.business.id;

    const { data: entries, error } = await supabase
      .from('waitlist')
      .select('status, party_size, estimated_wait_minutes')
      .eq('restaurant_id', businessId)
      .in('status', ['waiting', 'called']);

    if (error) {
      console.error('Error obteniendo stats:', error);
      return res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }

    const waiting = entries.filter(e => e.status === 'waiting');
    const totalPeople = waiting.reduce((sum, e) => sum + e.party_size, 0);
    const avgWait = waiting.length > 0
      ? Math.round(waiting.reduce((sum, e) => sum + e.estimated_wait_minutes, 0) / waiting.length)
      : 0;

    res.json({
      waiting: waiting.length,
      totalPeople,
      avgWait,
    });

  } catch (error) {
    console.error('Error en getWaitlistStats:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};