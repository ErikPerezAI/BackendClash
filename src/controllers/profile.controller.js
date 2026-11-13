import { supabaseAdmin, supabaseClient } from '../config/supabase.js';

/**
 * Listar perfiles públicos
 */
export const listProfiles = async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;
    const search = req.query.search;

    let query = supabaseClient
      .from('profiles')
      .select('id, username, avatar_url, role, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.ilike('username', `%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.status(200).json({
      count: data.length,
      limit,
      offset,
      profiles: data
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtener el perfil del usuario autenticado
 */
export const getMyProfile = async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;

    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Obtener un perfil por su ID (UUID) o por su username
 */
export const getProfileById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);

    let query = supabaseClient.from('profiles').select('*');
    if (isUUID) {
      query = query.eq('id', id);
    } else {
      query = query.eq('username', id);
    }

    const { data, error } = await query.maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'Perfil no encontrado' });
    }

    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * Si avatar_url viene como Data URI base64 (ej. imagen recortada de la galería),
 * la sube al bucket público `avatars` de Supabase Storage bajo la carpeta del usuario
 * y retorna la URL pública (o conserva el data URI como respaldo si falla el bucket).
 */
async function resolveUploadedAvatarUrl(req, rawAvatarUrl) {
  if (!rawAvatarUrl || typeof rawAvatarUrl !== 'string') {
    return rawAvatarUrl;
  }

  const dataUriMatch = rawAvatarUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!dataUriMatch) {
    return rawAvatarUrl;
  }

  const mimeType = dataUriMatch[1].toLowerCase();
  const base64Data = dataUriMatch[2];
  const ext = mimeType.includes('png')
    ? 'png'
    : mimeType.includes('webp')
      ? 'webp'
      : 'jpg';

  const buffer = Buffer.from(base64Data, 'base64');
  const filePath = `${req.user.id}/avatar_${Date.now()}.${ext}`;

  try {
    const { error: uploadError } = await req.supabase.storage
      .from('avatars')
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: true
      });

    if (!uploadError) {
      const { data: publicUrlData } = req.supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      if (publicUrlData?.publicUrl) {
        return publicUrlData.publicUrl;
      }
    }
  } catch {
    // Si falla el almacenamiento en bucket, guardamos el data URI directamente en avatar_url
  }

  return rawAvatarUrl;
}

/**
 * Actualizar datos del perfil del usuario autenticado (username, avatar_url)
 */
export const updateMyProfile = async (req, res, next) => {
  try {
    const { username, avatar_url } = req.body;
    const updates = {
      updated_at: new Date().toISOString()
    };

    if (username !== undefined) {
      const cleanUsername = username.trim();
      if (!cleanUsername) {
        return res.status(400).json({ error: 'El nombre de usuario no puede estar vacío' });
      }

      // Validar si el username ya está ocupado por otro usuario
      const { data: existing } = await req.supabase
        .from('profiles')
        .select('id')
        .eq('username', cleanUsername)
        .neq('id', req.user.id)
        .maybeSingle();

      if (existing) {
        return res.status(400).json({ error: `El nombre de usuario "${cleanUsername}" ya está en uso.` });
      }

      updates.username = cleanUsername;
    }

    if (avatar_url !== undefined) {
      updates.avatar_url = await resolveUploadedAvatarUrl(req, avatar_url);
    }

    const { data, error } = await req.supabase
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json({
      message: 'Perfil actualizado exitosamente',
      profile: data
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Cambiar el rol del propio usuario autenticado ('user' | 'admin') para demostración y pruebas de permisos
 * PUT /api/profiles/me/role
 */
export const switchMyRoleForDemo = async (req, res, next) => {
  try {
    const rawRole = String(req.body?.role || '').trim().toLowerCase();
    if (!['user', 'admin'].includes(rawRole)) {
      return res.status(400).json({
        error: 'El rol debe ser "user" o "admin"'
      });
    }

    const dbClient = supabaseAdmin || req.supabase;
    const { data, error } = await dbClient
      .from('profiles')
      .update({
        role: rawRole,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json({
      message: `Tu rol ha sido actualizado a "${rawRole.toUpperCase()}" exitosamente`,
      profile: data
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Actualizar el rol de cualquier usuario del sistema (Requiere rol de Administrador)
 * PUT /api/profiles/:id/role
 */
export const updateUserRoleByAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const rawRole = String(req.body?.role || '').trim().toLowerCase();

    if (!['user', 'admin'].includes(rawRole)) {
      return res.status(400).json({
        error: 'El rol debe ser "user" o "admin"'
      });
    }

    const dbClient = supabaseAdmin || req.supabase;
    const { data, error } = await dbClient
      .from('profiles')
      .update({
        role: rawRole,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.status(200).json({
      message: `Rol de @${data.username} actualizado a "${rawRole.toUpperCase()}"`,
      profile: data
    });
  } catch (error) {
    next(error);
  }
};
