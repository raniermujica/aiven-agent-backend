import { supabase } from '../config/database.js';

// ================================================================
// GET ALL SERVICES
// ================================================================
export async function getServices(req, res) {
  try {
    const businessId = req.business.id;
    const { category, is_active } = req.query;

    let query = supabase
      .from('services')
      .select('*')
      .eq('restaurant_id', businessId)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });

    // Filtrar por categoría si se proporciona
    if (category) {
      query = query.eq('category', category);
    }

    // Filtrar por estado activo (por defecto solo activos)
    if (is_active !== 'false') {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error obteniendo servicios:', error);
      return res.status(500).json({ error: 'Error obteniendo servicios' });
    }

    res.json({ services: data });

  } catch (error) {
    console.error('Error en getServices:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// GET SERVICE BY ID
// ================================================================
export async function getService(req, res) {
  try {
    const { serviceId } = req.params;
    const businessId = req.business.id;

    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('id', serviceId)
      .eq('restaurant_id', businessId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    res.json({ service: data });

  } catch (error) {
    console.error('Error en getService:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// CREATE SERVICE
// ================================================================
export async function createService(req, res) {
  try {
    const businessId = req.business.id;
    const {
      name,
      description,
      price,
      duration_minutes,
      category,
      emoji,
      display_order,
    } = req.body;

    // Validaciones
    if (!name) {
      return res.status(400).json({ error: 'El nombre del servicio es requerido' });
    }

    const { data, error } = await supabase
      .from('services')
      .insert({
        restaurant_id: businessId,
        name,
        description: description || '',
        price: price || null,
        duration_minutes: duration_minutes || 60,
        category: category || null,
        emoji: emoji || null,
        display_order: display_order || 0,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creando servicio:', error);
      return res.status(500).json({ error: 'Error creando servicio' });
    }

    res.status(201).json({ service: data });

  } catch (error) {
    console.error('Error en createService:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// UPDATE SERVICE
// ================================================================
export async function updateService(req, res) {
  try {
    const { serviceId } = req.params;
    const businessId = req.business.id;
    const updateData = req.body;

    // Verificar que el servicio pertenezca al negocio
    const { data: service, error: checkError } = await supabase
      .from('services')
      .select('id')
      .eq('id', serviceId)
      .eq('restaurant_id', businessId)
      .single();

    if (checkError || !service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    // Actualizar servicio
    const { data, error } = await supabase
      .from('services')
      .update({
        ...updateData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', serviceId)
      .select()
      .single();

    if (error) {
      console.error('Error actualizando servicio:', error);
      return res.status(500).json({ error: 'Error actualizando servicio' });
    }

    res.json({ service: data });

  } catch (error) {
    console.error('Error en updateService:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// DELETE SERVICE
// ================================================================
export async function deleteService(req, res) {
  try {
    const { serviceId } = req.params;
    const businessId = req.business.id;

    // Verificar que el servicio pertenezca al negocio
    const { data: service, error: checkError } = await supabase
      .from('services')
      .select('id')
      .eq('id', serviceId)
      .eq('restaurant_id', businessId)
      .single();

    if (checkError || !service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    // Soft delete: marcar como inactivo
    const { error } = await supabase
      .from('services')
      .update({ is_active: false })
      .eq('id', serviceId);

    if (error) {
      console.error('Error eliminando servicio:', error);
      return res.status(500).json({ error: 'Error eliminando servicio' });
    }

    res.json({ message: 'Servicio eliminado correctamente' });

  } catch (error) {
    console.error('Error en deleteService:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};