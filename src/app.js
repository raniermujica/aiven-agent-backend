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

dotenv.config();

const app = express();

// Middleware 
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 

// Health check 
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend multi-tenant funcionando' });
});

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

// Error handler 
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

export default app;