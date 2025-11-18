import { supabase } from '../config/database.js';

/**
 * Get schedules configuration
 */
export async function getSchedulesConfig(req, res) {
  try {
    const businessId = req.business.id;

    const { data: business, error } = await supabase
      .from('restaurants')
      .select('config, business_hours')
      .eq('id', businessId)
      .single();

    if (error) throw error;

    const config = typeof business.config === 'string' 
      ? JSON.parse(business.config) 
      : business.config;

    // Default structure if doesn't exist
    const schedulesConfig = config?.schedules || {
      lunch: {
        enabled: true,
        start_time: '13:00',
        end_time: '16:00',
      },
      dinner: {
        enabled: true,
        start_time: '20:00',
        end_time: '23:00',
      },
    };

    const hours = {
      opening_time: config?.opening_time || '08:00',
      closing_time: config?.closing_time || '23:00',
    };

    res.json({
      schedules: schedulesConfig,
      hours,
    });

  } catch (error) {
    console.error('Error getting schedules:', error);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * Update schedules configuration
 */
export async function updateSchedulesConfig(req, res) {
  try {
    const businessId = req.business.id;
    const { schedules, hours } = req.body;

    // Validations
    if (!schedules || !hours) {
      return res.status(400).json({ error: 'Incomplete data' });
    }

    // Validate time format
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    
    if (!timeRegex.test(hours.opening_time) || !timeRegex.test(hours.closing_time)) {
      return res.status(400).json({ error: 'Invalid time format' });
    }

    if (schedules.lunch.enabled) {
      if (!timeRegex.test(schedules.lunch.start_time) || !timeRegex.test(schedules.lunch.end_time)) {
        return res.status(400).json({ error: 'Invalid lunch time format' });
      }
    }

    if (schedules.dinner.enabled) {
      if (!timeRegex.test(schedules.dinner.start_time) || !timeRegex.test(schedules.dinner.end_time)) {
        return res.status(400).json({ error: 'Invalid dinner time format' });
      }
    }

    // Get current config
    const { data: business, error: fetchError } = await supabase
      .from('restaurants')
      .select('config')
      .eq('id', businessId)
      .single();

    if (fetchError) throw fetchError;

    const currentConfig = typeof business.config === 'string' 
      ? JSON.parse(business.config) 
      : business.config || {};

    // Update config
    const updatedConfig = {
      ...currentConfig,
      schedules,
      opening_time: hours.opening_time,
      closing_time: hours.closing_time,
    };

    const { error: updateError } = await supabase
      .from('restaurants')
      .update({
        config: updatedConfig,
        updated_at: new Date().toISOString(),
      })
      .eq('id', businessId);

    if (updateError) throw updateError;

    res.json({
      message: 'Schedules configuration updated',
      schedules,
      hours,
    });

  } catch (error) {
    console.error('Error updating schedules:', error);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * Check if restaurant is open at given time
 */
export async function checkRestaurantOpen(req, res) {
  try {
    const businessId = req.business.id;
    const { date, time } = req.query;

    if (!date || !time) {
      return res.status(400).json({ error: 'Date and time required' });
    }

    const { data: business, error } = await supabase
      .from('restaurants')
      .select('config')
      .eq('id', businessId)
      .single();

    if (error) throw error;

    const config = typeof business.config === 'string' 
      ? JSON.parse(business.config) 
      : business.config;

    const openingTime = config?.opening_time || '08:00';
    const closingTime = config?.closing_time || '23:00';

    const isOpen = time >= openingTime && time <= closingTime;

    res.json({
      isOpen,
      openingTime,
      closingTime,
      message: isOpen 
        ? 'Restaurant is open' 
        : `Restaurant is closed. Hours: ${openingTime} - ${closingTime}`,
    });

  } catch (error) {
    console.error('Error checking restaurant status:', error);
    res.status(500).json({ error: 'Server error' });
  }
};