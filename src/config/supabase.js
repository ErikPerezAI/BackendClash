import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const rawKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !rawKey) {
  console.warn('⚠️ ADVERTENCIA: SUPABASE_URL o clave de Supabase no están configuradas en .env');
}

/**
 * Determina si una clave corresponde a la clave secreta / service_role de Supabase
 */
const checkIsServiceRole = (key) => {
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;
  try {
    const parts = key.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      return payload.role === 'service_role';
    }
  } catch {
    return false;
  }
  return false;
};

// Cliente anónimo / estándar para operaciones públicas y Auth
export const supabaseClient = createClient(supabaseUrl || '', rawKey || '', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

// Cliente admin con privilegios elevados (solo si se proporciona una clave service_role real)
const explicitAdminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabaseAdmin = checkIsServiceRole(explicitAdminKey)
  ? createClient(supabaseUrl || '', explicitAdminKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      }
    })
  : null;

/**
 * Retorna una instancia del cliente de Supabase con el token JWT del usuario autenticado.
 * Esto permite que las políticas RLS (Row Level Security) de Postgres como `auth.uid() = user_id`
 * se evalúen con la identidad real del usuario en cada consulta.
 *
 * @param {string} token - Token de acceso JWT (con o sin prefijo 'Bearer ')
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
export const getScopedSupabaseClient = (token) => {
  if (!token) return supabaseClient;

  const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;

  return createClient(supabaseUrl || '', rawKey || '', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${cleanToken}`
      }
    }
  });
};
