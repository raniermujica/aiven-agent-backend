import request from 'supertest';
import { jest } from '@jest/globals';

const mockSingle = jest.fn();
const mockInsert = jest.fn();
const mockDefaultQuery = jest.fn().mockResolvedValue({ data: [], error: null });

const mockChain = {
  select: jest.fn(() => mockChain),
  eq: jest.fn(() => mockChain),
  gte: jest.fn(() => mockChain),
  lte: jest.fn(() => mockChain),
  is: jest.fn(() => mockChain),
  order: jest.fn(() => mockChain),
  limit: jest.fn(() => mockChain),
  neq: jest.fn(() => mockChain),
  single: mockSingle,
  insert: mockInsert,
  delete: jest.fn(() => mockChain),
  update: jest.fn(() => mockChain),
  then: mockDefaultQuery,
};
const mockSupabaseFrom = jest.fn(() => mockChain);

const mockAuthMiddleware = jest.fn((req, res, next) => next());
const mockTenantMiddleware = jest.fn((req, res, next) => next());
const mockRoleMiddleware = jest.fn((...roles) => (req, res, next) => next());
const mockSuperAdminMiddleware = jest.fn((req, res, next) => next());

jest.unstable_mockModule('../config/database.js', () => ({
  supabase: {
    from: mockSupabaseFrom,
  },
}));

jest.unstable_mockModule('../middleware/auth.js', () => ({
  authenticateToken: mockAuthMiddleware,
  requireRole: mockRoleMiddleware,
  requireSuperAdmin: mockSuperAdminMiddleware,
}));

jest.unstable_mockModule('../middleware/tenant.js', () => ({
  loadBusinessFromSlug: mockTenantMiddleware,
  validateBusinessAccess: mockTenantMiddleware,
}));

let app;

beforeEach(async () => {
  app = (await import('../app.js')).default;
  
  // 1. Limpiar historial de la cadena Supabase
  mockSupabaseFrom.mockClear();
  mockChain.select.mockClear();
  mockChain.eq.mockClear();
  mockChain.gte.mockClear();
  mockChain.lte.mockClear();
  mockChain.is.mockClear();
  mockChain.order.mockClear();
  mockChain.limit.mockClear();
  mockChain.neq.mockClear();
  mockChain.update.mockClear();
  mockChain.insert.mockClear();
  mockChain.delete.mockClear();

  // 2. Limpiar historial de terminadores
  mockSingle.mockClear();
  mockDefaultQuery.mockClear(); 
  // 3. Limpiar historial de Middlewares
  mockAuthMiddleware.mockClear();
  mockTenantMiddleware.mockClear();
  mockRoleMiddleware.mockClear();
  mockSuperAdminMiddleware.mockClear();

  // 4. RE-IMPLEMENTAR mocks que necesitan estado fresco
  // (Esto es buena práctica para aislamiento)
  mockAuthMiddleware.mockImplementation((req, res, next) => {
    req.user = { id: 'user-uuid-123', restaurant_id: 'rest-uuid-456' };
    next();
  });
  mockTenantMiddleware.mockImplementation((req, res, next) => {
    req.business = { id: 'rest-uuid-456', timezone: 'Europe/Madrid' };
    next();
  });
  mockRoleMiddleware.mockImplementation((...roles) => (req, res, next) => next());
  mockSuperAdminMiddleware.mockImplementation((req, res, next) => next());
  
  // 5. RE-IMPLEMENTAR respuesta por defecto de 'await'
  mockDefaultQuery.mockResolvedValue({ data: [], error: null });
});

describe('POST /api/appointments (createAppointment)', () => {
  test('debería crear una cita exitosamente (Camino Feliz)', async () => {
    const newAppointmentData = {
      clientName: 'Cliente de Prueba',
      clientPhone: '600111222',
      scheduledDate: '2025-12-10',
      appointmentTime: '15:00',
      serviceName: 'Corte y Tinte',
      durationMinutes: 90
    };
    mockSingle.mockResolvedValueOnce({ data: { timezone: 'Europe/Madrid' }, error: null });
    mockSingle.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } });
    mockSingle.mockResolvedValueOnce({ data: { id: 'cust-uuid-new' }, error: null });
    const createdApt = { id: 'apt-uuid-new', ...newAppointmentData };
    mockSingle.mockResolvedValueOnce({ data: createdApt, error: null });
    const res = await request(app)
      .post('/api/appointments')
      .send(newAppointmentData);
    expect(res.statusCode).toBe(201);
    expect(res.body.appointment.id).toBe('apt-uuid-new');
    const expectedUTC = '2025-12-10T14:00:00.000Z';
    const appointmentInsertCall = mockChain.insert.mock.calls[1][0];
    expect(appointmentInsertCall.appointment_time).toBe(expectedUTC);
  });

  test('debería devolver 400 si faltan campos requeridos', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .send({ clientName: 'Test' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Nombre, teléfono, fecha y hora son requeridos');
  });
});

