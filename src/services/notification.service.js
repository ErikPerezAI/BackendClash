import axios from 'axios';
import { supabaseAdmin } from '../config/supabase.js';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const MAX_STORED_NOTIFICATIONS = 30;
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Almacenamiento en memoria respaldado por user_metadata de Supabase Auth
const notificationsStore = new Map();
const pushTokensStore = new Map();
const hydratedUsers = new Set();

const normalizePushToken = (token) => {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
};

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
    const savedToken = normalizePushToken(meta.expo_push_token);
    if (savedToken && !pushTokensStore.has(userId)) {
      pushTokensStore.set(userId, {
        token: savedToken,
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
        expo_push_token: tokenEntry ? tokenEntry.token : null,
        push_platform: tokenEntry ? tokenEntry.platform : null,
        push_updated_at: tokenEntry ? tokenEntry.updated_at : null,
        recent_notifications: list
      }
    });
  } catch (err) {
    console.warn('[NotificationService] No se pudo persistir metadata de notificaciones:', err.message);
  }
};

/**
 * Desvincula un mismo Expo Push Token de cualquier otra cuenta para evitar fugas entre usuarios en un mismo dispositivo
 */
const clearTokenFromOtherUsers = async (ownerUserId, normalizedToken) => {
  if (!normalizedToken) return;

  for (const [otherUserId, existingEntry] of pushTokensStore.entries()) {
    if (otherUserId !== ownerUserId && normalizePushToken(existingEntry?.token) === normalizedToken) {
      pushTokensStore.delete(otherUserId);
    }
  }

  if (!supabaseAdmin) return;

  try {
    const perPage = 1000;
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error || !Array.isArray(data?.users) || data.users.length === 0) {
        break;
      }

      const conflictingUsers = data.users.filter(
        (u) =>
          u.id !== ownerUserId &&
          normalizePushToken(u.user_metadata?.expo_push_token) === normalizedToken
      );

      for (const conflictUser of conflictingUsers) {
        pushTokensStore.delete(conflictUser.id);
        hydratedUsers.add(conflictUser.id);
        await supabaseAdmin.auth.admin.updateUserById(conflictUser.id, {
          user_metadata: {
            ...(conflictUser.user_metadata || {}),
            expo_push_token: null,
            push_platform: null,
            push_updated_at: null
          }
        });
      }

      if (data.users.length < perPage) {
        break;
      }
    }
  } catch (err) {
    console.warn('[NotificationService] No se pudo limpiar token duplicado en otros usuarios:', err.message);
  }
};

/**
 * Registra un Expo Push Token para el usuario autenticado (exclusivo por dispositivo/cuenta)
 */
export const registerUserPushToken = async (userId, expoPushToken, platform = 'mobile') => {
  const normalizedToken = normalizePushToken(expoPushToken);
  if (!userId || !normalizedToken) return null;

  await hydrateUserFromSupabase(userId);
  await clearTokenFromOtherUsers(userId, normalizedToken);

  const entry = {
    token: normalizedToken,
    platform,
    updated_at: new Date().toISOString()
  };

  pushTokensStore.set(userId, entry);
  await persistUserToSupabase(userId);
  return entry;
};

/**
 * Desvincula el Expo Push Token de una cuenta (p. ej. al cerrar sesión)
 */
export const unregisterUserPushToken = async (userId, optionalToken = null) => {
  if (!userId) return { cleared: false };
  await hydrateUserFromSupabase(userId);

  const normalizedOptional = normalizePushToken(optionalToken);
  const currentEntry = pushTokensStore.get(userId);
  const shouldClear =
    !normalizedOptional ||
    !currentEntry?.token ||
    normalizePushToken(currentEntry.token) === normalizedOptional;

  if (!shouldClear) {
    return { cleared: false, reason: 'token_mismatch' };
  }

  pushTokensStore.delete(userId);
  await persistUserToSupabase(userId);
  return { cleared: true };
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

  const enrichedData = {
    ...(data || {}),
    target_user_id: String(userId)
  };

  const currentList = notificationsStore.get(userId) || [];
  const newNotification = {
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    user_id: userId,
    title: String(title).trim(),
    body: String(body).trim(),
    type,
    data: enrichedData,
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
        ...enrichedData
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
  unregisterUserPushToken,
  getUserPushToken,
  sendExpoPushMessage,
  createAndSendNotification,
  getUserNotifications,
  markNotificationsAsRead
};
