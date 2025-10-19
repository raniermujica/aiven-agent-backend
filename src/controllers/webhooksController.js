import { supabase } from '../config/database.js';
import bcrypt from 'bcryptjs';

export async function handleReservationFromN8N(req, res) {
  try {
    const {
      businessSlug,
      customerName,
      customerPhone,
      reservationDate,
      reservationTime,
      partySize,
      specialRequests,
      conversationId,
    } = req.body;

    console.log('📥 Webhook recibido de N8N:', req.body);

    // Validaciones
    if (!businessSlug || !customerName || !customerPhone || !reservationDate || !reservationTime || !partySize) {
      return res.status(400).json({ 
        error: 'Faltan campos requeridos',
        required: ['businessSlug', 'customerName', 'customerPhone', 'reservationDate', 'reservationTime', 'partySize']
      });
    }

    // 1. Buscar el negocio por slug
    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('id, name, is_active')
      .eq('slug', businessSlug)
      .eq('is_active', true)
      .single();

    if (businessError || !business) {
      console.error('❌ Negocio no encontrado:', businessSlug);
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    console.log('✅ Negocio encontrado:', business.name);

    // 2. Buscar o crear cliente
    let customerId;
    
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('restaurant_id', business.id)
      .eq('phone', customerPhone)
      .single();

    if (existingCustomer) {
      customerId = existingCustomer.id;
      console.log('✅ Cliente existente encontrado:', customerId);
    } else {
      // Crear nuevo cliente
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          restaurant_id: business.id,
          name: customerName,
          phone: customerPhone,
          first_visit_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (customerError) {
        console.error('❌ Error creando cliente:', customerError);
        return res.status(500).json({ error: 'Error creando cliente' });
      }

      customerId = newCustomer.id;
      console.log('✅ Nuevo cliente creado:', customerId);
    }

    // 3. Verificar disponibilidad (simplificado)
    const { data: existingReservations } = await supabase
      .from('reservations')
      .select('id')
      .eq('restaurant_id', business.id)
      .eq('reservation_date', reservationDate)
      .eq('reservation_time', reservationTime);

    // Si hay más de 5 reservas a la misma hora, rechazar
    if (existingReservations && existingReservations.length >= 5) {
      console.log('⚠️ No hay disponibilidad');
      return res.status(409).json({ 
        success: false,
        error: 'No hay disponibilidad en ese horario',
        suggestAlternative: true
      });
    }

    // 4. Crear la reserva
    const { data: reservation, error: reservationError } = await supabase
      .from('reservations')
      .insert({
        restaurant_id: business.id,
        customer_id: customerId,
        reservation_date: reservationDate,
        reservation_time: reservationTime,
        party_size: partySize,
        special_requests: specialRequests,
        source: 'whatsapp',
        status: 'confirmed',
      })
      .select(`
        *,
        customers (
          id,
          name,
          phone
        )
      `)
      .single();

    if (reservationError) {
      console.error('❌ Error creando reserva:', reservationError);
      return res.status(500).json({ error: 'Error creando reserva' });
    }

    console.log('✅ Reserva creada exitosamente:', reservation.id);

    // 5. Guardar conversación si viene ID
    if (conversationId) {
      await supabase
        .from('ai_conversations')
        .insert({
          restaurant_id: business.id,
          customer_id: customerId,
          conversation_id: conversationId,
          platform: 'whatsapp',
          status: 'completed',
          reservation_id: reservation.id,
        });
    }

    // 6. Responder con éxito
    res.status(201).json({
      success: true,
      message: 'Reserva creada exitosamente',
      reservation: {
        id: reservation.id,
        customerName: reservation.customers.name,
        date: reservation.reservation_date,
        time: reservation.reservation_time,
        partySize: reservation.party_size,
        confirmationCode: reservation.id.substring(0, 8).toUpperCase(),
      }
    });

  } catch (error) {
    console.error('💥 Error en webhook:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

export async function checkAvailability(req, res) {
  try {
    const { businessSlug, date, time, partySize } = req.body;

    console.log('🔍 Consulta de disponibilidad:', { businessSlug, date, time, partySize });

    // Buscar negocio
    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('id, name, max_capacity')
      .eq('slug', businessSlug)
      .eq('is_active', true)
      .single();

    if (businessError || !business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Contar reservas existentes en esa fecha/hora
    const { data: existingReservations } = await supabase
      .from('reservations')
      .select('party_size')
      .eq('restaurant_id', business.id)
      .eq('reservation_date', date)
      .eq('reservation_time', time)
      .in('status', ['confirmed', 'pending', 'seated']);

    const totalCovers = existingReservations?.reduce((sum, r) => sum + r.party_size, 0) || 0;
    const requestedCovers = parseInt(partySize);
    const maxCapacity = business.max_capacity || 100;

    const available = (totalCovers + requestedCovers) <= maxCapacity;

    console.log(`✅ Disponibilidad: ${available ? 'SÍ' : 'NO'} (${totalCovers}/${maxCapacity} personas)`);

    res.json({
      available,
      currentOccupancy: totalCovers,
      maxCapacity,
      requestedPartySize: requestedCovers,
      alternativeTimes: available ? [] : getAlternativeTimes(time),
    });

  } catch (error) {
    console.error('Error verificando disponibilidad:', error);
    res.status(500).json({ error: 'Error verificando disponibilidad' });
  }
}

export async function saveConversation(req, res) {
  try {
    const {
      businessSlug,
      customerPhone,
      conversationId,
      messages,
      intent,
      status,
    } = req.body;

    console.log('💬 Guardando conversación:', conversationId);

    // Buscar negocio
    const { data: business } = await supabase
      .from('restaurants')
      .select('id')
      .eq('slug', businessSlug)
      .single();

    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Buscar cliente
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('restaurant_id', business.id)
      .eq('phone', customerPhone)
      .single();

    // Guardar conversación
    const { data: conversation, error } = await supabase
      .from('ai_conversations')
      .upsert({
        restaurant_id: business.id,
        customer_id: customer?.id,
        conversation_id: conversationId,
        platform: 'whatsapp',
        messages: messages,
        intent: intent,
        status: status || 'active',
      }, {
        onConflict: 'conversation_id'
      })
      .select()
      .single();

    if (error) {
      console.error('Error guardando conversación:', error);
      return res.status(500).json({ error: 'Error guardando conversación' });
    }

    console.log('✅ Conversación guardada');

    res.json({
      success: true,
      conversationId: conversation.id,
    });

  } catch (error) {
    console.error('Error guardando conversación:', error);
    res.status(500).json({ error: 'Error guardando conversación' });
  }
}

// Helper function
function getAlternativeTimes(originalTime) {
  const times = [];
  const [hours, minutes] = originalTime.split(':').map(Number);
  
  // Sugerir 1 hora antes y 1 hora después
  times.push(`${String(hours - 1).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
  times.push(`${String(hours + 1).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
  
  return times.filter(t => {
    const h = parseInt(t.split(':')[0]);
    return h >= 12 && h <= 23; // Solo horarios de almuerzo/cena
  });
};