import jwt from 'jsonwebtoken';
import { supabase } from '../config/database.js';

export async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Token no proporcionado' });
    }

    // Verificar token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Obtener usuario de la BD
    const { data: user, error } = await supabase
      .from('restaurant_users')
      .select('*, restaurants(*)')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Usuario inactivo' });
    }

    // Agregar usuario al request
    req.user = user;
    next();
  } catch (error) {
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