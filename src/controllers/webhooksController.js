import { supabase } from '../config/database.js';

// ================================================================
// FUNCIONES HELPER
// ================================================================

/**
 * Formatea servicios según el tipo de negocio para el prompt
 */
function formatServicesForPrompt(services, businessType) {
  if (!services || services.length === 0) {
    return 'No hay servicios disponibles en este momento.';
  }

  const formatted = services.map((service, index) => {
    const emoji = service.emoji || getDefaultEmoji(service.category, businessType);
    const price = service.price ? `€${service.price}` : 'Precio a consultar';
    const duration = service.duration_minutes ? `${service.duration_minutes}min` : '';
    
    // Formato según tipo de negocio
    switch (businessType) {
      case 'restaurant':
        return `${emoji} ${service.name} - ${price}${service.description ? `\n   ${service.description}` : ''}`;
      
      case 'beauty_salon':
      case 'barbershop':
        return `${emoji} ${service.name} (${price}, ${duration})${service.description ? `\n   ${service.description}` : ''}`;
      
      case 'aesthetic_clinic':
      case 'dental_clinic':
        return `${emoji} ${service.name} - ${price} | Duración: ${duration}${service.description ? `\n   ${service.description}` : ''}`;
      
      default:
        return `${emoji} ${service.name} - ${price}`;
    }
  }).join('\n\n');

  return formatted;
}

/**
 * Obtiene emoji por defecto según categoría y tipo de negocio
 */
function getDefaultEmoji(category, businessType) {
  const emojiMap = {
    beauty_salon: {
      'cabello': '💇‍♀️',
      'uñas': '💅',
      'facial': '✨',
      'corporal': '💆‍♀️',
      'depilacion': '🪒',
      'maquillaje': '💄',
      'default': '✨'
    },
    restaurant: {
      'entrada': '🥗',
      'principal': '🍽️',
      'postre': '🍰',
      'bebida': '🍷',
      'menu': '📋',
      'default': '🍴'
    },
    aesthetic_clinic: {
      'facial': '💉',
      'corporal': '💆',
      'laser': '✨',
      'rejuvenecimiento': '🌟',
      'default': '🏥'
    },
    dental_clinic: {
      'limpieza': '🦷',
      'ortodoncia': '😁',
      'implantes': '🔧',
      'estetica': '✨',
      'default': '🦷'
    },
    barbershop: {
      'corte': '✂️',
      'barba': '💈',
      'afeitado': '🪒',
      'combo': '💈',
      'default': '💈'
    }
  };

  const typeEmojis = emojiMap[businessType] || emojiMap['beauty_salon'];
  return typeEmojis[category?.toLowerCase()] || typeEmojis['default'];
}

/**
 * Reemplaza placeholders en el template con valores reales
 */
function replacePlaceholders(template, values) {
  let result = template;
  
  for (const [key, value] of Object.entries(values)) {
    const placeholder = `{${key}}`;
    result = result.replaceAll(placeholder, value || '');
  }
  
  return result;
}

// ================================================================
// ENDPOINTS PRINCIPALES
// ================================================================

/**
 * GET /api/webhooks/n8n/business-config/:businessSlug
 * Obtiene configuración completa del negocio + servicios + prompt template
 */
