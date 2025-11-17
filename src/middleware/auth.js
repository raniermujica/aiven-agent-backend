import jwt from 'jsonwebtoken';
import { supabase } from '../config/database.js';

export async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    console.log('🔍 [Auth] Header recibido:', authHeader);
    const token = authHeader && authHeader.split(' ')[1]; 
      console.log('🔍 [Auth] Token extraído:', token ? token.substring(0, 20) + '...' : 'NULL');

    if (!token) {
       console.log('❌ [Auth] Token no proporcionado');
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    // Verificar token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
     console.log('✅ [Auth] Token decodificado:', decoded);
    
    // Obtener usuario de la BD
    const { data: user, error } = await supabase
      .from('restaurant_users')
      .select('*, restaurants(*)')
      .eq('id', decoded.userId)
      .single();

        console.log('🔍 [Auth] Usuario encontrado:', user ? user.email : 'NULL');

    if (error || !user) {
      console.log('❌ [Auth] Usuario no encontrado');
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    if (!user.is_active) {
       console.log('❌ [Auth] Usuario inactivo');
      return res.status(403).json({ error: 'Usuario inactivo' });
    }

    // Agregar usuario al request
    req.user = user;
      console.log('✅ [Auth] Usuario agregado a req.user');
    next();
  } catch (error) {
     console.log('❌ [Auth] Error:', error.message);
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ error: 'Token inválido' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({ error: 'Token expirado' });
    }
    return res.status(500).json({ error: 'Error en autenticación' });
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'No tienes permisos para esta acción',
        required: allowedRoles,
        current: req.user.role
      });
    }

    next();
  };
}

export function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  if (!req.user.is_platform_admin) {
    return res.status(403).json({ error: 'Requiere permisos de SuperAdmin' });
  }

  next();
};