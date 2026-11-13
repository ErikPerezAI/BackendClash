import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cocRoutes from './routes/coc.routes.js';
import gameDataRoutes from './routes/gameData.routes.js';
import authRoutes from './routes/auth.routes.js';
import profileRoutes from './routes/profile.routes.js';
import favoriteRoutes from './routes/favorite.routes.js';
import postRoutes from './routes/post.routes.js';
import chatRoutes from './routes/chat.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import { serveAuthLandingPage, serveResetPasswordPage } from './controllers/auth.controller.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { startBackgroundWorker } from './services/backgroundWorker.service.js';
import { getOutboundIp, getSupercellMode } from './services/supercell.service.js';

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Confiar en proxy inverso (Render / Railway / Koyeb) para detectar HTTPS en req.protocol
app.set('trust proxy', 1);

// Middlewares globales
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Página web de redirección OAuth, bienvenida y restablecimiento de contraseña
app.get('/', serveAuthLandingPage);
app.get('/reset-password', serveResetPasswordPage);

// Endpoint de Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'Backend ClashTactics',
    environment: process.env.NODE_ENV || 'development',
    supercellMode: getSupercellMode(),
    timestamp: new Date().toISOString()
  });
});

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/coc', cocRoutes);
app.use('/api/coc', gameDataRoutes);

// Middleware centralizado de manejo de errores (siempre al final)
app.use(errorHandler);

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor ClashTactics iniciado en puerto ${PORT}`);
  console.log(`🔗 Health check disponible en /api/health`);
  console.log(`🛡️  Supabase conectado a: ${process.env.SUPABASE_URL || 'No configurado'}`);
  console.log(`⚔️  Supercell API modo inicial: ${getSupercellMode()} (${process.env.COC_API_BASE_URL || 'https://api.clashofclans.com/v1'})`);
  startBackgroundWorker();

  // Resolver IP de salida en segundo plano para diagnóstico (sin bloquear el arranque)
  getOutboundIp().then((ip) => {
    if (ip && process.env.NODE_ENV !== 'production') {
      console.log(`🌐 IP pública saliente detectada: ${ip}`);
    }
  }).catch(() => {});
});