export async function getBusinessConfig(req, res) {
  try {
    const { businessSlug } = req.params;

    console.log('🔍 Obteniendo configuración para:', businessSlug);

    // 1. Obtener negocio
    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('*')
      .eq('slug', businessSlug)
      .eq('is_active', true)
      .single();

    if (businessError || !business) {
      console.error('❌ Negocio no encontrado:', businessSlug);
      return res.status(404).json({ 
        error: 'Negocio no encontrado',
        slug: businessSlug 
      });
    }

    console.log('✅ Negocio encontrado:', business.name, '| Tipo:', business.business_type);

    // 2. Obtener servicios activos del negocio
    const { data: services, error: servicesError } = await supabase
      .from('services')
      .select('*')
      .eq('restaurant_id', business.id)
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('category')
      .order('price');

    if (servicesError) {
      console.error('❌ Error obteniendo servicios:', servicesError);
      return res.status(500).json({ error: 'Error obteniendo servicios' });
    }

    console.log('✅ Servicios encontrados:', services?.length || 0);

    // 3. Obtener prompt template según business_type
    const { data: promptTemplate, error: promptError } = await supabase
      .from('prompt_templates')
      .select('content, variables, template_type')
      .eq('business_type', business.business_type)
      .eq('template_type', 'system')
      .eq('is_active', true)
      .eq('language', 'es')
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (promptError && promptError.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('⚠️ Error obteniendo prompt template:', promptError);
    }

    console.log('✅ Prompt template:', promptTemplate ? 'encontrado' : 'usando genérico');

    // 4. Formatear servicios según el negocio
    const servicesFormatted = formatServicesForPrompt(services, business.business_type);

    // 5. Extraer configuración del negocio
    const config = business.config || {};
    const assistantConfig = config.assistant_config || {};
    const terminology = config.terminology || {};

    // 6. Preparar valores para reemplazar en el prompt
    const promptValues = {
      assistant_name: assistantConfig.name || business.assistant_name || 'Asistente Virtual',
      business_name: business.name,
      business_description: business.description || config.description || `${business.name} - Tu mejor elección`,
      business_address: business.address || 'Dirección no disponible',
      business_phone: business.phone || business.whatsapp_number || 'Teléfono no disponible',
      business_email: business.email || '',
      business_hours: business.business_hours || config.business_hours || 'Consultar horarios',
      services_formatted: servicesFormatted,
      tone: assistantConfig.tone || 'amigable y profesional',
      cuisine_type: config.business_specific?.cuisine_type || ''
    };

    // 7. Reemplazar variables en el prompt (o usar genérico si no hay template)
    let systemPrompt;
    
    if (promptTemplate) {
      systemPrompt = replacePlaceholders(promptTemplate.content, promptValues);
    } else {
      // Prompt genérico por defecto
      systemPrompt = `Eres ${promptValues.assistant_name}, asistente virtual de ${promptValues.business_name}.

INFORMACIÓN DEL NEGOCIO:
${promptValues.business_description}
Dirección: ${promptValues.business_address}
Teléfono: ${promptValues.business_phone}
Horario: ${promptValues.business_hours}

SERVICIOS DISPONIBLES:
${promptValues.services_formatted}

TU MISIÓN:
1. Ayudar a los clientes a agendar citas
2. Responder preguntas sobre servicios y precios
3. Ser ${promptValues.tone}

Si el cliente quiere agendar, usa: AGENDAR: [servicio] [fecha YYYY-MM-DD] [hora HH:MM]`;
    }

    // 8. Respuesta final
    const response = {
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        type: business.business_type,
        description: business.description || config.description,
        address: business.address,
        phone: business.phone,
        email: business.email,
        whatsapp_number: business.whatsapp_number,
        business_hours: business.business_hours || config.business_hours,
        business_hours_detailed: config.business_hours_detailed,
        max_capacity: business.max_capacity,
        timezone: business.timezone,
        assistant_config: assistantConfig,
        terminology: terminology,
        is_ai_paused: business.is_ai_paused
      },
      services: services || [],
      system_prompt: systemPrompt,
      terminology: terminology
    };

    console.log('✅ Configuración preparada exitosamente');
    res.json(response);

  } catch (error) {
    console.error('❌ Error en getBusinessConfig:', error);
    res.status(500).json({ 
      error: 'Error en el servidor',
      message: error.message 
    });
  }
}

/**
 * GET /api/webhooks/n8n/business/:businessSlug
 * Endpoint simplificado (mantener por compatibilidad)
 */
