import app from './app.js'; 
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`💇 Rutas services: /api/services`);
  console.log(`🚀 Backend multi-tenant corriendo en http://localhost:${PORT}`);
});