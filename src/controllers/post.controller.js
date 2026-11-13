import { supabaseAdmin, supabaseClient } from '../config/supabase.js';
import { getUserRole } from '../middlewares/auth.middleware.js';
import { moderatePost } from '../services/aiModeration.service.js';

const ALLOWED_CATEGORIES = ['Guerra', 'Farming', 'Subida', 'Estrategia'];
const ALLOWED_POST_TYPES = ['base_layout', 'army_strategy'];

/**
 * Si image_url viene como Data URI base64 (ej. foto seleccionada desde la galería),
 * intenta subirla al bucket público `avatars` de Supabase Storage bajo la carpeta del usuario
 * y retorna la URL pública (o conserva el data URI como respaldo si falla el bucket).
 */
async function resolveUploadedPostImageUrl(req, rawImageUrl) {
  if (!rawImageUrl || typeof rawImageUrl !== 'string') {
    return rawImageUrl || null;
  }

  const dataUriMatch = rawImageUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!dataUriMatch) {
    return rawImageUrl.trim() || null;
  }

  const mimeType = dataUriMatch[1].toLowerCase();
  const base64Data = dataUriMatch[2];
  const ext = mimeType.includes('png')
    ? 'png'
    : mimeType.includes('webp')
      ? 'webp'
      : 'jpg';

  const buffer = Buffer.from(base64Data, 'base64');
  const filePath = `${req.user.id}/post_${Date.now()}.${ext}`;

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
    // Fallback a data URI directamente si falla el bucket
  }

  return rawImageUrl;
}

/**
 * Consulta y formatea publicaciones de community_posts con promedios de calificación y conteo de comentarios.
 * Reutilizable desde el controlador REST y desde herramientas del chatbot.
 */
