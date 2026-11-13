import axios from 'axios';
import { supabaseAdmin } from '../config/supabase.js';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const MAX_STORED_NOTIFICATIONS = 30;
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Almacenamiento en memoria respaldado por user_metadata de Supabase Auth
const notificationsStore = new Map();
const pushTokensStore = new Map();
const hydratedUsers = new Set();

/**
 * Hidrata las notificaciones y el token push del usuario desde user_metadata de Supabase
 */
const hydrateUserFromSupabase = async (userId) => {
  if (!userId || !UUID_REGEX.test(userId) || hydratedUsers.has(userId) || !supabaseAdmin) {
    return;
  }

  hydratedUsers.add(userId);
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error || !data?.user) return;

    const meta = data.user.user_metadata || {};
    if (meta.expo_push_token && !pushTokensStore.has(userId)) {
      pushTokensStore.set(userId, {
        token: meta.expo_push_token,
        platform: meta.push_platform || 'mobile',
        updated_at: meta.push_updated_at || new Date().toISOString()
      });
    }

    if (Array.isArray(meta.recent_notifications) && !notificationsStore.has(userId)) {
      notificationsStore.set(userId, meta.recent_notifications.slice(0, MAX_STORED_NOTIFICATIONS));
    }
  } catch (err) {
    console.warn('[NotificationService] No se pudo hidratar metadata de notificaciones:', err.message);
  }
};

/**
 * Persiste el estado actual de notificaciones y push token en user_metadata
 */
const persistUserToSupabase = async (userId) => {
  if (!userId || !UUID_REGEX.test(userId) || !supabaseAdmin) return;

  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    const currentMeta = data?.user?.user_metadata || {};
    const tokenEntry = pushTokensStore.get(userId);
    const list = (notificationsStore.get(userId) || []).slice(0, MAX_STORED_NOTIFICATIONS);

    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...currentMeta,
        ...(tokenEntry
          ? {
              expo_push_token: tokenEntry.token,
              push_platform: tokenEntry.platform,
              push_updated_at: tokenEntry.updated_at
            }
          : {}),
        recent_notifications: list
      }
    });
  } catch (err) {
    console.warn('[NotificationService] No se pudo persistir metadata de notificaciones:', err.message);
  }
};

/**
 * Registra un Expo Push Token para el usuario autenticado
 */
export const registerUserPushToken = async (userId, expoPushToken, platform = 'mobile') => {
  if (!userId || !expoPushToken) return null;
  await hydrateUserFromSupabase(userId);

  const entry = {
    token: String(expoPushToken).trim(),
    platform,
    updated_at: new Date().toISOString()
  };

  pushTokensStore.set(userId, entry);
  await persistUserToSupabase(userId);
  return entry;
};

/**
 * Obtiene el token push registrado de un usuario
 */
export const getUserPushToken = async (userId) => {
  if (!userId) return null;
  await hydrateUserFromSupabase(userId);
  return pushTokensStore.get(userId) || null;
};

/**
 * Envía una notificación push real a través del servicio Expo Push API
 */
export const sendExpoPushMessage = async ({ to, title, body, data = {} }) => {
  if (!to || typeof to !== 'string') {
    return { sent: false, reason: 'no_token' };
  }

  const isExpoToken =
    to.startsWith('ExponentPushToken[') || to.startsWith('ExpoPushToken[');

  if (!isExpoToken) {
    return { sent: false, reason: 'local_or_simulated_token' };
  }

  try {
    const response = await axios.post(
      EXPO_PUSH_ENDPOINT,
      {
        to,
        sound: 'default',
        title,
        body,
        data
      },
      {
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json'
        },
        timeout: 8000
      }
    );

    return {
      sent: true,
      ticket: response.data
    };
  } catch (err) {
    console.warn('[NotificationService] Error enviando Expo Push:', err.message);
    return {
      sent: false,
      reason: err.message
    };
  }
};

/**
 * Crea una notificación en la bandeja del usuario y dispara Push si tiene token registrado
 */
export const createAndSendNotification = async ({
  userId,
  title,
  body,
  type = 'system',
  data = {}
}) => {
  if (!userId || !title || !body) return null;

  await hydrateUserFromSupabase(userId);

  const currentList = notificationsStore.get(userId) || [];
  const newNotification = {
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    user_id: userId,
    title: String(title).trim(),
    body: String(body).trim(),
    type,
    data: data || {},
    read: false,
    created_at: new Date().toISOString()
  };

  const updatedList = [newNotification, ...currentList].slice(0, MAX_STORED_NOTIFICATIONS);
  notificationsStore.set(userId, updatedList);

  const tokenInfo = pushTokensStore.get(userId);
  let pushResult = { sent: false, reason: 'no_registered_token' };

  if (tokenInfo?.token) {
    pushResult = await sendExpoPushMessage({
      to: tokenInfo.token,
      title: newNotification.title,
      body: newNotification.body,
      data: {
        notificationId: newNotification.id,
        type,
        ...data
      }
    });
  }

  // Persistir de forma asíncrona sin bloquear la respuesta
  persistUserToSupabase(userId).catch(() => {});

  return {
    notification: newNotification,
    push: pushResult
  };
};

/**
 * Lista las notificaciones de un usuario
 */
export const getUserNotifications = async (userId) => {
  if (!userId) {
    return { notifications: [], unreadCount: 0, pushToken: null };
  }

  await hydrateUserFromSupabase(userId);
  const list = notificationsStore.get(userId) || [];
  const unreadCount = list.filter((n) => !n.read).length;
  const pushToken = pushTokensStore.get(userId) || null;

  return {
    notifications: list,
    unreadCount,
    pushToken
  };
};

/**
 * Marca una o todas las notificaciones de un usuario como leídas
 */
export const markNotificationsAsRead = async (userId, notificationId = null) => {
  if (!userId) return { notifications: [], unreadCount: 0 };

  await hydrateUserFromSupabase(userId);
  const list = notificationsStore.get(userId) || [];

  const updated = list.map((item) => {
    if (!notificationId || item.id === notificationId) {
      return { ...item, read: true };
    }
    return item;
  });

  notificationsStore.set(userId, updated);
  await persistUserToSupabase(userId);

  return {
    notifications: updated,
    unreadCount: updated.filter((n) => !n.read).length
  };
};

export default {
  registerUserPushToken,
  getUserPushToken,
  sendExpoPushMessage,
  createAndSendNotification,
  getUserNotifications,
  markNotificationsAsRead
};
