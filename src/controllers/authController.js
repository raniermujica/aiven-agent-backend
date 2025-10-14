import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/database.js';
import { getBusinessTypeConfig } from '../config/businessTypes.js';

export async function login(req, res) {
  try {
    const { email, password, slug } = req.body;

    console.log('🔐 Intento de login:', { email, slug });

    // Validaciones
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    // Buscar usuario por email
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
          is_active
        )
      `)
      .eq('email', email)
      .eq('is_active', true);

    const { data: users, error: userError } = await query;

    console.log('👤 Usuarios encontrados:', users?.length || 0);
    console.log('❌ Error de búsqueda:', userError);

    if (userError || !users || users.length === 0) {
      console.error('Error buscando usuario:', userError);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = users[0];
    console.log('✅ Usuario encontrado:', user.email);
    console.log('🔑 Hash almacenado:', user.password_hash);

    // Verificar contraseña
    console.log('🔐 Verificando password...');
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    console.log('✅ Password válido:', isValidPassword);

    if (!isValidPassword) {
      console.log('❌ Password incorrecto');
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Generar token JWT
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

    // Preparar datos del usuario
    const userData = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isSuperAdmin: user.is_platform_admin,
    };

    // Agregar datos del negocio si aplica
    if (user.restaurants) {
      const businessConfig = getBusinessTypeConfig(user.restaurants.business_type);
      
      userData.business = {
        id: user.restaurants.id,
        name: user.restaurants.name,
        slug: user.restaurants.slug,
        type: user.restaurants.business_type,
        logoUrl: user.restaurants.logo_url,
        ...businessConfig,
      };
    }

    console.log('🎉 Login exitoso');
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
    // req.user viene del middleware authenticateToken
    const user = req.user;

    const userData = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isSuperAdmin: user.is_platform_admin,
    };

    // Agregar datos del negocio si aplica
    if (user.restaurants) {
      const businessConfig = getBusinessTypeConfig(user.restaurants.business_type);
      
      userData.business = {
        id: user.restaurants.id,
        name: user.restaurants.name,
        slug: user.restaurants.slug,
        type: user.restaurants.business_type,
        logoUrl: user.restaurants.logo_url,
        ...businessConfig,
      };
    }

    res.json({ user: userData });

  } catch (error) {
    console.error('Error en getMe:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};