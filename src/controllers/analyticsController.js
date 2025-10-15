import { supabase } from '../config/database.js';

export async function getDashboardStats(req, res) {
  try {
    const businessId = req.business.id;
    const today = new Date().toISOString().split('T')[0];

    // Reservas de hoy
    const { data: todayReservations } = await supabase
      .from('reservations')
      .select('status, party_size')
      .eq('restaurant_id', businessId)
      .eq('reservation_date', today);

    const todayStats = {
      total: todayReservations?.length || 0,
      confirmed: todayReservations?.filter(r => r.status === 'confirmed').length || 0,
      pending: todayReservations?.filter(r => r.status === 'pending').length || 0,
      completed: todayReservations?.filter(r => r.status === 'completed').length || 0,
      covers: todayReservations?.reduce((sum, r) => sum + (r.party_size || 0), 0) || 0,
    };

    // Clientes VIP hoy
    const { data: vipToday } = await supabase
      .from('reservations')
      .select(`
        customers!inner(is_vip)
      `)
      .eq('restaurant_id', businessId)
      .eq('reservation_date', today)
      .eq('customers.is_vip', true);

    // Ocupación estimada (simplificado)
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('max_capacity')
      .eq('id', businessId)
      .single();

    const occupancyRate = restaurant?.max_capacity 
      ? Math.round((todayStats.covers / restaurant.max_capacity) * 100)
      : 0;

    res.json({
      today: todayStats,
      vipToday: vipToday?.length || 0,
      occupancyRate,
    });

  } catch (error) {
    console.error('Error en getDashboardStats:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

export async function getMonthlyStats(req, res) {
  try {
    const businessId = req.business.id;
    
    // Primer día del mes actual
    const firstDay = new Date();
    firstDay.setDate(1);
    firstDay.setHours(0, 0, 0, 0);

    // Primer día del mes pasado
    const lastMonthFirstDay = new Date(firstDay);
    lastMonthFirstDay.setMonth(lastMonthFirstDay.getMonth() - 1);

    // Último día del mes pasado
    const lastMonthLastDay = new Date(firstDay);
    lastMonthLastDay.setDate(0);
    lastMonthLastDay.setHours(23, 59, 59, 999);

    // Stats este mes
    const { data: thisMonth } = await supabase
      .from('reservations')
      .select('status, party_size')
      .eq('restaurant_id', businessId)
      .gte('reservation_date', firstDay.toISOString().split('T')[0]);

    // Stats mes pasado
    const { data: lastMonth } = await supabase
      .from('reservations')
      .select('status, party_size')
      .eq('restaurant_id', businessId)
      .gte('reservation_date', lastMonthFirstDay.toISOString().split('T')[0])
      .lte('reservation_date', lastMonthLastDay.toISOString().split('T')[0]);

    const calculateStats = (data) => ({
      reservations: data?.length || 0,
      covers: data?.reduce((sum, r) => sum + (r.party_size || 0), 0) || 0,
      noShows: data?.filter(r => r.status === 'no_show').length || 0,
    });

    res.json({
      thisMonth: calculateStats(thisMonth),
      lastMonth: calculateStats(lastMonth),
    });

  } catch (error) {
    console.error('Error en getMonthlyStats:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

export async function getTopCustomers(req, res) {
  try {
    const businessId = req.business.id;
    const { limit = 10 } = req.query;

    const { data, error } = await supabase
      .from('customers')
      .select('id, name, total_visits')
      .eq('restaurant_id', businessId)
      .order('total_visits', { ascending: false })
      .limit(parseInt(limit));

    if (error) {
      console.error('Error obteniendo top customers:', error);
      return res.status(500).json({ error: 'Error obteniendo clientes' });
    }

    res.json({ customers: data });

  } catch (error) {
    console.error('Error en getTopCustomers:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};