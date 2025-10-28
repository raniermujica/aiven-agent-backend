import { supabase } from '../config/database.js';

// GET /api/services - Obtener todos los servicios
export async function getServices(req, res) {
  try {
    const restaurantId = req.user.restaurants.id;

    const { data: services, error } = await supabase
      .from('services')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('display_order', { ascending: true });

    if (error) throw error;

    res.json({ services: services || [] });
  } catch (error) {
    console.error('Error obteniendo servicios:', error);
    res.status(500).json({ error: 'Error al obtener servicios' });
  }
}

// POST /api/services - Crear nuevo servicio
export async function createService(req, res) {
  try {
    const restaurantId = req.user.restaurants.id;
    const { name, description, price, durationMinutes, category, emoji, displayOrder } = req.body;

    // Validaciones
    if (!name || !description) {
      return res.status(400).json({ error: 'Nombre y descripción son requeridos' });
    }

    const { data, error } = await supabase
      .from('services')
      .insert({
        restaurant_id: restaurantId,
        name,
        description,
        price: price || null,
        duration_minutes: durationMinutes || 60,
        category: category || null,
        emoji: emoji || null,
        display_order: displayOrder || 0,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Servicio creado correctamente',
      service: data,
    });
  } catch (error) {
    console.error('Error creando servicio:', error);
    res.status(500).json({ error: 'Error al crear servicio' });
  }
}

// PATCH /api/services/:serviceId - Actualizar servicio
export async function updateService(req, res) {
  try {
    const restaurantId = req.user.restaurants.id;
    const { serviceId } = req.params;
    const { name, description, price, durationMinutes, category, emoji, displayOrder, isActive } = req.body;

    const updateData = {};
    
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = price;
    if (durationMinutes !== undefined) updateData.duration_minutes = durationMinutes;
    if (category !== undefined) updateData.category = category;
    if (emoji !== undefined) updateData.emoji = emoji;
    if (displayOrder !== undefined) updateData.display_order = displayOrder;
    if (isActive !== undefined) updateData.is_active = isActive;

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('services')
      .update(updateData)
      .eq('id', serviceId)
      .eq('restaurant_id', restaurantId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: 'Servicio actualizado correctamente',
      service: data,
    });
  } catch (error) {
    console.error('Error actualizando servicio:', error);
    res.status(500).json({ error: 'Error al actualizar servicio' });
  }
}

// DELETE /api/services/:serviceId - Eliminar servicio
export async function deleteService(req, res) {
  try {
    const restaurantId = req.user.restaurants.id;
    const { serviceId } = req.params;

    const { error } = await supabase
      .from('services')
      .delete()
      .eq('id', serviceId)
      .eq('restaurant_id', restaurantId);

    if (error) throw error;

    res.json({ message: 'Servicio eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando servicio:', error);
    res.status(500).json({ error: 'Error al eliminar servicio' });
  }
};