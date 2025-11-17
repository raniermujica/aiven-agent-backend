import { supabase } from '../config/database.js';

export async function loadBusinessFromSlug(req, res, next) {
  try {
    // Buscar slug en diferentes lugares (normalizar a minúsculas)
    const slug = 
      req.headers['x-business-slug'] || 
      req.body?.slug || 
      req.query?.slug;
    
    console.log('🔍 [Tenant] Slug recibido:', slug);

    if (!slug) {
      console.log('❌ [Tenant] Slug no proporcionado');
      return res.status(400).json({ error: 'Slug del negocio no proporcionado' });
    }

    // Buscar negocio por slug
    const { data: business, error } = await supabase
      .from('restaurants')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();

    console.log('🔍 [Tenant] Negocio encontrado:', business ? business.name : 'NULL');

    if (error || !business) {
      console.log('❌ [Tenant] Negocio no encontrado, error:', error);
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Agregar negocio al request
    req.business = business;
    console.log('✅ [Tenant] Negocio agregado a req.business');
    next();
  } catch (error) {
    console.log('❌ [Tenant] Error en loadBusinessFromSlug:', error.message);
    return res.status(500).json({ error: 'Error cargando negocio' });
  }
}

export function validateBusinessAccess(req, res, next) {
  console.log('🔍 [ValidateAccess] Verificando acceso...');
  console.log('🔍 [ValidateAccess] req.user existe:', !!req.user);
  console.log('🔍 [ValidateAccess] req.business existe:', !!req.business);
  
  // Verificar que el usuario tenga acceso a este negocio
  if (!req.user || !req.business) {
    console.log('❌ [ValidateAccess] No autenticado - user:', !!req.user, 'business:', !!req.business);
    return res.status(401).json({ error: 'No autenticado' });
  }

  // SuperAdmin puede acceder a todo
  if (req.user.is_platform_admin) {
    console.log('✅ [ValidateAccess] SuperAdmin - acceso total');
    return next();
  }

  console.log('🔍 [ValidateAccess] user.restaurant_id:', req.user.restaurant_id);
  console.log('🔍 [ValidateAccess] business.id:', req.business.id);

  // Usuario normal solo puede acceder a su propio negocio
  if (req.user.restaurant_id !== req.business.id) {
    console.log('❌ [ValidateAccess] No tienes acceso a este negocio');
    return res.status(403).json({ error: 'No tienes acceso a este negocio' });
  }

  console.log('✅ [ValidateAccess] Acceso permitido');
  next();
};