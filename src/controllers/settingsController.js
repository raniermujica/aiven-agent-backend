import { supabase } from '../config/database.js';

// GET /api/settings - Obtener configuración del negocio
export async function getSettings(req, res) {
  try {
    const restaurantId = req.user.restaurants.id;

    const { data: restaurant, error } = await supabase
      .from('restaurants')
      .select('*') // <-- Esto ya trae la columna 'config'
      .eq('id', restaurantId)
      .single();

    if (error) throw error;

    res.json({
      settings: {
        name: restaurant.name,
        slug: restaurant.slug,
        email: restaurant.email,
        phone: restaurant.phone,
        address: restaurant.address,
        city: restaurant.city,
        website: restaurant.website,
        maxCapacity: restaurant.max_capacity,
        averageTableTime: restaurant.average_table_time_minutes,
        timezone: restaurant.timezone,
        businessType: restaurant.business_type,
        assistantName: restaurant.assistant_name,
        businessHours: restaurant.business_hours,
        description: restaurant.description,
        whatsappNumber: restaurant.whatsapp_number,
        isAiPaused: restaurant.is_ai_paused,
        config: restaurant.config || {}, // Enviar el config (o un objeto vacío si es null)
      },
    });
  } catch (error) {
    console.error('Error obteniendo configuración:', error);
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
}

// PATCH /api/settings - Actualizar configuración del negocio
export async function updateSettings(req, res) {
  try {
    const restaurantId = req.user.restaurants.id;
    const {
      name,
      email,
      phone,
      address,
      city,
      website,
      maxCapacity,
      averageTableTime,
      timezone,
      assistantName,
      businessHours,
      description,
      whatsappNumber,
      config, // <--- ¡CORRECCIÓN 2: Recibir el config!
    } = req.body;

    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (website !== undefined) updateData.website = website;
    if (maxCapacity !== undefined) updateData.max_capacity = maxCapacity;
    if (averageTableTime !== undefined) updateData.average_table_time_minutes = averageTableTime;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (assistantName !== undefined) updateData.assistant_name = assistantName;
    if (businessHours !== undefined) updateData.business_hours = businessHours;
    if (description !== undefined) updateData.description = description;
    if (whatsappNumber !== undefined) updateData.whatsapp_number = whatsappNumber;

    // <--- ¡CORRECCIÓN 3: Guardar el config!
    if (config !== undefined) updateData.config = config;

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('restaurants')
      .update(updateData)
      .eq('id', restaurantId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: 'Configuración actualizada correctamente',
      settings: data,
    });
  } catch (error) {
    console.error('Error actualizando configuración:', error);
    res.status(500).json({ error: 'Error al actualizar configuración' });
  }
}

// GET /api/settings/users - Obtener usuarios del negocio
export async function getBusinessUsers(req, res) {
  try {
    const restaurantId = req.user.restaurants.id;

    const { data: users, error } = await supabase
      .from('restaurant_users')
      .select('id, name, email, phone, role, is_active, last_login_at, created_at')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ users: users || [] });
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
}

// POST /api/settings/users - Crear nuevo usuario
export async function createBusinessUser(req, res) {
  try {
    const restaurantId = req.user.restaurants.id;
    const { name, email, password, phone, role } = req.body;

    // Validaciones
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    if (!['ADMIN', 'MANAGER', 'STAFF'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    // Hash de contraseña
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('restaurant_users')
      .insert({
        restaurant_id: restaurantId,
        name,
        email,
        password_hash: passwordHash,
        phone,
        role,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique violation
        return res.status(409).json({ error: 'El email ya está en uso' });
      }
      throw error;
    }

    res.status(201).json({
      message: 'Usuario creado correctamente',
      user: {
        id: data.id,
        name: data.name,
        email: data.email,
        phone: data.phone,
        role: data.role,
      },
    });
  } catch (error) {
    console.error('Error creando usuario:', error);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
}

// PATCH /api/settings/users/:userId - Actualizar usuario
export async function updateBusinessUser(req, res) {
  try {
    const restaurantId = req.user.restaurants.id;
    const { userId } = req.params;
    const { name, email, phone, role, isActive } = req.body;

    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.is_active = isActive;

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('restaurant_users')
      .update(updateData)
      .eq('id', userId)
      .eq('restaurant_id', restaurantId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: 'Usuario actualizado correctamente',
      user: data,
    });
  } catch (error) {
    console.error('Error actualizando usuario:', error);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
}

// DELETE /api/settings/users/:userId - Eliminar usuario
export async function deleteBusinessUser(req, res) {
  try {
    const restaurantId = req.user.restaurants.id;
    const { userId } = req.params;

    // No permitir eliminar al usuario actual
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
    }

    const { error } = await supabase
      .from('restaurant_users')
      .delete()
      .eq('id', userId)
      .eq('restaurant_id', restaurantId);

    if (error) throw error;

    res.json({ message: 'Usuario eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
}

// GET /api/settings/hours - Obtener horarios
export async function getBusinessHours(req, res) {
  try {
    const restaurantId = req.user.restaurants.id;

    const { data: hours, error } = await supabase
      .from('availability_rules')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .is('specific_date', null) // Solo horarios regulares, no fechas específicas
      .order('day_of_week', { ascending: true });

    if (error) throw error;

    // Formatear respuesta
    const formattedHours = {};
    (hours || []).forEach(rule => {
      formattedHours[rule.day_of_week] = {
        id: rule.id,
        openTime: rule.open_time,
        closeTime: rule.close_time,
        isActive: !rule.is_closed,
      };
    });

    res.json({ hours: formattedHours });
  } catch (error) {
    console.error('Error obteniendo horarios:', error);
    res.status(500).json({ error: 'Error al obtener horarios' });
  }
}

// POST /api/settings/hours - Guardar/Actualizar horarios
export async function updateBusinessHours(req, res) {
  try {
    const restaurantId = req.user.restaurants.id;
    const { hours } = req.body; // Array de { dayOfWeek, openTime, closeTime, isActive }

    if (!Array.isArray(hours)) {
      return res.status(400).json({ error: 'Formato de horarios inválido' });
    }

    // Eliminar horarios existentes
    await supabase
      .from('availability_rules')
      .delete()
      .eq('restaurant_id', restaurantId)
      .is('specific_date', null);

    // Insertar nuevos horarios
    const newHours = hours.map(h => ({
      restaurant_id: restaurantId,
      day_of_week: h.dayOfWeek, // 0=Domingo, 1=Lunes, etc.
      open_time: h.openTime,
      close_time: h.closeTime,
      is_closed: !h.isActive,
      shift_name: 'Regular',
    }));

    const { error } = await supabase
      .from('availability_rules')
      .insert(newHours);

    if (error) throw error;

    res.json({ message: 'Horarios actualizados correctamente' });
  } catch (error) {
    console.error('Error actualizando horarios:', error);
    res.status(500).json({ error: 'Error al actualizar horarios' });
  }
};