describe('POST /api/appointments/check-availability', () => {

  const availabilityRequest = {
    date: '2025-11-20',
    time: '14:00',
    duration_minutes: 60
  };

  test('debería devolver "available: true" si el horario está libre', async () => {
    mockSingle.mockResolvedValueOnce({ data: { timezone: 'Europe/Madrid' }, error: null });
    mockSingle.mockResolvedValueOnce({ 
      data: { open_time: '09:00:00', close_time: '18:00:00', is_closed: false }, 
      error: null 
    });
    // Respuesta para la consulta de conflictos (ninguno)
    mockDefaultQuery.mockResolvedValueOnce({ data: [], error: null });

    const res = await request(app)
      .post('/api/appointments/check-availability')
      .send(availabilityRequest);

    expect(res.statusCode).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.has_conflict).toBe(false);
  });

  test('debería devolver "available: false" si el negocio está cerrado', async () => {
    mockSingle.mockResolvedValueOnce({ data: { timezone: 'Europe/Madrid' }, error: null });
    mockSingle.mockResolvedValueOnce({
      data: { is_closed: true, day_of_week: 4 }, 
      error: null 
    });

    const res = await request(app)
      .post('/api/appointments/check-availability')
      .send(availabilityRequest);
    
    expect(res.statusCode).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.is_within_business_hours).toBe(false);
    expect(res.body.business_hours_message).toContain('cerrado los jueves');
  });

  test('debería devolver "available: false" si la cita empieza antes del horario', async () => {
    mockSingle.mockResolvedValueOnce({ data: { timezone: 'Europe/Madrid' }, error: null });
    mockSingle.mockResolvedValueOnce({ 
      data: { open_time: '09:00:00', close_time: '18:00:00', is_closed: false }, 
      error: null 
    });

    const res = await request(app)
      .post('/api/appointments/check-availability')
      .send({ ...availabilityRequest, time: '08:00' });
    
    expect(res.statusCode).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.business_hours_message).toBe('El horario de atención empieza a las 09:00:00');
  });

  test('debería devolver "available: false" si la cita termina después del horario', async () => {
    mockSingle.mockResolvedValueOnce({ data: { timezone: 'Europe/Madrid' }, error: null });
    mockSingle.mockResolvedValueOnce({ 
      data: { open_time: '09:00:00', close_time: '18:00:00', is_closed: false }, 
      error: null 
    });

    const res = await request(app)
      .post('/api/appointments/check-availability')
      .send({ ...availabilityRequest, time: '17:30', duration_minutes: 60 });
    
    expect(res.statusCode).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.business_hours_message).toContain('terminaría a las 18:30, después del horario de cierre');
  });

  test('debería devolver "available: false" si hay un conflicto de horario', async () => {
    mockSingle.mockResolvedValueOnce({ data: { timezone: 'Europe/Madrid' }, error: null });
    mockSingle.mockResolvedValueOnce({ 
      data: { open_time: '09:00:00', close_time: '18:00:00', is_closed: false }, 
      error: null 
    });

    const existingApt = {
      id: 'apt-conflict-uuid',
      client_name: 'Cliente Existente',
      service_name: 'Corte',
      appointment_time: '2025-11-20T13:00:00Z',
      duration_minutes: 60,
      status: 'confirmado'
    };
    mockDefaultQuery.mockResolvedValueOnce({ data: [existingApt], error: null });

    const res = await request(app)
      .post('/api/appointments/check-availability')
      .send({ ...availabilityRequest, time: '14:00', duration_minutes: 60 });
    
    expect(res.statusCode).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.has_conflict).toBe(true);
    expect(res.body.conflicting_appointment.id).toBe('apt-conflict-uuid');
    expect(res.body.conflicting_appointment.time).toBe('14:00');
  });
});