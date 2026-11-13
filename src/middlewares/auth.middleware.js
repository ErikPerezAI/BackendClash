import { supabaseClient, getScopedSupabaseClient } from '../config/supabase.js';

/**
 * Middleware que exige que la petición contenga un token JWT válido de Supabase Auth.
 * Asigna:
 * - req.user: Objeto del usuario autenticado de auth.users
 * - req.token: Token JWT
 * - req.supabase: Cliente de Supabase configurado con el Bearer token (habilita RLS)
 */
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'No autorizado: Se requiere el encabezado Authorization con formato Bearer <token>'
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        error: 'No autorizado: Token no proporcionado'
      });
    }

    const { data: { user }, error } = await supabaseClient.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        error: 'No autorizado: Token inválido o sesión expirada',
        detail: error?.message
      });
    }

    req.user = user;
    req.token = token;
    req.supabase = getScopedSupabaseClient(token);
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware opcional para endpoints públicos que pueden beneficiarse de saber si el usuario está logueado.
 * Si el token es provisto y válido, asigna req.user y req.supabase autenticado.
 * Si no, asigna req.user = null y req.supabase = cliente anónimo.
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token) {
        const { data: { user } } = await supabaseClient.auth.getUser(token);
        if (user) {
          req.user = user;
          req.token = token;
          req.supabase = getScopedSupabaseClient(token);
          return next();
        }
      }
    }

    req.user = null;
    req.token = null;
    req.supabase = supabaseClient;
    next();
  } catch (err) {
    req.user = null;
    req.token = null;
    req.supabase = supabaseClient;
    next();
  }
};

/**
 * Obtiene el rol del usuario autenticado desde la tabla profiles ('user' | 'admin')
 */
export const getUserRole = async (req) => {
  if (!req.user) return 'user';
  if (req.userRole) return req.userRole;

  const client = req.supabase || supabaseClient;
  const { data: profile } = await client
    .from('profiles')
    .select('role')
    .eq('id', req.user.id)
    .maybeSingle();

  req.userRole = profile?.role === 'admin' ? 'admin' : 'user';
  return req.userRole;
};

/**
 * Middleware para asegurar que el usuario tenga el rol de 'admin'
 */
export const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Autenticación requerida' });
    }

    const role = await getUserRole(req);

    if (role !== 'admin') {
      return res.status(403).json({
        error: 'Acceso denegado: Se requiere rol de administrador'
      });
    }

    next();
  } catch (err) {
    next(err);
  }
};
