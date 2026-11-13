import {
  getCachedOutboundIp,
  getSupercellMode,
  ROYALE_API_PROXY_IP
} from '../services/supercell.service.js';

/**
 * Middleware centralizado para el manejo de errores.
 * Soporta errores de Axios (Supercell API), Supabase Auth y PostgreSQL / PostgREST.
 */
export const errorHandler = (err, req, res, next) => {
  console.error('[Error]:', err.message || err);

  // Errores de Axios (respuesta de la API de Supercell)
  if (err.response) {
    const status = err.response.status;
    const data = err.response.data;

    if (status === 404) {
      return res.status(404).json({
        error: 'Jugador o Clan no encontrado en la API de Clash of Clans',
        detail: data
      });
    }

    if (status === 403) {
      const mode = getSupercellMode();
      const outboundIp = getCachedOutboundIp();
      console.error(
        `[Supercell 403] mode=${mode} outboundIp=${outboundIp || 'unknown'} reason=${data?.reason || 'forbidden'}`
      );
      const isProd = process.env.NODE_ENV === 'production';
      return res.status(403).json({
        error: 'Error de autorización con la API de Supercell. Verifica tu COC_API_KEY o tu IP autorizada.',
        ...(isProd
          ? {}
          : {
              hint: `Modo activo: ${mode}. Si usás RoyaleAPI Proxy (https://cocproxy.royaleapi.dev/v1), autorizá la IP ${ROYALE_API_PROXY_IP} en developer.clashofclans.com.${outboundIp ? ` IP actual detectada: ${outboundIp}.` : ''}`
            }),
        detail: data
      });
    }

    return res.status(status).json({
      error: 'Error en la petición a Supercell',
      detail: data
    });
  }

  // Errores de Supabase Auth (AuthApiError)
  if (err.__isAuthError || err.name === 'AuthApiError') {
    if (err.code === 'over_email_send_rate_limit') {
      return res.status(429).json({
        error: 'Límite de correos alcanzado en Supabase (máximo 3-4 correos por hora en el plan gratuito).',
        solution: 'Solución: Ve a Supabase Dashboard > Authentication > Providers > Email y desactiva "Confirm email" (clic en Save). Así podrás crear y probar usuarios al instante sin límite.',
        code: err.code
      });
    }
    return res.status(err.status || 400).json({
      error: err.message,
      code: err.code || 'auth_error'
    });
  }

  // Errores de PostgreSQL / PostgREST (Supabase DB)
  if (err.code) {
    // 23505: unique_violation
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Conflicto: Ya existe un registro con estos datos únicos.',
        detail: err.message || err.details
      });
    }

    // 23503: foreign_key_violation
    if (err.code === '23503') {
      return res.status(400).json({
        error: 'Violación de clave foránea: El registro referenciado no existe.',
        detail: err.message || err.details
      });
    }

    // 23514: check_violation
    if (err.code === '23514') {
      return res.status(400).json({
        error: 'Los datos no cumplen con las restricciones de la base de datos (Check violation).',
        detail: err.message || err.details
      });
    }

    // 42501: insufficient_privilege (Row-Level Security violation)
    if (err.code === '42501') {
      return res.status(403).json({
        error: 'Acceso denegado por políticas de seguridad (RLS). No tienes permisos para realizar esta acción.',
        detail: err.message
      });
    }

    // PGRST116: The result contains 0 rows (when single() was expected)
    if (err.code === 'PGRST116') {
      return res.status(404).json({
        error: 'Registro no encontrado',
        detail: err.message
      });
    }
  }

  // Errores de validación personalizados
  if (err.status) {
    return res.status(err.status).json({
      error: err.message,
      detail: err.detail || null
    });
  }

  // Errores internos no controlados
  res.status(500).json({
    error: 'Error interno del servidor',
    detail: err.message || 'Ocurrió un error inesperado'
  });
};