export const queryFormattedPosts = async (
  client = supabaseClient,
  {
    post_type,
    town_hall_level,
    category,
    author_id,
    search,
    limit = 20,
    offset = 0,
    sort = 'newest',
    userId = null
  } = {}
) => {
  const parsedLimit = Math.min(parseInt(limit, 10) || 20, 100);
  const parsedOffset = parseInt(offset, 10) || 0;
  const activeClient = client || supabaseClient;

  let query = activeClient
    .from('community_posts')
    .select(`
      id,
      author_id,
      post_type,
      title,
      description,
      town_hall_level,
      category,
      image_url,
      deep_link,
      video_url,
      army_composition,
      is_moderated,
      created_at,
      updated_at,
      author:profiles (id, username, avatar_url, role),
      ratings:post_ratings (stars, user_id),
      comments:post_comments (count)
    `)
    .range(parsedOffset, parsedOffset + parsedLimit - 1);

  if (post_type && ALLOWED_POST_TYPES.includes(post_type)) {
    query = query.eq('post_type', post_type);
  } else if (post_type) {
    query = query.eq('post_type', post_type);
  }

  if (town_hall_level) {
    const cleanTh = String(town_hall_level).trim().toUpperCase();
    const formattedTh = cleanTh.startsWith('TH') ? cleanTh : `TH${cleanTh.replace(/[^0-9]/g, '')}`;
    if (formattedTh !== 'TH') {
      query = query.eq('town_hall_level', formattedTh);
    }
  }

  if (category) {
    query = query.eq('category', category);
  }

  if (author_id) {
    query = query.eq('author_id', author_id);
  }

  if (search && String(search).trim()) {
    const q = String(search).trim();
    query = query.ilike('title', `%${q}%`);
  }

  if (sort === 'oldest') {
    query = query.order('created_at', { ascending: true });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw error;

  let posts = (data || []).map((post) => {
    const ratings = post.ratings || [];
    const count = ratings.length;
    const avg = count > 0
      ? Number((ratings.reduce((sum, r) => sum + r.stars, 0) / count).toFixed(2))
      : 0;
    const commentsCount = post.comments?.[0]?.count || 0;
    const myRating = userId
      ? (ratings.find((r) => r.user_id === userId)?.stars ?? null)
      : null;

    const { ratings: _r, comments: _c, ...rest } = post;
    return {
      ...rest,
      ratings_count: count,
      average_rating: avg,
      my_rating: myRating,
      comments_count: commentsCount
    };
  });

  if (sort === 'top_rated') {
    posts = posts.sort((a, b) => {
      if (b.average_rating !== a.average_rating) {
        return b.average_rating - a.average_rating;
      }
      return b.ratings_count - a.ratings_count;
    });
  }

  return {
    posts,
    limit: parsedLimit,
    offset: parsedOffset
  };
};

/**
 * Listar publicaciones con filtros (post_type, town_hall_level, category, etc.)
 */
export const listPosts = async (req, res, next) => {
  try {
    const {
      post_type,
      town_hall_level,
      category,
      author_id,
      search,
      limit = 20,
      offset = 0,
      sort = 'newest'
    } = req.query;

    const client = req.supabase || supabaseClient;
    const { posts, limit: parsedLimit, offset: parsedOffset } = await queryFormattedPosts(client, {
      post_type,
      town_hall_level,
      category,
      author_id,
      search,
      limit,
      offset,
      sort,
      userId: req.user?.id || null
    });

    res.status(200).json({
      count: posts.length,
      limit: parsedLimit,
      offset: parsedOffset,
      posts
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtener el detalle de una publicación por ID, incluyendo calificaciones y comentarios
 */
export const getPostById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const client = req.supabase || supabaseClient;

    const { data: post, error } = await client
      .from('community_posts')
      .select(`
        *,
        author:profiles (id, username, avatar_url, role),
        ratings:post_ratings (id, user_id, stars, created_at),
        comments:post_comments (
          id,
          user_id,
          content,
          created_at,
          author:profiles (id, username, avatar_url, role)
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!post) {
      return res.status(404).json({ error: 'Publicación no encontrada' });
    }

    // Calcular promedio
    const ratings = post.ratings || [];
    const count = ratings.length;
    const avg = count > 0
      ? Number((ratings.reduce((sum, r) => sum + r.stars, 0) / count).toFixed(2))
      : 0;
    const myRating = req.user
      ? (ratings.find((r) => r.user_id === req.user.id)?.stars ?? null)
      : null;

    res.status(200).json({
      ...post,
      ratings_count: count,
      average_rating: avg,
      my_rating: myRating
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Crear una nueva publicación (aldea o ejército)
 */
export const createPost = async (req, res, next) => {
  try {
    const {
      post_type,
      title,
      description,
      town_hall_level,
      category,
      image_url,
      deep_link,
      video_url,
      army_composition
    } = req.body;

    if (!post_type || !title || !town_hall_level) {
      return res.status(400).json({
        error: 'Los campos post_type, title y town_hall_level son obligatorios'
      });
    }

    if (!ALLOWED_POST_TYPES.includes(post_type)) {
      return res.status(400).json({
        error: `post_type inválido. Debe ser uno de: ${ALLOWED_POST_TYPES.join(', ')}`
      });
    }

    const postCategory = category || 'Guerra';
    if (!ALLOWED_CATEGORIES.includes(postCategory)) {
      return res.status(400).json({
        error: `category inválida. Debe ser una de: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }

    // Moderación automática con IA (Texto e Imagen)
    const moderation = await moderatePost({
      author: req.user?.username || req.user?.id || 'Usuario',
      title: title.trim(),
      description: description ? description.trim() : '',
      category: postCategory,
      imageUrl: image_url || null
    });

    if (!moderation.ok) {
      return res.status(400).json({
        error: `Contenido rechazado: ${moderation.reason}`
      });
    }

    const resolvedImageUrl = image_url ? await resolveUploadedPostImageUrl(req, image_url) : null;

    const { data, error } = await req.supabase
      .from('community_posts')
      .insert({
        author_id: req.user.id,
        post_type,
        title: title.trim(),
        description: description ? description.trim() : null,
        town_hall_level: town_hall_level.trim().toUpperCase(),
        category: postCategory,
        image_url: resolvedImageUrl,
        deep_link: deep_link || null,
        video_url: video_url || null,
        army_composition: army_composition || null,
        is_moderated: true
      })
      .select(`
        *,
        author:profiles (id, username, avatar_url, role)
      `)
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Publicación creada exitosamente',
      post: data
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Actualizar una publicación existente (Solo el autor o un admin)
 */
export const updatePost = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      town_hall_level,
      category,
      image_url,
      deep_link,
      video_url,
      army_composition
    } = req.body;

    const updates = {
      updated_at: new Date().toISOString()
    };

    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description ? description.trim() : null;
    if (town_hall_level !== undefined) updates.town_hall_level = town_hall_level.trim().toUpperCase();
    if (category !== undefined) {
      if (!ALLOWED_CATEGORIES.includes(category)) {
        return res.status(400).json({
          error: `category inválida. Debe ser una de: ${ALLOWED_CATEGORIES.join(', ')}`
        });
      }
      updates.category = category;
    }
    if (image_url !== undefined) updates.image_url = image_url;
    if (deep_link !== undefined) updates.deep_link = deep_link;
    if (video_url !== undefined) updates.video_url = video_url;
    if (army_composition !== undefined) updates.army_composition = army_composition;

    // Si se modifican textos o imagen, verificar con IA
    if (title !== undefined || description !== undefined || image_url !== undefined) {
      const moderation = await moderatePost({
        author: req.user?.username || req.user?.id || 'Usuario',
        title: updates.title || '',
        description: updates.description || '',
        category: updates.category,
        imageUrl: updates.image_url
      });

      if (!moderation.ok) {
        return res.status(400).json({
          error: `Contenido rechazado: ${moderation.reason}`
        });
      }
    }

    if (updates.image_url) {
      updates.image_url = await resolveUploadedPostImageUrl(req, updates.image_url);
    }

    const role = await getUserRole(req);
    const isAdmin = role === 'admin';
    const dbClient = isAdmin ? (supabaseAdmin || req.supabase) : req.supabase;

    let updateQuery = dbClient
      .from('community_posts')
      .update(updates)
      .eq('id', id);

    if (!isAdmin) {
      updateQuery = updateQuery.eq('author_id', req.user.id);
    }

    const { data, error } = await updateQuery.select(`
      *,
      author:profiles (id, username, avatar_url, role)
    `);

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(403).json({
        error: 'Publicación no encontrada o no tienes permisos para modificarla (solo autor o administrador)'
      });
    }

    res.status(200).json({
      message: isAdmin
        ? 'Publicación actualizada exitosamente (moderación admin)'
        : 'Publicación actualizada exitosamente',
      post: data[0]
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Eliminar una publicación (Solo el autor o un admin)
 */
export const deletePost = async (req, res, next) => {
  try {
    const { id } = req.params;

    const role = await getUserRole(req);
    const isAdmin = role === 'admin';
    const dbClient = isAdmin ? (supabaseAdmin || req.supabase) : req.supabase;

    let deleteQuery = dbClient
      .from('community_posts')
      .delete()
      .eq('id', id);

    if (!isAdmin) {
      deleteQuery = deleteQuery.eq('author_id', req.user.id);
    }

    const { data, error } = await deleteQuery.select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(403).json({
        error: 'Publicación no encontrada o no tienes permisos para eliminarla (solo autor o administrador)'
      });
    }

    res.status(200).json({
      message: isAdmin
        ? 'Publicación eliminada por moderación de administrador'
        : 'Publicación eliminada exitosamente',
      deleted: data[0]
    });
  } catch (error) {
    next(error);
  }
};
