import request from 'supertest';
import { jest } from '@jest/globals';


const mockFinalEq = jest.fn();
const mockFirstEq = jest.fn(() => ({ eq: mockFinalEq }));
const mockSelect = jest.fn(() => ({ eq: mockFirstEq }));
const mockSupabaseFrom = jest.fn(() => ({ select: mockSelect }));

const mockBcryptCompare = jest.fn();
const mockJwtSign = jest.fn();
const mockGetBusinessConfig = jest.fn();

// --- Configuración de Mocks para Módulos ES ---
jest.unstable_mockModule('../config/database.js', () => ({
  supabase: {
    from: mockSupabaseFrom,
  },
}));

jest.unstable_mockModule('bcryptjs', () => ({
  default: {
    compare: mockBcryptCompare, 
  }
}));

jest.unstable_mockModule('jsonwebtoken', () => ({
  default: {
    sign: mockJwtSign, 
  }
}));

jest.unstable_mockModule('../config/businessTypes.js', () => ({
  getBusinessTypeConfig: mockGetBusinessConfig,
}));


// --- Variables de Test ---
let app;

beforeEach(async () => {
  // Importamos la app
  app = (await import('../app.js')).default;
  
  // Limpiamos el *estado* de todos los mocks
  jest.clearAllMocks();
});


describe('Auth Controller - POST /api/auth/login', () => {

  // Test 1: Validación 
  test('debería devolver 400 si falta el email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: '123' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Email y contraseña son requeridos');
  });

  // Test 2: Usuario no encontrado 
  test('debería devolver 401 si el usuario no existe o no está activo', async () => {
    // 1. Simulación (Mock):
    mockFinalEq.mockResolvedValue({ data: [], error: null });

    // 2. Ejecución:
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'no-existe@test.com', password: '123' });

    // 3. Afirmaciones:
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Credenciales inválidas');
    expect(mockSupabaseFrom).toHaveBeenCalledWith('restaurant_users');
  });

  // Test 3: Contraseña incorrecta
  test('debería devolver 401 si la contraseña es incorrecta', async () => {
    // 1. Simulación (Mock):
    const fakeUser = {
      id: 'user-uuid',
      email: 'admin@test.com',
      password_hash: 'hash_falso',
      is_active: true
    };
    mockFinalEq.mockResolvedValue({ data: [fakeUser], error: null });
    // Usamos el mock superior
    mockBcryptCompare.mockResolvedValue(false);
    
    // 2. Ejecución:
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'password-incorrecta' });

    // 3. Afirmaciones:
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Credenciales inválidas');
    // Revisamos el mock superior
    expect(mockBcryptCompare).toHaveBeenCalledWith('password-incorrecta', 'hash_falso');
  });


  // Test 4: Login exitoso (El que fallaba)
  test('debería devolver 200, token y objeto de usuario en login exitoso', async () => {
    
    // 1. Simulación (Mock):
    const fakeUser = {
      id: 'user-uuid-123',
      email: 'admin@bellaestetica.com',
      password_hash: 'hash_super_secreto',
      name: 'Admin Bella Estética',
      role: 'ADMIN',
      restaurant_id: 'rest-uuid-456',
      is_platform_admin: false,
      restaurants: {
        id: 'rest-uuid-456',
        name: 'Bella Estética',
        slug: 'bella-estetica',
        business_type: 'beauty_salon',
        logo_url: 'logo.png',
        is_active: true
      }
    };
    mockFinalEq.mockResolvedValue({ data: [fakeUser], error: null });
    // Usamos los mocks superiores
    mockBcryptCompare.mockResolvedValue(true);
    const fakeToken = 'este.es.un.token.falso.jwt';
    mockJwtSign.mockReturnValue(fakeToken);
    const fakeBusinessConfig = { 
      themeColor: '#ec4899', 
      terminology: { appointments: 'Citas' } 
    };
    mockGetBusinessConfig.mockReturnValue(fakeBusinessConfig);

    // 2. Ejecución:
    const res = await request(app)
      .post('/api/auth/login')
      .send({ 
        email: 'admin@bellaestetica.com', 
        password: 'demo123456' 
      });

    // 3. Afirmaciones:
    expect(res.statusCode).toBe(200);
    
    // Verificamos que los mocks superiores fueron llamados
    expect(mockSupabaseFrom).toHaveBeenCalledWith('restaurant_users');
    expect(mockBcryptCompare).toHaveBeenCalledWith('demo123456', 'hash_super_secreto');
    expect(mockJwtSign).toHaveBeenCalled();
    expect(mockGetBusinessConfig).toHaveBeenCalledWith('beauty_salon');

    // Verificamos la respuesta
    expect(res.body.token).toBe(fakeToken);
    expect(res.body.user.name).toBe('Admin Bella Estética');
    expect(res.body.user.business.name).toBe('Bella Estética');
    expect(res.body.user.business.themeColor).toBe('#ec4899');
  });

});