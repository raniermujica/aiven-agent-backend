import { supabase } from '../config/database.js';

// ================================================================
// GET ALL CUSTOMERS
// ================================================================
export async function getCustomers(req, res) {
  try {
    const businessId = req.business.id;
    const { search, is_vip, sort_by = 'name' } = req.query;

    let query = supabase
      .from('customers')
      .select('*')
      .eq('restaurant_id', businessId)
      .order(sort_by, { ascending: true });

    // Filtrar por búsqueda (nombre, teléfono, email)
    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
    }

    // Filtrar por VIP
    if (is_vip === 'true') {
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

// ================================================================
// GET CUSTOMER BY ID
// ================================================================
export async function getCustomer(req, res) {
  try {
    const { customerId } = req.params;
    const businessId = req.business.id;

    // Obtener datos del cliente con su historial de citas
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select(`
        *,
        customer_preferences (*)
      `)
      .eq('id', customerId)
      .eq('restaurant_id', businessId)
      .single();

    if (customerError || !customer) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Obtener citas del cliente
    const { data: appointments, error: appointmentsError } = await supabase
      .from('appointments')
      .select('*')
      .eq('client_phone', customer.phone)
      .eq('restaurant_id', businessId)
      .order('scheduled_date', { ascending: false })
      .limit(10);

    res.json({ 
      customer,
      appointments: appointments || []
    });

  } catch (error) {
    console.error('Error en getCustomer:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// CREATE CUSTOMER
// ================================================================
export async function createCustomer(req, res) {
  try {
    const businessId = req.business.id;
    const {
      name,
      phone,
      email,
      notes,
      preferences,
    } = req.body;

    // Validaciones
    if (!name || !phone) {
      return res.status(400).json({ 
        error: 'Nombre y teléfono son requeridos' 
      });
    }

    // Verificar si ya existe un cliente con ese teléfono
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('restaurant_id', businessId)
      .eq('phone', phone)
      .single();

    if (existingCustomer) {
      return res.status(400).json({ 
        error: 'Ya existe un cliente con ese teléfono' 
      });
    }

    // Crear cliente
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .insert({
        restaurant_id: businessId,
        name,
        phone,
        email: email || null,
        notes: notes || null,
        is_vip: false,
        total_visits: 0,
        first_visit_at: new Date().toISOString(),
        last_visit_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (customerError) {
      console.error('Error creando cliente:', customerError);
      return res.status(500).json({ error: 'Error creando cliente' });
    }

    // Si hay preferencias, crearlas
    if (preferences && customer.id) {
      await supabase
        .from('customer_preferences')
        .insert({
          customer_id: customer.id,
          ...preferences,
        });
    }

    res.status(201).json({ customer });

  } catch (error) {
    console.error('Error en createCustomer:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// UPDATE CUSTOMER
// ================================================================
export async function updateCustomer(req, res) {
  try {
    const { customerId } = req.params;
    const businessId = req.business.id;
    const updateData = req.body;

    // Verificar que el cliente pertenezca al negocio
    const { data: customer, error: checkError } = await supabase
      .from('customers')
      .select('id')
      .eq('id', customerId)
      .eq('restaurant_id', businessId)
      .single();

    if (checkError || !customer) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Actualizar cliente
    const { data, error } = await supabase
      .from('customers')
      .update({
        ...updateData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId)
      .select()
      .single();

    if (error) {
      console.error('Error actualizando cliente:', error);
      return res.status(500).json({ error: 'Error actualizando cliente' });
    }

    res.json({ customer: data });

  } catch (error) {
    console.error('Error en updateCustomer:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// DELETE CUSTOMER
// ================================================================
export async function deleteCustomer(req, res) {
  try {
    const { customerId } = req.params;
    const businessId = req.business.id;

    // Verificar que el cliente pertenezca al negocio
    const { data: customer, error: checkError } = await supabase
      .from('customers')
      .select('id')
      .eq('id', customerId)
      .eq('restaurant_id', businessId)
      .single();

    if (checkError || !customer) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Eliminar cliente (esto puede fallar si tiene citas)
    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('id', customerId);

    if (error) {
      console.error('Error eliminando cliente:', error);
      return res.status(500).json({ 
        error: 'Error eliminando cliente. Puede tener citas asociadas.' 
      });
    }

    res.json({ message: 'Cliente eliminado correctamente' });

  } catch (error) {
    console.error('Error en deleteCustomer:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// TOGGLE VIP STATUS
// ================================================================
export async function toggleVipStatus(req, res) {
  try {
    const { customerId } = req.params;
    const businessId = req.business.id;

    // Obtener estado actual
    const { data: customer, error: getError } = await supabase
      .from('customers')
      .select('is_vip')
      .eq('id', customerId)
      .eq('restaurant_id', businessId)
      .single();

    if (getError || !customer) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Cambiar estado VIP
    const { data, error } = await supabase
      .from('customers')
      .update({ 
        is_vip: !customer.is_vip,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId)
      .select()
      .single();

    if (error) {
      console.error('Error actualizando estado VIP:', error);
      return res.status(500).json({ error: 'Error actualizando estado VIP' });
    }

    res.json({ customer: data });

  } catch (error) {
    console.error('Error en toggleVipStatus:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// GET CUSTOMER STATS
// ================================================================
export async function getCustomerStats(req, res) {
  try {
    const businessId = req.business.id;

    // Total de clientes
    const { count: totalCustomers, error: totalError } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', businessId);

    // Clientes VIP
    const { count: vipCustomers, error: vipError } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', businessId)
      .eq('is_vip', true);

    // Nuevos clientes este mes
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count: newThisMonth, error: newError } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', businessId)
      .gte('first_visit_at', startOfMonth.toISOString());

    if (totalError || vipError || newError) {
      console.error('Error obteniendo stats:', { totalError, vipError, newError });
      return res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }

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