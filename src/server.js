import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import superAdminRoutes from './routes/superAdminRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

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

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend multi-tenant corriendo en http://localhost:${PORT}`);
});