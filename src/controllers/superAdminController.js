import bcrypt from 'bcryptjs';
import { supabase } from '../config/database.js';
import { getBusinessTypeConfig } from '../config/businessTypes.js';

export async function createBusiness(req, res) {
  try {
    const {
      businessType,
      name,
      slug,
      adminEmail,
      adminPassword,
      adminName,
    } = req.body;

    // Validaciones
    if (!businessType || !name || !slug || !adminEmail || !adminPassword || !adminName) {
      return res.status(400).json({ 
        error: 'Todos los campos son requeridos',
        required: ['businessType', 'name', 'slug', 'adminEmail', 'adminPassword', 'adminName']
      });
    }

    // Validar que el tipo de negocio sea válido
    const businessConfig = getBusinessTypeConfig(businessType);
    if (!businessConfig) {
      return res.status(400).json({ error: 'Tipo de negocio inválido' });
    }

    // Verificar que el slug no exista
    const { data: existingBusiness } = await supabase
      .from('restaurants')
      .select('id')
      .eq('slug', slug)
      .single();

    if (existingBusiness) {
      return res.status(400).json({ error: 'El slug ya está en uso' });
    }

    // Verificar que el email no exista
    const { data: existingUser } = await supabase
      .from('restaurant_users')
      .select('id')
      .eq('email', adminEmail)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    // 1. Crear el negocio
    const { data: newBusiness, error: businessError } = await supabase
      .from('restaurants')
      .insert({
        name,
        slug,
        business_type: businessType,
        is_active: true,
      })
      .select()
      .single();

    if (businessError) {
      console.error('Error creando negocio:', businessError);
      return res.status(500).json({ error: 'Error creando negocio' });
    }

    // 2. Crear el usuario administrador
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    const { data: newUser, error: userError } = await supabase
      .from('restaurant_users')
      .insert({
        restaurant_id: newBusiness.id,
        email: adminEmail,
        password_hash: hashedPassword,
        name: adminName,
        role: 'ADMIN',
        is_active: true,
        permissions: {
          view_reservations: true,
          create_reservations: true,
          edit_reservations: true,
          delete_reservations: true,
          view_analytics: true,
          manage_customers: true,
          manage_users: true,
          pause_ai: true,
        },
      })
      .select()
      .single();

    if (userError) {
      console.error('Error creando usuario:', userError);
      // Rollback: eliminar el negocio creado
      await supabase.from('restaurants').delete().eq('id', newBusiness.id);
      return res.status(500).json({ error: 'Error creando usuario administrador' });
    }

    // Respuesta exitosa
    res.status(201).json({
      message: 'Negocio creado exitosamente',
      business: {
        id: newBusiness.id,
        name: newBusiness.name,
        slug: newBusiness.slug,
        type: newBusiness.business_type,
        url: `${req.protocol}://${req.get('host')}/${newBusiness.slug}`,
      },
      admin: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        temporaryPassword: adminPassword, // Para que el SuperAdmin lo pueda enviar al cliente
      },
    });

  } catch (error) {
    console.error('Error en createBusiness:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

export async function listBusinesses(req, res) {
  try {
    const { data: businesses, error } = await supabase
      .from('restaurants')
      .select(`
        id,
        name,
        slug,
        business_type,
        logo_url,
        is_active,
        created_at,
        restaurant_users (
          id,
          name,
          email,
          role
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error listando negocios:', error);
      return res.status(500).json({ error: 'Error obteniendo negocios' });
    }

    // Agregar configuración de cada tipo de negocio
    const businessesWithConfig = businesses.map(business => ({
      ...business,
      config: getBusinessTypeConfig(business.business_type),
      url: `${req.protocol}://${req.get('host')}/${business.slug}`,
    }));

    res.json({ businesses: businessesWithConfig });

  } catch (error) {
    console.error('Error en listBusinesses:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

export async function updateBusiness(req, res) {
  try {
    const { businessId } = req.params;
    const { name, logoUrl, isActive } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (logoUrl !== undefined) updates.logo_url = logoUrl;
    if (isActive !== undefined) updates.is_active = isActive;

    const { data, error } = await supabase
      .from('restaurants')
      .update(updates)
      .eq('id', businessId)
      .select()
      .single();

    if (error) {
      console.error('Error actualizando negocio:', error);
      return res.status(500).json({ error: 'Error actualizando negocio' });
    }

    res.json({ business: data });

  } catch (error) {
    console.error('Error en updateBusiness:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};