export async function getBusinessInfo(req, res) {
  try {
    const { businessSlug } = req.params;

    const { data: business, error } = await supabase
      .from('restaurants')
      .select('id, name, slug, business_type, config, max_capacity')
      .eq('slug', businessSlug)
      .eq('is_active', true)
      .single();

    if (error || !business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    res.json({
      id: business.id,
      name: business.name,
      slug: business.slug,
      type: business.business_type,
      maxCapacity: business.max_capacity,
      config: business.config
    });

  } catch (error) {
    console.error('Error en getBusinessInfo:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

/**
 * POST /api/webhooks/n8n/check-availability
 * Verifica disponibilidad para una fecha/hora
 */
export async function checkAvailability(req, res) {
  try {
    const { businessSlug, date, time, partySize } = req.body;

    if (!businessSlug || !date || !time) {
      return res.status(400).json({ 
        error: 'businessSlug, date y time son requeridos' 
      });
    }

    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('id, name, max_capacity')
      .eq('slug', businessSlug)
      .eq('is_active', true)
      .single();

    if (businessError || !business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const { data: existingReservations, error: reservationsError } = await supabase
      .from('reservations')
      .select('party_size')
      .eq('restaurant_id', business.id)
      .eq('reservation_date', date)
      .eq('reservation_time', time)
      .in('status', ['confirmed', 'pending', 'seated']);

    if (reservationsError) {
      console.error('Error verificando disponibilidad:', reservationsError);
      return res.status(500).json({ error: 'Error verificando disponibilidad' });
    }

    const occupiedCapacity = existingReservations.reduce(
      (sum, r) => sum + (r.party_size || 0), 
      0
    );

    const availableCapacity = business.max_capacity - occupiedCapacity;
    const isAvailable = availableCapacity >= (partySize || 1);

    res.json({
      available: isAvailable,
      availableCapacity,
      maxCapacity: business.max_capacity,
      occupiedCapacity,
      businessName: business.name
    });

  } catch (error) {
    console.error('Error en checkAvailability:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

/**
 * POST /api/webhooks/n8n/reservation
 * Crea reserva desde WhatsApp (N8N)
 */
export async function createReservationFromWhatsApp(req, res) {
  try {
    const {
      businessSlug,
      customerName,
      customerPhone,
      reservationDate,
      reservationTime,
      partySize,
      specialRequests,
      conversationId
    } = req.body;

    if (!businessSlug || !customerName || !customerPhone || !reservationDate || !reservationTime) {
      return res.status(400).json({ 
        error: 'Faltan datos requeridos para crear la reserva' 
      });
    }

    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('id, name')
      .eq('slug', businessSlug)
      .eq('is_active', true)
      .single();

    if (businessError || !business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    let customerId;
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('restaurant_id', business.id)
      .eq('phone', customerPhone)
      .single();

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          restaurant_id: business.id,
          name: customerName,
          phone: customerPhone,
          first_visit_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (customerError) {
        console.error('Error creando cliente:', customerError);
        return res.status(500).json({ error: 'Error creando cliente' });
      }

      customerId = newCustomer.id;
    }

    const { data: reservation, error: reservationError } = await supabase
      .from('reservations')
      .insert({
        restaurant_id: business.id,
        customer_id: customerId,
        reservation_date: reservationDate,
        reservation_time: reservationTime,
        party_size: partySize || 2,
        special_requests: specialRequests,
        source: 'whatsapp',
        status: 'confirmed',
      })
      .select(`
        *,
        customers (
          name,
          phone
        )
      `)
      .single();

    if (reservationError) {
      console.error('Error creando reserva:', reservationError);
      return res.status(500).json({ error: 'Error creando reserva' });
    }

    if (conversationId) {
      await supabase
        .from('ai_conversations')
        .insert({
          restaurant_id: business.id,
          customer_id: customerId,
          conversation_id: conversationId,
          platform: 'whatsapp',
          intent: 'booking',
          status: 'completed',
          reservation_id: reservation.id
        });
    }

    res.status(201).json({
      success: true,
      reservation: {
        id: reservation.id,
        customerName: reservation.customers.name,
        date: reservation.reservation_date,
        time: reservation.reservation_time,
        partySize: reservation.party_size,
        status: reservation.status
      },
      message: `Reserva confirmada para ${customerName} el ${reservationDate} a las ${reservationTime}`
    });

  } catch (error) {
    console.error('Error en createReservationFromWhatsApp:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

/**
 * POST /api/webhooks/n8n/conversation
 * Guarda conversación con el agente IA
 */
export async function saveConversation(req, res) {
  try {
    const {
      businessSlug,
      customerPhone,
      conversationId,
      messages,
      intent,
      status
    } = req.body;

    if (!businessSlug || !customerPhone || !conversationId) {
      return res.status(400).json({ 
        error: 'businessSlug, customerPhone y conversationId son requeridos' 
      });
    }

    const { data: business, error: businessError } = await supabase
      .from('restaurants')
      .select('id')
      .eq('slug', businessSlug)
      .eq('is_active', true)
      .single();

    if (businessError || !business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('restaurant_id', business.id)
      .eq('phone', customerPhone)
      .single();

    const { data, error } = await supabase
      .from('ai_conversations')
      .upsert({
        restaurant_id: business.id,
        customer_id: customer?.id,
        conversation_id: conversationId,
        platform: 'whatsapp',
        messages: messages || [],
        intent: intent || 'unknown',
        status: status || 'active'
      }, {
        onConflict: 'conversation_id'
      })
      .select()
      .single();

    if (error) {
      console.error('Error guardando conversación:', error);
      return res.status(500).json({ error: 'Error guardando conversación' });
    }

    res.json({ 
      success: true,
      conversation: data 
    });

  } catch (error) {
    console.error('Error en saveConversation:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};