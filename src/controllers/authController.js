import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/database.js';
import { getBusinessTypeConfig } from '../config/businessTypes.js';

export async function login(req, res) {
  try {
    const { email, password, slug } = req.body;

    console.log('🔐 Intento de login:', { email, slug });

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    // 1. CORRECCIÓN: Agregamos 'timezone' al select
    let query = supabase
      .from('restaurant_users')
      .select(`
        *,
        restaurants (
          id,
          name,
          slug,
          business_type,
          logo_url,
          is_active,
          timezone 
        )
      `)
      .eq('email', email)
      .eq('is_active', true);

    const { data: users, error: userError } = await query;

    if (userError || !users || users.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = users[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      { 
        userId: user.id,
        email: user.email,
        role: user.role,
        restaurantId: user.restaurant_id,
        isSuperAdmin: user.is_platform_admin
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    const userData = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isSuperAdmin: user.is_platform_admin,
    };

    if (user.restaurants) {
      const businessConfig = getBusinessTypeConfig(user.restaurants.business_type);
      
      userData.business = {
        id: user.restaurants.id,
        name: user.restaurants.name,
        slug: user.restaurants.slug,
        type: user.restaurants.business_type,
        logoUrl: user.restaurants.logo_url,
        // 2. CORRECCIÓN: Pasamos la timezone al frontend (con fallback)
        timezone: user.restaurants.timezone || 'Europe/Madrid', 
        ...businessConfig,
      };
    }

    res.json({
      token,
      user: userData,
    });

  } catch (error) {
    console.error('💥 Error en login:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

export async function getMe(req, res) {
  try {
    // El middleware authenticateToken ya trae el usuario básico, 
    // pero necesitamos refrescar los datos del negocio incluyendo timezone.
    
    const { data: userFull, error } = await supabase
      .from('restaurant_users')
      .select(`
        *,
        restaurants (
          id,
          name,
          slug,
          business_type,
          logo_url,
          is_active,
          timezone
        )
      `)
      .eq('id', req.user.id)
      .single();

    if (error || !userFull) {
        return res.status(404).json({error: 'Usuario no encontrado'});
    }

    const userData = {
      id: userFull.id,
      name: userFull.name,
      email: userFull.email,
      role: userFull.role,
      isSuperAdmin: userFull.is_platform_admin,
    };

    if (userFull.restaurants) {
      const businessConfig = getBusinessTypeConfig(userFull.restaurants.business_type);
      
      userData.business = {
        id: userFull.restaurants.id,
        name: userFull.restaurants.name,
        slug: userFull.restaurants.slug,
        type: userFull.restaurants.business_type,
        logoUrl: userFull.restaurants.logo_url,
        timezone: userFull.restaurants.timezone || 'Europe/Madrid',
        ...businessConfig,
      };
    }

    res.json({ user: userData });

  } catch (error) {
    console.error('Error en getMe:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};