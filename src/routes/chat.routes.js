import { Router } from 'express';
import { optionalAuth } from '../middlewares/auth.middleware.js';
import { sendMessage } from '../controllers/chat.controller.js';

const router = Router();

// Endpoint del Asistente Táctico IA (permite usuarios invitados o autenticados)
router.post('/message', optionalAuth, sendMessage);

export default router;
