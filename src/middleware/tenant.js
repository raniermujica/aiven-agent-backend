import { supabase } from '../config/database.js';

export async function loadBusinessFromSlug(req, res, next) {
  try {
    const slug = req.headers['x-business-slug'] || req.body.slug || req.query.slug;

    if (!slug) {
      return res.status(400).json({ error: 'Slug del negocio no proporcionado' });
    }

    // Buscar negocio por slug
    const { data: business, error } = await supabase
      .from('restaurants')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    if (error || !business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Agregar negocio al request
    req.business = business;
    next();
  } catch (error) {
    return res.status(500).json({ error: 'Error cargando negocio' });
  }
}

export function validateBusinessAccess(req, res, next) {
  // Verificar que el usuario tenga acceso a este negocio
  if (!req.user || !req.business) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  // SuperAdmin puede acceder a todo
  if (req.user.is_platform_admin) {
    return next();
  }

  // Usuario normal solo puede acceder a su propio negocio
  if (req.user.restaurant_id !== req.business.id) {
    return res.status(403).json({ error: 'No tienes acceso a este negocio' });
  }

  next();
};