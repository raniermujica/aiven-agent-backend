import { supabase } from '../config/database.js';

export async function getCustomers(req, res) {
  try {
    const businessId = req.business.id;
    const { search, vipOnly } = req.query;

    let query = supabase
      .from('customers')
      .select(`
        *,
        customer_preferences (
          allergies,
          dietary_restrictions,
          favorite_table,
          seating_preference
        )
      `)
      .eq('restaurant_id', businessId)
      .order('total_visits', { ascending: false });

    // Filtrar por búsqueda
    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
    }

    // Filtrar solo VIP
    if (vipOnly === 'true') {
      query = query.eq('is_vip', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error obteniendo clientes:', error);
      return res.status(500).json({ error: 'Error obteniendo clientes' });
    }

    res.json({ customers: data });

  } catch (error) {
    console.error('Error en getCustomers:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

export async function getCustomer(req, res) {
  try {
    const { customerId } = req.params;
    const businessId = req.business.id;

    const { data: customer, error } = await supabase
      .from('customers')
      .select(`
        *,
        customer_preferences (
          allergies,
          dietary_restrictions,
          favorite_table,
          favorite_dishes,
          favorite_drinks,
          seating_preference,
          special_occasions
        )
      `)
      .eq('id', customerId)
      .eq('restaurant_id', businessId)
      .single();

    if (error || !customer) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Obtener historial de reservas
    const { data: reservations } = await supabase
      .from('reservations')
      .select('*')
      .eq('customer_id', customerId)
      .order('reservation_date', { ascending: false })
      .limit(20);

    res.json({ 
      customer,
      reservations: reservations || []
    });

  } catch (error) {
    console.error('Error en getCustomer:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

export async function createCustomer(req, res) {
  try {
    const businessId = req.business.id;
    const {
      name,
      phone,
      email,
      birthday,
      isVIP,
      notes,
      allergies,
      dietaryRestrictions,
    } = req.body;

    // Validaciones
    if (!name || !phone) {
      return res.status(400).json({ error: 'Nombre y teléfono son requeridos' });
    }

    // Verificar que no exista ya
    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('restaurant_id', businessId)
      .eq('phone', phone)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'Cliente ya existe con ese teléfono' });
    }

    // Crear cliente
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .insert({
        restaurant_id: businessId,
        name,
        phone,
        email,
        birthday,
        is_vip: isVIP || false,
        notes,
        first_visit_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (customerError) {
      console.error('Error creando cliente:', customerError);
      return res.status(500).json({ error: 'Error creando cliente' });
    }

    // Crear preferencias si hay
    if (allergies || dietaryRestrictions) {
      await supabase
        .from('customer_preferences')
        .insert({
          customer_id: customer.id,
          allergies,
          dietary_restrictions: dietaryRestrictions,
        });
    }

    res.status(201).json({ customer });

  } catch (error) {
    console.error('Error en createCustomer:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

export async function updateCustomer(req, res) {
  try {
    const { customerId } = req.params;
    const businessId = req.business.id;
    const {
      name,
      email,
      birthday,
      isVIP,
      notes,
      allergies,
      dietaryRestrictions,
      favoriteTable,
    } = req.body;

    // Actualizar cliente
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (birthday !== undefined) updates.birthday = birthday;
    if (isVIP !== undefined) updates.is_vip = isVIP;
    if (notes !== undefined) updates.notes = notes;

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .update(updates)
      .eq('id', customerId)
      .eq('restaurant_id', businessId)
      .select()
      .single();

    if (customerError) {
      console.error('Error actualizando cliente:', customerError);
      return res.status(500).json({ error: 'Error actualizando cliente' });
    }

    // Actualizar preferencias
    if (allergies !== undefined || dietaryRestrictions !== undefined || favoriteTable !== undefined) {
      const prefUpdates = {};
      if (allergies !== undefined) prefUpdates.allergies = allergies;
      if (dietaryRestrictions !== undefined) prefUpdates.dietary_restrictions = dietaryRestrictions;
      if (favoriteTable !== undefined) prefUpdates.favorite_table = favoriteTable;

      // Verificar si ya tiene preferencias
      const { data: existingPref } = await supabase
        .from('customer_preferences')
        .select('id')
        .eq('customer_id', customerId)
        .single();

      if (existingPref) {
        await supabase
          .from('customer_preferences')
          .update(prefUpdates)
          .eq('customer_id', customerId);
      } else {
        await supabase
          .from('customer_preferences')
          .insert({
            customer_id: customerId,
            ...prefUpdates,
          });
      }
    }

    res.json({ customer });

  } catch (error) {
    console.error('Error en updateCustomer:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

export async function getCustomerStats(req, res) {
  try {
    const businessId = req.business.id;

    // Total clientes
    const { count: totalCustomers } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', businessId);

    // Clientes VIP
    const { count: vipCustomers } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', businessId)
      .eq('is_vip', true);

    // Clientes nuevos este mes
    const firstDayOfMonth = new Date();
    firstDayOfMonth.setDate(1);
    firstDayOfMonth.setHours(0, 0, 0, 0);

    const { count: newThisMonth } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', businessId)
      .gte('first_visit_at', firstDayOfMonth.toISOString());

    res.json({
      total: totalCustomers || 0,
      vip: vipCustomers || 0,
      newThisMonth: newThisMonth || 0,
    });

  } catch (error) {
    console.error('Error en getCustomerStats:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};