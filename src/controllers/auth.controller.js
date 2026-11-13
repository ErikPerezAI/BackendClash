import axios from 'axios';
import { supabaseClient, supabaseAdmin } from '../config/supabase.js';
import { getResetPasswordHtml } from '../utils/resetPasswordHtml.js';
import { unregisterUserPushToken } from '../services/notification.service.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Registro de un nuevo usuario en Supabase Auth y creación automática de su perfil.
 */
export const register = async (req, res, next) => {
  try {
    const { email, password, username, avatar_url } = req.body;

    if (!email || !password || !username) {
      return res.status(400).json({
        error: 'Los campos email, password y username son obligatorios'
      });
    }

    if (!EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        error: 'El formato del correo electrónico no es válido'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 6 caracteres'
      });
    }

    // Verificar si el username ya está registrado en profiles
    const { data: existingUser } = await supabaseClient
      .from('profiles')
      .select('id')
      .eq('username', username.trim())
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({
        error: `El nombre de usuario "${username}" ya está en uso. Por favor elige otro.`
      });
    }

    // Si contamos con cliente admin (service_role secret key), creamos con email auto-confirmado
    if (supabaseAdmin) {
      const { data: adminData, error: adminErr } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim().toLowerCase(),
        password,
        email_confirm: true,
        user_metadata: {
          username: username.trim(),
          avatar_url: avatar_url || null
        }
      });

      if (adminErr) throw adminErr;

      // Asegurar que avatar_url quede guardado en public.profiles
      if (avatar_url) {
        await supabaseAdmin
          .from('profiles')
          .update({ avatar_url, updated_at: new Date().toISOString() })
          .eq('id', adminData.user.id);
      }

      // Iniciar sesión automáticamente para entregar el token JWT de inmediato
      const { data: signData } = await supabaseClient.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password
      });

      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', adminData.user.id)
        .maybeSingle();

      return res.status(201).json({
        message: 'Usuario registrado e iniciado exitosamente',
        user: adminData.user,
        profile,
        access_token: signData?.session?.access_token || null,
        session: signData?.session || null
      });
    }

    // Flujo estándar usando el cliente público/anon
    const { data, error } = await supabaseClient.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          username: username.trim(),
          avatar_url: avatar_url || null
        }
      }
    });

    if (error) {
      if (error.code === 'over_email_send_rate_limit') {
        return res.status(429).json({
          error: 'Límite de correos alcanzado en Supabase (máximo 3-4 correos por hora en el plan gratuito).',
          solution: 'Para solucionar esto de inmediato: Ve a Supabase Dashboard > Authentication > Providers > Email y DESACTIVA "Confirm email" (clic en Save). Esto permitirá registrar y loguear usuarios al instante sin enviar correos ni topar límites.',
          code: error.code
        });
      }
      throw error;
    }

    if (data?.user) {
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .maybeSingle();

      const hasSession = !!data.session;

      return res.status(201).json({
        message: hasSession
          ? 'Usuario registrado exitosamente'
          : 'Usuario registrado. Si no recibes token, desactiva "Confirm email" en Supabase (Authentication > Providers > Email) o confirma el correo enviado.',
        user: data.user,
        profile,
        access_token: data.session?.access_token || null,
        session: data.session || null
      });
    }

    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
};

/**
 * Inicio de sesión con Email y Password. Retorna el access_token JWT y el perfil del usuario.
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email y password son requeridos'
      });
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });

    if (error) {
      if (error.message?.toLowerCase().includes('email not confirmed')) {
        return res.status(400).json({
          error: 'Correo no confirmado. Para desarrollo local, desactiva la opción "Confirm email" en tu panel de Supabase: Authentication > Providers > Email.',
          code: 'email_not_confirmed'
        });
      }
      return res.status(401).json({
        error: 'Credenciales inválidas',
        detail: error.message
      });
    }

    // Obtener datos del perfil del usuario
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle();

    res.status(200).json({
      message: 'Inicio de sesión exitoso',
      user: data.user,
      profile,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      token_type: data.session.token_type
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Solicitar recuperación de contraseña ("Olvidé mi contraseña") enviando correo mediante Supabase Auth
 */
