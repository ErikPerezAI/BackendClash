import { processChatMessage } from '../services/chat.service.js';

/**
 * Controlador principal para el chatbot táctico de ClashTactics.
 * POST /api/chat/message
 */
export const sendMessage = async (req, res, next) => {
  try {
    const rawMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    if (!rawMessage) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Debes enviar un mensaje válido en el campo "message".'
      });
    }

    if (rawMessage.length > 1500) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'El mensaje no puede superar los 1,500 caracteres.'
      });
    }

    const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
    const history = rawHistory
      .slice(-12)
      .filter(
        (item) =>
          item &&
          (item.role === 'user' || item.role === 'assistant') &&
          typeof item.content === 'string' &&
          item.content.trim().length > 0
      )
      .map((item) => ({
        role: item.role,
        content: item.content.trim().slice(0, 1500)
      }));

    const activePlayerTag =
      typeof req.body?.activePlayerTag === 'string' && req.body.activePlayerTag.trim()
        ? req.body.activePlayerTag.trim()
        : null;

    const result = await processChatMessage({
      message: rawMessage,
      history,
      activePlayerTag,
      user: req.user || null,
      supabase: req.supabase || null
    });

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
