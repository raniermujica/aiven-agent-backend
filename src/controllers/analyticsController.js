import { supabase } from '../config/database.js';

// ================================================================
// GET OVERVIEW STATS
// ================================================================
export async function getOverviewStats(req, res) {
  try {
    const businessId = req.business.id;
    
    // Fechas para cálculos
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    // Inicio de esta semana (lunes)
    const startOfWeek = new Date(now);
    const dayOfWeek = startOfWeek.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Ajustar al lunes
    startOfWeek.setDate(startOfWeek.getDate() + diff);
    startOfWeek.setHours(0, 0, 0, 0);
    
    // Inicio del mes
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Citas de hoy
    const { count: appointmentsToday } = await supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', businessId)
      .gte('scheduled_date', `${today}T00:00:00Z`)
      .lte('scheduled_date', `${today}T23:59:59Z`);

    // Citas de esta semana
    const { count: appointmentsThisWeek } = await supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', businessId)
      .gte('scheduled_date', startOfWeek.toISOString());

    // Citas de este mes
    const { count: appointmentsThisMonth } = await supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', businessId)
      .gte('scheduled_date', startOfMonth.toISOString());

    // Total de clientes
    const { count: totalCustomers } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', businessId);

    // Nuevos clientes este mes
    const { count: newCustomersThisMonth } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', businessId)
      .gte('first_visit_at', startOfMonth.toISOString());

    // Clientes VIP
    const { count: vipCustomers } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', businessId)
      .eq('is_vip', true);

    res.json({
      appointments: {
        today: appointmentsToday || 0,
        thisWeek: appointmentsThisWeek || 0,
        thisMonth: appointmentsThisMonth || 0,
      },
      customers: {
        total: totalCustomers || 0,
        newThisMonth: newCustomersThisMonth || 0,
        vip: vipCustomers || 0,
      },
    });

  } catch (error) {
    console.error('Error en getOverviewStats:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// GET APPOINTMENTS BY STATUS
// ================================================================
export async function getAppointmentsByStatus(req, res) {
  try {
    const businessId = req.business.id;
    const { period = 'month' } = req.query;

    // Calcular fecha de inicio según período
    let startDate = new Date();
    if (period === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
    } else if (period === 'year') {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }

    const { data: appointments, error } = await supabase
      .from('appointments')
      .select('status')
      .eq('restaurant_id', businessId)
      .gte('scheduled_date', startDate.toISOString());

    if (error) {
      console.error('Error obteniendo citas por estado:', error);
      return res.status(500).json({ error: 'Error obteniendo datos' });
    }

    // Contar por estado
    const statusCounts = {
      pendiente: 0,
      confirmado: 0,
      completada: 0,
      cancelada: 0,
      no_show: 0,
    };

    appointments.forEach(apt => {
      if (statusCounts.hasOwnProperty(apt.status)) {
        statusCounts[apt.status]++;
      }
    });

    res.json(statusCounts);

  } catch (error) {
    console.error('Error en getAppointmentsByStatus:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// GET TOP SERVICES
// ================================================================
export async function getTopServices(req, res) {
  try {
    const businessId = req.business.id;
    const { limit = 10 } = req.query;

    // Obtener citas con servicios del último mes
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const { data: appointments, error } = await supabase
      .from('appointments')
      .select('service_name')
      .eq('restaurant_id', businessId)
      .gte('scheduled_date', oneMonthAgo.toISOString())
      .not('service_name', 'is', null);

    if (error) {
      console.error('Error obteniendo servicios:', error);
      return res.status(500).json({ error: 'Error obteniendo datos' });
    }

    // Contar ocurrencias de cada servicio
    const serviceCounts = {};
    appointments.forEach(apt => {
      const service = apt.service_name;
      serviceCounts[service] = (serviceCounts[service] || 0) + 1;
    });

    // Convertir a array y ordenar
    const topServices = Object.entries(serviceCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, parseInt(limit));

    res.json({ services: topServices });

  } catch (error) {
    console.error('Error en getTopServices:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// GET APPOINTMENTS TIMELINE (últimos 7 días)
// ================================================================
export async function getAppointmentsTimeline(req, res) {
  try {
    const businessId = req.business.id;
    const { days = 7 } = req.query;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    startDate.setHours(0, 0, 0, 0);

    const { data: appointments, error } = await supabase
      .from('appointments')
      .select('scheduled_date, status')
      .eq('restaurant_id', businessId)
      .gte('scheduled_date', startDate.toISOString())
      .order('scheduled_date', { ascending: true });

    if (error) {
      console.error('Error obteniendo timeline:', error);
      return res.status(500).json({ error: 'Error obteniendo datos' });
    }

    // Agrupar por día
    const timeline = {};
    for (let i = 0; i < parseInt(days); i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      timeline[dateKey] = {
        date: dateKey,
        total: 0,
        confirmado: 0,
        completada: 0,
        cancelada: 0,
      };
    }

    // Contar citas por día
    appointments.forEach(apt => {
      const dateKey = apt.scheduled_date.split('T')[0];
      if (timeline[dateKey]) {
        timeline[dateKey].total++;
        if (apt.status === 'confirmado') timeline[dateKey].confirmado++;
        if (apt.status === 'completada') timeline[dateKey].completada++;
        if (apt.status === 'cancelada') timeline[dateKey].cancelada++;
      }
    });

    res.json({ timeline: Object.values(timeline) });

  } catch (error) {
    console.error('Error en getAppointmentsTimeline:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

// ================================================================
// GET REVENUE STATS (si hay precios)
// ================================================================
export async function getRevenueStats(req, res) {
  try {
    const businessId = req.business.id;

    // Citas completadas del mes con servicios
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: appointments, error } = await supabase
      .from('appointments')
      .select(`
        service_id,
        services (
          price
        )
      `)
      .eq('restaurant_id', businessId)
      .eq('status', 'completada')
      .gte('scheduled_date', startOfMonth.toISOString());

    if (error) {
      console.error('Error obteniendo ingresos:', error);
      return res.status(500).json({ error: 'Error obteniendo datos' });
    }

    // Calcular ingresos estimados
    let totalRevenue = 0;
    let servicesWithPrice = 0;

    appointments.forEach(apt => {
      if (apt.services?.price) {
        totalRevenue += parseFloat(apt.services.price);
        servicesWithPrice++;
      }
    });

    res.json({
      estimatedRevenue: totalRevenue,
      completedAppointments: appointments.length,
      servicesWithPrice,
    });

  } catch (error) {
    console.error('Error en getRevenueStats:', error);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};