export const forgotPassword = async (req, res, next) => {
  try {
    const { email, redirectTo } = req.body;
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!cleanEmail) {
      return res.status(400).json({
        error: 'Ingresa tu correo electrónico para recuperar la contraseña.'
      });
    }

    if (!EMAIL_REGEX.test(cleanEmail)) {
      return res.status(400).json({
        error: 'El formato del correo electrónico no es válido.'
      });
    }

    // Resolver URL de redirección permitida en Supabase Auth
    const host = req.get('host') || 'localhost:3000';
    const protocol = req.protocol || 'http';
    const targetRedirect = redirectTo || `${protocol}://${host}/reset-password`;

    // Generar OTP y enlace administrativo de respaldo si supabaseAdmin está disponible
    let adminOtp = null;
    let adminLink = null;
    if (supabaseAdmin) {
      try {
        const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email: cleanEmail,
          options: { redirectTo: targetRedirect }
        });
        if (!linkErr && linkData?.properties) {
          adminOtp = linkData.properties.email_otp;
          adminLink = linkData.properties.action_link;
        }
      } catch (adminErr) {
        console.warn('Advertencia al generar link admin:', adminErr.message);
      }
    }

    // Enviar correo mediante Supabase Auth
    const { error } = await supabaseClient.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: targetRedirect
    });

    if (error) {
      if (error.code === 'over_email_send_rate_limit' || error.status === 429) {
        if (adminOtp) {
          return res.status(200).json({
            message: 'Código de recuperación generado exitosamente. Debido a un límite temporal de correos de Supabase, puedes usar este código directamente en la app para restablecer tu contraseña.',
            code: adminOtp,
            rate_limited: true
          });
        }
        return res.status(429).json({
          error: 'Se alcanzó el límite temporal de envío de correos de Supabase.',
          solution: 'Por seguridad, Supabase limita los correos de recuperación por hora. Intenta nuevamente en unos minutos o ingresa tu código recibido.',
          code: error.code || 'rate_limit'
        });
      }
      return res.status(400).json({
        error: 'No se pudo procesar la solicitud de recuperación.',
        detail: error.message
      });
    }

    res.status(200).json({
      message: 'Te enviamos un enlace de recuperación a tu correo electrónico. Revisa tu bandeja de entrada y la carpeta de spam.',
      code: adminOtp || undefined,
      action_link: adminLink || undefined
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Restablecer contraseña utilizando un token JWT o código OTP recibido por correo
 */
export const resetPassword = async (req, res, next) => {
  try {
    const {
      email,
      token,
      access_token,
      new_password,
      newPassword,
      confirm_password,
      confirmPassword
    } = req.body;

    const cleanNewPassword = new_password ?? newPassword;
    const cleanConfirmPassword = confirm_password ?? confirmPassword;

    if (!cleanNewPassword || typeof cleanNewPassword !== 'string') {
      return res.status(400).json({
        error: 'Debes ingresar la nueva contraseña.'
      });
    }

    if (cleanNewPassword.length < 6) {
      return res.status(400).json({
        error: 'La nueva contraseña debe tener al menos 6 caracteres.'
      });
    }

    if (cleanConfirmPassword !== undefined && cleanNewPassword !== cleanConfirmPassword) {
      return res.status(400).json({
        error: 'La nueva contraseña y su confirmación no coinciden.'
      });
    }

    // 1) Caso con access_token (redirección web o deep link de recuperación de Supabase)
    const activeToken = access_token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (activeToken) {
      const { data: userData, error: userErr } = await supabaseClient.auth.getUser(activeToken);
      if (userErr || !userData?.user) {
        return res.status(401).json({
          error: 'El token o enlace de recuperación es inválido o ha expirado.',
          detail: userErr?.message
        });
      }

      if (supabaseAdmin) {
        const { error: adminUpdateErr } = await supabaseAdmin.auth.admin.updateUserById(
          userData.user.id,
          { password: cleanNewPassword }
        );
        if (adminUpdateErr) throw adminUpdateErr;
      } else {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_ANON_KEY;
        await axios.put(
          `${supabaseUrl}/auth/v1/user`,
          { password: cleanNewPassword },
          {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${activeToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
      }

      return res.status(200).json({
        message: '¡Contraseña restablecida exitosamente! Ya puedes iniciar sesión con tu nueva contraseña.'
      });
    }

    // 2) Caso con email y código OTP recibido por correo
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanToken = typeof token === 'string' ? token.trim() : '';

    if (!cleanEmail || !cleanToken) {
      return res.status(400).json({
        error: 'Debes ingresar tu correo electrónico y el código de recuperación que recibiste.'
      });
    }

    // Verificar OTP con Supabase Auth
    const { data: otpData, error: otpErr } = await supabaseClient.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: 'recovery'
    });

    if (otpErr || !otpData?.user) {
      return res.status(400).json({
        error: 'El código de recuperación es incorrecto o ha expirado. Por favor verifica o solicita uno nuevo.',
        detail: otpErr?.message
      });
    }

    // Con el usuario verificado por OTP, actualizar su contraseña
    if (supabaseAdmin) {
      const { error: adminErr } = await supabaseAdmin.auth.admin.updateUserById(
        otpData.user.id,
        { password: cleanNewPassword }
      );
      if (adminErr) throw adminErr;
    } else if (otpData.session?.access_token) {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_ANON_KEY;
      await axios.put(
        `${supabaseUrl}/auth/v1/user`,
        { password: cleanNewPassword },
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${otpData.session.access_token}`,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    return res.status(200).json({
      message: '¡Contraseña restablecida exitosamente! Ya puedes iniciar sesión con tu nueva contraseña.'
    });
  } catch (error) {
    next(error);
  }
};

const OAUTH_REDIRECT_COOKIE = 'ct_oauth_redirect_to';
const OAUTH_REDIRECT_TTL_MS = 10 * 60 * 1000;
const recentOAuthRedirectsByIp = new Map();

const getPublicOrigin = (req) => {
  const protocol = req.headers['x-forwarded-proto']?.split(',')[0]?.trim() || req.protocol || 'https';
  const host =
    req.headers['x-forwarded-host']?.split(',')[0]?.trim() ||
    req.get?.('host') ||
    req.headers?.host;
  return `${protocol}://${host}`;
};

const sanitizeAppRedirectUri = (rawUri) => {
  const fallback = 'clashtactics://google-auth';
  if (typeof rawUri !== 'string') return fallback;
  const trimmed = rawUri.trim();
  if (!trimmed) return fallback;

  if (/^(clashtactics|exp|exps):\/\//i.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return fallback;
  }

  return fallback;
};

const parseCookieValue = (req, name) => {
  const cookieHeader = req.headers?.cookie;
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;

  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(eqIndex + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
};

const getClientIpKey = (req) => {
  const fwd = req.headers['x-forwarded-for']?.split(',')[0]?.trim();
  return fwd || req.ip || req.socket?.remoteAddress || 'unknown';
};

const rememberOAuthRedirect = (req, res, redirectTo) => {
  const isHttps = (req.headers['x-forwarded-proto']?.split(',')[0]?.trim() || req.protocol) === 'https';
  const cookieFlags = [
    `${OAUTH_REDIRECT_COOKIE}=${encodeURIComponent(redirectTo)}`,
    'Path=/',
    'Max-Age=600',
    'SameSite=Lax',
    'HttpOnly'
  ];
  if (isHttps) {
    cookieFlags.push('Secure');
  }
  res.setHeader('Set-Cookie', cookieFlags.join('; '));

  const now = Date.now();
  for (const [k, entry] of recentOAuthRedirectsByIp.entries()) {
    if (!entry || entry.expiresAt <= now) {
      recentOAuthRedirectsByIp.delete(k);
    }
  }
  recentOAuthRedirectsByIp.set(getClientIpKey(req), {
    redirectTo,
    expiresAt: now + OAUTH_REDIRECT_TTL_MS
  });
};

const resolveStoredOAuthRedirect = (req) => {
  const fromQuery = typeof req.query?.app_redirect === 'string' ? req.query.app_redirect : null;
  if (fromQuery) {
    return sanitizeAppRedirectUri(fromQuery);
  }

  const fromCookie = parseCookieValue(req, OAUTH_REDIRECT_COOKIE);
  if (fromCookie) {
    return sanitizeAppRedirectUri(fromCookie);
  }

  const ipEntry = recentOAuthRedirectsByIp.get(getClientIpKey(req));
  if (ipEntry && ipEntry.expiresAt > Date.now()) {
    return sanitizeAppRedirectUri(ipEntry.redirectTo);
  }

  return 'clashtactics://google-auth';
};

/**
 * Sirve la página raíz inteligente (retorna tokens OAuth de Google hacia la app sin mostrar restablecimiento de contraseña)
 */
export const serveAuthLandingPage = (req, res) => {
  const oauthRedirectUrl = resolveStoredOAuthRedirect(req);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(
    getResetPasswordHtml({
      defaultMode: 'landing',
      oauthRedirectUrl
    })
  );
};

/**
 * Sirve la página web HTML interactiva para restablecer contraseña
 */
export const serveResetPasswordPage = (req, res) => {
  const oauthRedirectUrl = resolveStoredOAuthRedirect(req);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(
    getResetPasswordHtml({
      defaultMode: 'recovery',
      oauthRedirectUrl
    })
  );
};

/**
 * Inicia el flujo OAuth con Google guardando la URL exacta de retorno a la app (Expo Go o APK)
 * y redirigiendo a Supabase OAuth para poder regresar automáticamente si Supabase cae en Site URL.
 */
export const startGoogleOAuth = async (req, res, next) => {
  try {
    const redirectTo = sanitizeAppRedirectUri(req.query.redirect_to);
    const { data, error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        },
        skipBrowserRedirect: true
      }
    });

    if (error || !data?.url) {
      const sep = redirectTo.includes('?') ? '&' : '?';
      const errDesc = encodeURIComponent(
        error?.message || 'No se pudo iniciar sesión con Google en Supabase.'
      );
      return res.redirect(302, `${redirectTo}${sep}error=google_oauth_error&error_description=${errDesc}`);
    }

    rememberOAuthRedirect(req, res, redirectTo);
    return res.redirect(302, data.url);
  } catch (error) {
    next(error);
  }
};

/**
 * Obtener la URL de autorización para iniciar sesión con Google mediante el puente OAuth del backend
 */
export const getGoogleOAuthUrl = async (req, res, next) => {
  try {
    const redirectTo = sanitizeAppRedirectUri(req.query.redirect_to);
    const { data, error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        },
        skipBrowserRedirect: true
      }
    });

    if (error) {
      if (error.message?.includes('provider is not enabled') || error.code === 'validation_failed') {
        return res.status(400).json({
          error: 'El proveedor de Google no está activado en Supabase.',
          solution: 'Ve a Supabase Dashboard > Authentication > Providers > Google, actívalo e ingresa tu Client ID y Client Secret de Google Cloud.',
          code: 'google_not_enabled'
        });
      }
      return res.status(400).json({
        error: 'No se pudo generar la URL de autenticación con Google.',
        detail: error.message
      });
    }

    const origin = getPublicOrigin(req);
    const bridgeStartUrl = `${origin}/api/auth/google-start?redirect_to=${encodeURIComponent(redirectTo)}`;

    res.status(200).json({
      url: bridgeStartUrl,
      direct_url: data.url
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Iniciar sesión o sincronizar sesión tras completar el flujo OAuth con Google
 */
export const oauthCallback = async (req, res, next) => {
  try {
    const { access_token, refresh_token } = req.body;
    const cleanToken = access_token || req.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!cleanToken) {
      return res.status(400).json({
        error: 'El token de acceso es requerido para completar la autenticación.'
      });
    }

    // Obtener información del usuario desde Supabase con el access_token
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(cleanToken);

    if (userError || !userData?.user) {
      return res.status(401).json({
        error: 'Sesión no válida o expirada de Google.',
        detail: userError?.message
      });
    }

    const user = userData.user;

    // Buscar el perfil existente
    let { data: profile } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    // Si aún no tiene perfil, lo creamos
    if (!profile) {
      const email = user.email || '';
      const baseName =
        user.user_metadata?.username ||
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        email.split('@')[0] ||
        'usuario';
      const cleanUsername = baseName.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 20) || 'usuario';
      const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || 'local:AvatarNormal.png';

      const clientToUse = supabaseAdmin || supabaseClient;
      const { data: newProfile } = await clientToUse
        .from('profiles')
        .insert({
          id: user.id,
          username: cleanUsername,
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString()
        })
        .select('*')
        .maybeSingle();

      profile = newProfile;
    }

    res.status(200).json({
      message: 'Inicio de sesión con Google exitoso',
      user,
      profile,
      access_token: cleanToken,
      refresh_token: refresh_token || null
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Cambiar la contraseña del usuario autenticado
 */
export const changePassword = async (req, res, next) => {
  try {
    const currentPassword = req.body.current_password ?? req.body.currentPassword;
    const newPassword = req.body.new_password ?? req.body.newPassword;
    const confirmPassword = req.body.confirm_password ?? req.body.confirmPassword;

    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({
        error: 'Debes ingresar la nueva contraseña.'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        error: 'La nueva contraseña debe tener al menos 6 caracteres.'
      });
    }

    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      return res.status(400).json({
        error: 'La nueva contraseña y su confirmación no coinciden.'
      });
    }

    if (currentPassword && currentPassword === newPassword) {
      return res.status(400).json({
        error: 'La nueva contraseña debe ser diferente a la contraseña actual.'
      });
    }

    let activeToken = req.token;

    // Si se envía la contraseña actual, verificamos que sea válida antes de cambiarla
    if (currentPassword && req.user?.email) {
      const { data: verifyData, error: verifyError } = await supabaseClient.auth.signInWithPassword({
        email: req.user.email,
        password: currentPassword
      });

      if (verifyError || !verifyData?.session) {
        return res.status(400).json({
          error: 'La contraseña actual ingresada es incorrecta.'
        });
      }

      activeToken = verifyData.session.access_token;
    }

    // Actualizar la contraseña en Supabase Auth
    if (supabaseAdmin) {
      const { error: adminUpdateErr } = await supabaseAdmin.auth.admin.updateUserById(
        req.user.id,
        { password: newPassword }
      );
      if (adminUpdateErr) {
        return res.status(400).json({
          error: 'No se pudo actualizar la contraseña.',
          detail: adminUpdateErr.message
        });
      }
    } else {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

      try {
        await axios.put(
          `${supabaseUrl}/auth/v1/user`,
          { password: newPassword },
          {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${activeToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (err) {
        const msg =
          err.response?.data?.msg ||
          err.response?.data?.error_description ||
          err.response?.data?.message ||
          err.message;
        return res.status(err.response?.status || 400).json({
          error: 'No se pudo actualizar la contraseña.',
          detail: msg
        });
      }
    }

    // Refrescar sesión con la nueva contraseña para mantener al usuario autenticado sin cortes
    let refreshedSession = null;
    if (req.user?.email) {
      const { data: reAuthData } = await supabaseClient.auth.signInWithPassword({
        email: req.user.email,
        password: newPassword
      });
      refreshedSession = reAuthData?.session || null;
    }

    res.status(200).json({
      message: 'Contraseña actualizada exitosamente.',
      access_token: refreshedSession?.access_token || activeToken,
      refresh_token: refreshedSession?.refresh_token || null
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtener la información del usuario autenticado actual y su perfil
 */
export const getMe = async (req, res, next) => {
  try {
    const { data: profile, error } = await req.supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;

    res.status(200).json({
      user: req.user,
      profile
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Cerrar sesión
 */
export const logout = async (req, res, next) => {
  try {
    if (req.user?.id) {
      const token = req.body?.expo_push_token || req.body?.token || null;
      await unregisterUserPushToken(req.user.id, token).catch(() => {});
    }
    if (req.supabase) {
      await req.supabase.auth.signOut();
    }
    res.status(200).json({
      message: 'Sesión cerrada exitosamente'
    });
  } catch (error) {
    next(error);
  }
};
