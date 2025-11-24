import { supabase } from '../../config/database.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { addMinutes } = require('date-fns');
const { fromZonedTime, toZonedTime } = require('date-fns-tz');

/**
 * Motor de asignación automática de mesas para restaurantes
 */
class TableAssignmentEngine {

  /**
   * Encuentra la mejor mesa disponible para una reserva
   * @param {Object} params - Parámetros de la reserva
   */
  async findBestTable({ restaurantId, date, time, partySize, duration = 90, preference = null }) {
    try {
      console.log('[TableEngine] 🔍 Parámetros recibidos:', {
        restaurantId,
        date,
        time,
        partySize,
        partySizeType: typeof partySize,
        duration,
        preference
      });

      // 1. Verificar restaurante y obtener TIMEZONE
      const { data: restaurant, error: restError } = await supabase
        .from('restaurants')
        .select('business_type, config, timezone')
        .eq('id', restaurantId)
        .single();

      if (restError || !restaurant) {
        throw new Error('Restaurante no encontrado');
      }

      if (restaurant.business_type !== 'restaurant') {
        return {
          success: false,
          message: 'Este negocio no requiere asignación de mesas'
        };
      }

      // Timezone del negocio (Clave para arreglar el desfase)
      const timezone = restaurant.timezone || 'Europe/Madrid';

      // 2. Configuración
      const config = typeof restaurant.config === 'string'
        ? JSON.parse(restaurant.config)
        : restaurant.config;

      const fillOrder = config?.priorities?.fill_order || ['salon', 'terraza'];
      const tableSizeOrder = config?.priorities?.table_size_order || [2, 4, 6, 8];

      // 3. Obtener mesas activas
      const { data: allTables, error: tablesError } = await supabase
        .from('tables')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .eq('auto_assignable', true)
        .order('priority', { ascending: true });

      if (tablesError) throw tablesError;

      if (!allTables || allTables.length === 0) {
        return { success: false, message: 'No hay mesas disponibles' };
      }

      // 4. Filtrar mesas adecuadas por capacidad
      // 4. Filtrar mesas adecuadas por capacidad
      const suitableTables = allTables.filter(table => {
        const capacity = table.capacity || table.max_capacity || 0;
        const minCap = table.min_capacity || 1;
        const isMatch = partySize >= minCap && partySize <= capacity;

        console.log(`[TableEngine] Mesa ${table.table_number}: capacity=${capacity}, minCap=${minCap}, partySize=${partySize}, match=${isMatch}`);

        return isMatch;
      });

      console.log(`[TableEngine] ✅ Mesas adecuadas encontradas: ${suitableTables.length}/${allTables.length}`);

      // Si no hay mesas individuales, buscar combinaciones
      if (suitableTables.length === 0) {
        return await this.findTableCombinations({
          restaurantId,
          date,
          time,
          partySize,
          duration,
          allTables,
          timezone
        });
      }

      // 5. Calcular ventana de tiempo (CORREGIDO: Uso de fromZonedTime)
      // Convertimos la hora local "20:00" en Madrid al instante UTC correcto
      const localDateTimeStr = `${date}T${time}:00`;
      const reservationStartUTC = fromZonedTime(localDateTimeStr, timezone);
      const reservationEndUTC = addMinutes(reservationStartUTC, duration);

      console.log(`[TableEngine] Buscando hueco (UTC): ${reservationStartUTC.toISOString()} - ${reservationEndUTC.toISOString()}`);

      // 6. Obtener reservas conflictivas del día (En un rango amplio para filtrar en memoria)
      // Usamos UTC para la consulta a BD
      const startOfDayQuery = fromZonedTime(`${date}T00:00:00`, timezone).toISOString();
      const endOfDayQuery = fromZonedTime(`${date}T23:59:59`, timezone).toISOString();

      const { data: existingReservations, error: resError } = await supabase
        .from('appointments')
        .select('table_id, appointment_time, duration_minutes')
        .eq('restaurant_id', restaurantId)
        .gte('appointment_time', startOfDayQuery)
        .lte('appointment_time', endOfDayQuery)
        .in('status', ['pendiente', 'confirmado', 'en_mesa']);

      if (resError) throw resError;

      // 7. Evaluar disponibilidad de mesas
      const evaluatedTables = [];

      for (const table of suitableTables) {
        const isAvailable = this.checkTableAvailability({
          table,
          reservationStartUTC,
          reservationEndUTC,
          existingReservations: existingReservations || []
        });

        if (!isAvailable) continue;

        const score = this.calculateTableScore({
          table,
          partySize,
          preference,
          fillOrder,
          tableSizeOrder
        });

        evaluatedTables.push({
          table,
          score,
          reason: this.getAssignmentReason(table, partySize, score)
        });
      }

      // 8. Seleccionar la mejor
      evaluatedTables.sort((a, b) => b.score - a.score);

      if (evaluatedTables.length === 0) {
        return {
          success: false,
          message: 'No hay mesas disponibles en ese horario'
        };
      }

      const bestOption = evaluatedTables[0];

      return {
        success: true,
        table: bestOption.table,
        score: bestOption.score,
        reason: bestOption.reason,
        alternatives: evaluatedTables.slice(1, 3)
      };

    } catch (error) {
      console.error('[TableEngine] Error:', error);
      return { success: false, message: 'Error interno asignando mesa' };
    }
  }

  /**
   * Verifica disponibilidad temporal de una mesa
   */
  checkTableAvailability({ table, reservationStartUTC, reservationEndUTC, existingReservations }) {
    // Filtrar reservas de esta mesa específica
    const tableReservations = existingReservations.filter(r => r.table_id === table.id);

    for (const reservation of tableReservations) {
      // Las fechas de la BD ya vienen en UTC
      const resStart = new Date(reservation.appointment_time);
      const resDuration = reservation.duration_minutes || 90;
      const resEnd = addMinutes(resStart, resDuration);

      // Verificar solapamiento en UTC
      if (this.hasTimeOverlap(reservationStartUTC, reservationEndUTC, resStart, resEnd)) {
        return false;
      }
    }

    return true;
  }

  hasTimeOverlap(start1, end1, start2, end2) {
    return start1 < end2 && end1 > start2;
  }

  calculateTableScore({ table, partySize, preference, fillOrder, tableSizeOrder }) {
    let score = 100;
    const capacity = table.capacity || 0;

    // 1. Ajuste de capacidad (evitar mesas grandes para grupos pequeños)
    const wastedSeats = capacity - partySize;
    if (wastedSeats === 0) score += 40;
    else if (wastedSeats <= 2) score += 20;
    else score -= (wastedSeats * 5);

    // 2. Preferencia de zona
    if (preference && table.table_type === preference) score += 50;

    // 3. Prioridad configurada (menor número = mayor prioridad)
    score += Math.max(0, 20 - (table.priority || 0) * 2);

    return score;
  }

  getAssignmentReason(table, partySize, score) {
    return `Mesa ${table.table_number} (${table.capacity} pax) - Score: ${score}`;
  }

  async findTableCombinations({ restaurantId, date, time, partySize, duration, allTables, timezone }) {
    // Lógica para combinaciones (simplified for this snippet)
    // Se puede expandir igual que findBestTable usando fromZonedTime
    return {
      success: false,
      message: 'Combinación de mesas no implementada en esta versión'
    };
  }

  async findAlternativeTimes() {
    return [];
  }
}

export const tableAssignmentEngine = new TableAssignmentEngine();