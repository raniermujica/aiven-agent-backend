export const BUSINESS_TYPES = {
  restaurant: {
    name: 'Restaurante',
    icon: 'UtensilsCrossed',
    color: 'blue',
    terminology: {
      booking: 'Reserva',
      bookings: 'Reservas',
      customer: 'Cliente',
      customers: 'Clientes',
      resource: 'Mesa',
      resources: 'Mesas',
      staff: 'Mesero',
      capacity: 'Comensales',
      service: 'Servicio',
      services: 'Servicios',
    },
    features: {
      waitlist: true,
      tables: true,
      menuManagement: true,
    },
  },
  
  beauty_salon: {
    name: 'Salón de Belleza',
    icon: 'Scissors',
    color: 'pink',
    terminology: {
      booking: 'Cita',
      bookings: 'Citas',
      customer: 'Cliente',
      customers: 'Clientes',
      resource: 'Silla',
      resources: 'Sillas',
      staff: 'Estilista',
      capacity: 'Personas',
      service: 'Servicio',
      services: 'Servicios',
    },
    features: {
      waitlist: false,
      tables: false,
      menuManagement: true,
    },
  },
  
  aesthetic_clinic: {
    name: 'Clínica Estética',
    icon: 'Sparkles',
    color: 'purple',
    terminology: {
      booking: 'Cita',
      bookings: 'Citas',
      customer: 'Paciente',
      customers: 'Pacientes',
      resource: 'Sala',
      resources: 'Salas',
      staff: 'Especialista',
      capacity: 'Pacientes',
      service: 'Tratamiento',
      services: 'Tratamientos',
    },
    features: {
      waitlist: true,
      tables: false,
      menuManagement: true,
      medicalHistory: true,
    },
  },
  
  dental_clinic: {
    name: 'Clínica Dental',
    icon: 'Activity',
    color: 'teal',
    terminology: {
      booking: 'Cita',
      bookings: 'Citas',
      customer: 'Paciente',
      customers: 'Pacientes',
      resource: 'Consultorio',
      resources: 'Consultorios',
      staff: 'Odontólogo',
      capacity: 'Pacientes',
      service: 'Procedimiento',
      services: 'Procedimientos',
    },
    features: {
      waitlist: true,
      tables: false,
      menuManagement: true,
      medicalHistory: true,
    },
  },
  
  barbershop: {
    name: 'Barbería',
    icon: 'Scissors',
    color: 'amber',
    terminology: {
      booking: 'Cita',
      bookings: 'Citas',
      customer: 'Cliente',
      customers: 'Clientes',
      resource: 'Silla',
      resources: 'Sillas',
      staff: 'Barbero',
      capacity: 'Personas',
      service: 'Servicio',
      services: 'Servicios',
    },
    features: {
      waitlist: true,
      tables: false,
      menuManagement: true,
    },
  },
};

export function getBusinessTypeConfig(type) {
  return BUSINESS_TYPES[type] || BUSINESS_TYPES.restaurant;
};