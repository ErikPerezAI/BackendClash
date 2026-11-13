import { supabaseAdmin, supabaseClient } from '../config/supabase.js';
import { getUserRole } from '../middlewares/auth.middleware.js';
import { moderateComment } from '../services/aiModeration.service.js';
import { createAndSendNotification } from '../services/notification.service.js';

/**
 * Listar todos los comentarios de una publicación
 */
export const listComments = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const client = req.supabase || supabaseClient;

    const { data, error } = await client
      .from('post_comments')
      .select(`
        id,
        post_id,
        user_id,
        content,
        created_at,
        author:profiles (id, username, avatar_url, role)
      `)
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.status(200).json({
      count: data.length,
      comments: data
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Agregar un nuevo comentario a una publicación
 */
export const addComment = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'El contenido del comentario no puede estar vacío' });
    }

    // Verificar que la publicación exista
    const { data: post, error: postErr } = await (req.supabase || supabaseClient)
      .from('community_posts')
      .select('id, author_id, title')
      .eq('id', postId)
      .maybeSingle();

    if (postErr) throw postErr;
    if (!post) {
      return res.status(404).json({ error: 'La publicación no existe' });
    }

    // Moderar contenido del comentario con IA
    const moderation = await moderateComment({
      author: req.user?.username || req.user?.id || 'Usuario',
      content: content.trim()
    });

    if (!moderation.ok) {
      return res.status(400).json({
        error: `Contenido rechazado: ${moderation.reason}`
      });
    }

    const { data, error } = await req.supabase
      .from('post_comments')
      .insert({
        post_id: postId,
        user_id: req.user.id,
        content: content.trim()
      })
      .select(`
        id,
        post_id,
        user_id,
        content,
        created_at,
        author:profiles (id, username, avatar_url, role)
      `)
      .single();

    if (error) throw error;

    // Notificar al autor de la publicación si otra persona comentó
    if (post.author_id && post.author_id !== req.user.id) {
      const commenterName = data?.author?.username || req.user?.user_metadata?.username || 'Un estratega';
      createAndSendNotification({
        userId: post.author_id,
        title: `💬 Nuevo comentario en "${post.title || 'tu publicación'}"`,
        body: `${commenterName} comentó: "${content.trim().slice(0, 90)}"`,
        type: 'community_comment',
        data: {
          post_id: postId,
          comment_id: data.id
        }
      }).catch(() => {});
    }

    res.status(201).json({
      message: 'Comentario agregado exitosamente',
      comment: data
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Eliminar un comentario (Solo el autor del comentario o un admin)
 */
export const deleteComment = async (req, res, next) => {
  try {
    const { commentId, id } = req.params;
    const targetId = commentId || id;

    const role = await getUserRole(req);
    const isAdmin = role === 'admin';
    const dbClient = isAdmin ? (supabaseAdmin || req.supabase) : req.supabase;

    let deleteQuery = dbClient
      .from('post_comments')
      .delete()
      .eq('id', targetId);

    if (!isAdmin) {
      deleteQuery = deleteQuery.eq('user_id', req.user.id);
    }

    const { data, error } = await deleteQuery.select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(403).json({
        error: 'Comentario no encontrado o no tienes permisos para eliminarlo (solo autor o administrador)'
      });
    }

    res.status(200).json({
      message: isAdmin
        ? 'Comentario eliminado por moderación de administrador'
        : 'Comentario eliminado exitosamente',
      deleted: data[0]
    });
  } catch (error) {
    next(error);
  }
};
