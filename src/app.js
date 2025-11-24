import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/authRoutes.js';
import superAdminRoutes from './routes/superAdminRoutes.js';
import reservationsRoutes from './routes/reservationsRoutes.js';
import appointmentsRoutes from './routes/appointmentsRoutes.js';
import servicesRoutes from './routes/servicesRoutes.js';
import customersRoutes from './routes/customersRoutes.js';
import waitlistRoutes from './routes/waitlistRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import webhooksRoutes from './routes/webhooksRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import whatsappRoutes from './routes/whatsappRoutes.js';
import emailRoutes from './routes/emailRoutes.js';
import contactRoutes from './routes/contactRoutes.js';
import publicRoutes from './routes/publicRoutes.js';
import blockedSlotsRoutes from './routes/blockedSlotsRoutes.js';
import tablesRoutes from './routes/tablesRoutes.js';
import schedulesRoutes from './routes/schedulesRoutes.js';


dotenv.config();

const app = express();

const N8N_URL = process.env.N8N_URL;
const VERCEL_FRONTEND_URL = process.env.VERCEL_FRONTEND_URL;

// Lista de orígenes en los que confiamos
const whitelist = [
  'https://www.agentpaul.es',
  'https://book.agentpaul.es',
  N8N_URL,
  VERCEL_FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:5174'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      console.warn(`❌ CORS: Origen no permitido: ${origin}`);
      callback(new Error('No permitido por CORS'));
    }
  }
};

app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check 
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend multi-tenant funcionando' });
});

// Middleware 
// app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check 
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend multi-tenant funcionando' });
});

// Rutas públicas
app.use('/api/public', publicRoutes);

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/superadmin', superAdminRoutes);
app.use('/api/reservations', reservationsRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/blocked-slots', blockedSlotsRoutes);
app.use('/api/tables', tablesRoutes);
app.use('/api/schedules', schedulesRoutes);

// Error handler 
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

export default app;