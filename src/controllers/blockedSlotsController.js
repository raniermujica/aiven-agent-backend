import { supabase } from '../config/database.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { fromZonedTime, toZonedTime } = require('date-fns-tz');

/**
 * Obtener todos los bloqueos de un negocio
 * GET /api/blocked-slots?startDate=2025-11-01&endDate=2025-11-30
 */
export async function getBlockedSlots(req, res) {
  try {
    const businessId = req.business.id;
    const { startDate, endDate } = req.query;

    let query = supabase
      .from('blocked_slots')
      .select('*')
      .eq('restaurant_id', businessId)
      .eq('is_active', true)
      .order('blocked_from', { ascending: true });

    // Filtrar por rango de fechas
    if (startDate) {
      const startUTC = new Date(startDate + 'T00:00:00Z');
      query = query.gte('blocked_from', startUTC.toISOString());
    }
    if (endDate) {
      const endUTC = new Date(endDate + 'T23:59:59Z');
      query = query.lte('blocked_until', endUTC.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    res.json({ blockedSlots: data || [] });
  } catch (error) {
    console.error('Error obteniendo bloqueos:', error);
    res.status(500).json({ error: 'Error al obtener bloqueos' });
  }
}

/**
 * Crear un nuevo bloqueo
 * POST /api/blocked-slots
 * Body: {
 *   block_type: 'full_day' | 'time_range' | 'maintenance',
 *   blocked_from: '2025-12-25T00:00:00',
 *   blocked_until: '2025-12-25T23:59:59',
 *   reason: 'Vacaciones de Navidad',
 *   table_id: null (opcional, para restaurantes)
 * }
 */
export async function createBlockedSlot(req, res) {
  try {
    const businessId = req.business.id;
    const userId = req.user.id;
    const { 
      block_type,
      blocked_from, 
      blocked_until, 
      reason,
      table_id,
      auto_unblock_at
    } = req.body;

    if (!block_type || !blocked_from || !blocked_until) {
      return res.status(400).json({ 
        error: 'block_type, blocked_from y blocked_until son requeridos' 
      });
    }

    // Validar que blocked_from < blocked_until
    const fromDate = new Date(blocked_from);
    const untilDate = new Date(blocked_until);

    if (fromDate >= untilDate) {
      return res.status(400).json({ 
        error: 'blocked_from debe ser anterior a blocked_until' 
      });
    }

    const { data, error } = await supabase
      .from('blocked_slots')
      .insert({
        restaurant_id: businessId,
        table_id: table_id || null,
        block_type,
        blocked_from: fromDate.toISOString(),
        blocked_until: untilDate.toISOString(),
        auto_unblock_at: auto_unblock_at ? new Date(auto_unblock_at).toISOString() : null,
        reason: reason || null,
        blocked_by: userId,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.status(201).json({ blockedSlot: data });
  } catch (error) {
    console.error('Error creando bloqueo:', error);
    res.status(500).json({ error: 'Error al crear bloqueo' });
  }
}

/**
 * Actualizar un bloqueo
 * PATCH /api/blocked-slots/:blockId
 */
export async function updateBlockedSlot(req, res) {
  try {
    const businessId = req.business.id;
    const { blockId } = req.params;
    const { 
      block_type,
      blocked_from, 
      blocked_until, 
      reason,
      is_active
    } = req.body;

    // Verificar que el bloqueo pertenece al negocio
    const { data: existing, error: checkError } = await supabase
      .from('blocked_slots')
      .select('id')
      .eq('id', blockId)
      .eq('restaurant_id', businessId)
      .single();

    if (checkError || !existing) {
      return res.status(404).json({ error: 'Bloqueo no encontrado' });
    }

    const updateData = {};
    if (block_type !== undefined) updateData.block_type = block_type;
    if (blocked_from !== undefined) updateData.blocked_from = new Date(blocked_from).toISOString();
    if (blocked_until !== undefined) updateData.blocked_until = new Date(blocked_until).toISOString();
    if (reason !== undefined) updateData.reason = reason;
    if (is_active !== undefined) updateData.is_active = is_active;

    // Validar fechas si se actualizan
    if (updateData.blocked_from && updateData.blocked_until) {
      if (new Date(updateData.blocked_from) >= new Date(updateData.blocked_until)) {
        return res.status(400).json({ 
          error: 'blocked_from debe ser anterior a blocked_until' 
        });
      }
    }

    const { data, error } = await supabase
      .from('blocked_slots')
      .update(updateData)
      .eq('id', blockId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({ blockedSlot: data });
  } catch (error) {
    console.error('Error actualizando bloqueo:', error);
    res.status(500).json({ error: 'Error al actualizar bloqueo' });
  }
}

/**
 * Eliminar un bloqueo (soft delete)
 * DELETE /api/blocked-slots/:blockId
 */
export async function deleteBlockedSlot(req, res) {
  try {
    const businessId = req.business.id;
    const { blockId } = req.params;

    // Verificar que el bloqueo pertenece al negocio
    const { data: existing, error: checkError } = await supabase
      .from('blocked_slots')
      .select('id')
      .eq('id', blockId)
      .eq('restaurant_id', businessId)
      .single();

    if (checkError || !existing) {
      return res.status(404).json({ error: 'Bloqueo no encontrado' });
    }

    // Soft delete: marcar como inactivo
    const { error } = await supabase
      .from('blocked_slots')
      .update({ is_active: false })
      .eq('id', blockId);

    if (error) {
      throw error;
    }

    res.json({ success: true, message: 'Bloqueo eliminado' });
  } catch (error) {
    console.error('Error eliminando bloqueo:', error);
    res.status(500).json({ error: 'Error al eliminar bloqueo' });
  }
}

/**
 * Verificar si una fecha/hora tiene bloqueos
 * POST /api/blocked-slots/check
 * Body: { date: '2025-12-25', time: '10:00' } o { datetime: '2025-12-25T10:00:00' }
 */
export async function checkBlocked(req, res) {
  try {
    const businessId = req.business.id;
    const { date, time, datetime } = req.body;

    let checkTime;
    if (datetime) {
      checkTime = new Date(datetime);
    } else if (date && time) {
      checkTime = new Date(`${date}T${time}:00`);
    } else {
      return res.status(400).json({ error: 'Se requiere datetime o date+time' });
    }

    const { data: blocks, error } = await supabase
      .from('blocked_slots')
      .select('*')
      .eq('restaurant_id', businessId)
      .eq('is_active', true)
      .lte('blocked_from', checkTime.toISOString())
      .gte('blocked_until', checkTime.toISOString());

    if (error) {
      throw error;
    }

    const isBlocked = blocks && blocks.length > 0;
    const blockReason = isBlocked ? blocks[0].reason : null;

    res.json({ 
      isBlocked, 
      reason: blockReason,
      blocks: blocks || []
    });
  } catch (error) {
    console.error('Error verificando bloqueo:', error);
    res.status(500).json({ error: 'Error al verificar bloqueo' });
  }
};