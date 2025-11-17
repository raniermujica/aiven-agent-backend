import { supabase } from '../../config/database.js';
import { format, parseISO, addMinutes } from 'date-fns';

/**
 * Motor de asignación automática de mesas para restaurantes
 */
class TableAssignmentEngine {

  /**
   * Encuentra la mejor mesa disponible para una reserva
   * @param {Object} params - Parámetros de la reserva
   * @param {string} params.restaurantId - ID del restaurante
   * @param {string} params.date - Fecha en formato YYYY-MM-DD
   * @param {string} params.time - Hora en formato HH:MM
   * @param {number} params.partySize - Número de personas
   * @param {number} params.duration - Duración en minutos (default: 90)
   * @param {string} params.preference - Preferencia: 'salon', 'terraza', null
   * @returns {Promise<Object>} - Mesa asignada con score y razón
   */
  async findBestTable({ restaurantId, date, time, partySize, duration = 90, preference = null }) {
    try {
      console.log('[TableEngine] Buscando mesa para:', { restaurantId, date, time, partySize, duration, preference });

      // 1. Verificar que el restaurante sea tipo restaurant
      const { data: restaurant, error: restError } = await supabase
        .from('restaurants')
        .select('business_type, config')
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

      // 2. Obtener configuración del restaurante
      const config = typeof restaurant.config === 'string'
        ? JSON.parse(restaurant.config)
        : restaurant.config;

      const fillOrder = config?.priorities?.fill_order || ['salon', 'terraza'];
      const tableSizeOrder = config?.priorities?.table_size_order || [2, 4, 6, 8];

      // 3. Obtener todas las mesas activas
      const { data: allTables, error: tablesError } = await supabase
        .from('tables')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .eq('auto_assignable', true)
        .order('priority', { ascending: true });

      if (tablesError) throw tablesError;

      if (!allTables || allTables.length === 0) {
        return {
          success: false,
          message: 'No hay mesas disponibles en este restaurante'
        };
      }

      // 4. Filtrar mesas con capacidad suficiente
      const suitableTables = allTables.filter(table => {
        const capacity = table.capacity || table.max_capacity || 0;
        const minCap = table.min_capacity || 1;
        return partySize >= minCap && partySize <= capacity;
      });

      if (suitableTables.length === 0) {
        return await this.findTableCombinations({
          restaurantId,
          date,
          time,
          partySize,
          duration,
          allTables
        });
      }

      // 5. Calcular ventana de tiempo de la reserva
      const reservationStart = new Date(`${date}T${time}:00Z`);
      const reservationEnd = addMinutes(reservationStart, duration);

      // 6. Obtener reservas conflictivas para cada mesa (🔧 APPOINTMENTS)
      const { data: existingReservations, error: resError } = await supabase
        .from('appointments')
        .select('table_id, scheduled_date, appointment_time, duration_minutes')
        .eq('restaurant_id', restaurantId)
        .gte('scheduled_date', date)
        .lte('scheduled_date', date)
        .in('status', ['pendiente', 'confirmado']);

      if (resError) throw resError;

      // 7. Evaluar cada mesa
      const evaluatedTables = [];

      for (const table of suitableTables) {
        // Verificar disponibilidad temporal
        const isAvailable = await this.checkTableAvailability({
          table,
          reservationStart,
          reservationEnd,
          existingReservations: existingReservations || []
        });

        if (!isAvailable) continue;

        // Calcular score
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

      // 8. Ordenar por score y retornar la mejor
      evaluatedTables.sort((a, b) => b.score - a.score);

      if (evaluatedTables.length === 0) {
        return {
          success: false,
          message: 'No hay mesas disponibles en ese horario',
          suggestedTimes: await this.findAlternativeTimes({ restaurantId, date, partySize, duration })
        };
      }

      const bestOption = evaluatedTables[0];

      console.log('[TableEngine] Mejor mesa encontrada:', {
        tableNumber: bestOption.table.table_number,
        score: bestOption.score,
        reason: bestOption.reason
      });

      return {
        success: true,
        table: bestOption.table,
        score: bestOption.score,
        reason: bestOption.reason,
        alternatives: evaluatedTables.slice(1, 3)
      };

    } catch (error) {
      console.error('[TableEngine] Error:', error);
      return {
        success: false,
        message: 'Error al buscar mesa disponible',
        error: error.message
      };
    }
  }

  /**
   * Verifica si una mesa está disponible en el horario solicitado
   */
  async checkTableAvailability({ table, reservationStart, reservationEnd, existingReservations }) {
    // Filtrar reservas de esta mesa
    const tableReservations = existingReservations.filter(r => r.table_id === table.id);

    for (const reservation of tableReservations) {
      const resStart = new Date(`${reservation.scheduled_date}T${new Date(reservation.appointment_time).toISOString().split('T')[1]}`);
      const resDuration = reservation.duration_minutes || 90;
      const resEnd = addMinutes(resStart, resDuration);

      // Verificar solapamiento
      if (this.hasTimeOverlap(reservationStart, reservationEnd, resStart, resEnd)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Verifica solapamiento de horarios
   */
  hasTimeOverlap(start1, end1, start2, end2) {
    return start1 < end2 && end1 > start2;
  }

  /**
   * Calcula el score de una mesa para la reserva
   * Score más alto = mejor opción
   */
  calculateTableScore({ table, partySize, preference, fillOrder, tableSizeOrder }) {
    let score = 100;

    const capacity = table.capacity || table.max_capacity || 0;

    // 1. EFICIENCIA DE ASIENTOS (40 puntos)
    // Penalizar desperdicio de asientos
    const wastedSeats = capacity - partySize;
    const wastePercentage = wastedSeats / capacity;

    if (wastePercentage === 0) {
      score += 40; // Ajuste perfecto
    } else if (wastePercentage <= 0.25) {
      score += 30; // Buen ajuste
    } else if (wastePercentage <= 0.5) {
      score += 15; // Ajuste aceptable
    } else {
      score += 0; // Mucho desperdicio
    }

    // 2. PRIORIDAD DE ZONA (20 puntos)
    if (preference && table.table_type === preference) {
      score += 20; // Cliente pidió esta zona
    } else {
      const zoneIndex = fillOrder.indexOf(table.table_type);
      if (zoneIndex !== -1) {
        score += 20 - (zoneIndex * 5); // Primeras zonas tienen más puntos
      }
    }

    // 3. TAMAÑO PREFERIDO (15 puntos)
    const sizeIndex = tableSizeOrder.indexOf(capacity);
    if (sizeIndex !== -1) {
      score += 15 - (sizeIndex * 3);
    }

    // 4. PRIORIDAD DE MESA (25 puntos)
    // Mesa con menor prioridad numérica tiene más puntos
    const maxPriority = 10;
    const priorityScore = Math.max(0, 25 - (table.priority || 0) * 2);
    score += priorityScore;

    return Math.round(score);
  }

  /**
   * Genera razón legible de por qué se asignó esta mesa
   */
  getAssignmentReason(table, partySize, score) {
    const capacity = table.capacity || table.max_capacity || 0;
    const wastedSeats = capacity - partySize;

    let reason = `Mesa ${table.table_number}`;

    if (wastedSeats === 0) {
      reason += ` - Capacidad perfecta para ${partySize} personas`;
    } else if (wastedSeats === 1) {
      reason += ` - Buen ajuste (${capacity} plazas para ${partySize})`;
    } else {
      reason += ` - Disponible (${capacity} plazas)`;
    }

    if (table.table_type) {
      reason += ` - Zona ${table.table_type}`;
    }

    return reason;
  }

  /**
   * Busca combinaciones de mesas para grupos grandes
   */
  async findTableCombinations({ restaurantId, date, time, partySize, duration, allTables }) {
    console.log('[TableEngine] Buscando combinaciones de mesas para', partySize, 'personas');

    // Obtener combinaciones predefinidas
    const { data: combinations, error } = await supabase
      .from('table_combinations')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .gte('total_capacity', partySize)
      .lte('min_capacity', partySize);

    if (error) {
      console.error('[TableEngine] Error buscando combinaciones:', error);
    }

    if (combinations && combinations.length > 0) {
      // Verificar disponibilidad de cada combinación
      const reservationStart = new Date(`${date}T${time}:00Z`);
      const reservationEnd = addMinutes(reservationStart, duration);

      for (const combo of combinations) {
        const allAvailable = await this.checkCombinationAvailability({
          combination: combo,
          reservationStart,
          reservationEnd,
          restaurantId,
          date
        });

        if (allAvailable) {
          return {
            success: true,
            combination: combo,
            type: 'combination',
            reason: `Combinación ${combo.name} - ${combo.total_capacity} plazas`
          };
        }
      }
    }

    return {
      success: false,
      message: `No hay mesas individuales ni combinaciones disponibles para ${partySize} personas`
    };
  }

  /**
   * Verifica disponibilidad de una combinación de mesas
   */
  async checkCombinationAvailability({ combination, reservationStart, reservationEnd, restaurantId, date }) {
    const { data: reservations, error } = await supabase
      .from('reservations')
      .select('table_id, reservation_date, reservation_time, estimated_duration_minutes')
      .eq('restaurant_id', restaurantId)
      .eq('reservation_date', date)
      .in('table_id', combination.table_ids)
      .in('status', ['pending', 'confirmed', 'seated']);

    if (error) return false;

    // Verificar que ninguna mesa de la combinación tenga reservas en conflicto
    for (const res of reservations || []) {
      const resStart = new Date(`${res.reservation_date}T${res.reservation_time}Z`);
      const resEnd = addMinutes(resStart, res.estimated_duration_minutes || 90);

      if (this.hasTimeOverlap(reservationStart, reservationEnd, resStart, resEnd)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Encuentra horarios alternativos si no hay disponibilidad
   */
  async findAlternativeTimes({ restaurantId, date, partySize, duration }) {
    // TODO: Implementar búsqueda de horarios alternativos
    // Por ahora retornar array vacío
    return [];
  }
}

export const tableAssignmentEngine = new TableAssignmentEngine();