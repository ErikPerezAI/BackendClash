import {
  createAndSendNotification,
  getUserNotifications,
  markNotificationsAsRead,
  registerUserPushToken
} from '../services/notification.service.js';
import {
  getBackgroundWorkerStatus,
  runBackgroundSyncNow
} from '../services/backgroundWorker.service.js';

/**
 * Obtener bandeja de notificaciones del usuario autenticado y estado del worker
 * GET /api/notifications
 */
export const listMyNotifications = async (req, res, next) => {
  try {
    const inbox = await getUserNotifications(req.user.id);
    const worker = getBackgroundWorkerStatus();

    res.status(200).json({
      count: inbox.notifications.length,
      unread_count: inbox.unreadCount,
      push_token: inbox.pushToken,
      notifications: inbox.notifications,
      background_worker: worker
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Registrar el Expo Push Token del dispositivo móvil/web
 * POST /api/notifications/register-token
 */
export const registerPushToken = async (req, res, next) => {
  try {
    const { token, platform = 'mobile' } = req.body || {};

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({
        error: 'Se requiere un token push válido en el campo "token"'
      });
    }

    const saved = await registerUserPushToken(req.user.id, token.trim(), platform);

    res.status(200).json({
      message: 'Token de notificaciones push registrado exitosamente',
      push_token: saved
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Marcar una notificación o todas como leídas
 * PUT /api/notifications/read
 */
export const markRead = async (req, res, next) => {
  try {
    const { notificationId = null } = req.body || {};
    const updated = await markNotificationsAsRead(req.user.id, notificationId);

    res.status(200).json({
      message: 'Notificaciones actualizadas',
      unread_count: updated.unreadCount,
      notifications: updated.notifications
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Enviar una notificación push/in-app de prueba al usuario autenticado
 * POST /api/notifications/test
 */
export const sendTestNotification = async (req, res, next) => {
  try {
    const customTitle = req.body?.title || '⚔️ Alerta Táctica de ClashTactics';
    const customBody =
      req.body?.body ||
      '¡Las notificaciones push y alertas de aldea están activas en tu cuenta!';

    const result = await createAndSendNotification({
      userId: req.user.id,
      title: customTitle,
      body: customBody,
      type: 'test_alert',
      data: {
        source: 'manual_test'
      }
    });

    const inbox = await getUserNotifications(req.user.id);

    res.status(201).json({
      message: 'Notificación enviada exitosamente',
      notification: result?.notification || null,
      push: result?.push || { sent: false },
      unread_count: inbox.unreadCount,
      notifications: inbox.notifications
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Consultar estado del proceso periódico en segundo plano
 * GET /api/notifications/background-status
 */
export const getWorkerStatus = async (req, res, next) => {
  try {
    res.status(200).json(getBackgroundWorkerStatus());
  } catch (error) {
    next(error);
  }
};

/**
 * Ejecutar sincronización inmediata en segundo plano para las aldeas del usuario
 * POST /api/notifications/run-background-sync
 */
export const triggerBackgroundSync = async (req, res, next) => {
  try {
    const status = await runBackgroundSyncNow({
      triggeredByUserId: req.user.id,
      forceUserSummary: true
    });
    const inbox = await getUserNotifications(req.user.id);

    res.status(200).json({
      message: 'Sincronización en segundo plano ejecutada exitosamente',
      worker: status,
      unread_count: inbox.unreadCount,
      notifications: inbox.notifications
    });
  } catch (error) {
    next(error);
  }
};

export default {
  listMyNotifications,
  registerPushToken,
  markRead,
  sendTestNotification,
  getWorkerStatus,
  triggerBackgroundSync
};
