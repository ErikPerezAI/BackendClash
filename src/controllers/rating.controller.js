import { supabaseClient } from '../config/supabase.js';
import { createAndSendNotification } from '../services/notification.service.js';

/**
 * Calificar una publicación (1 a 5 estrellas).
 * Si el usuario ya la había calificado, actualiza su voto (Upsert).
 */
export const ratePost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const { stars } = req.body;

    const parsedStars = parseInt(stars, 10);
    if (isNaN(parsedStars) || parsedStars < 1 || parsedStars > 5) {
      return res.status(400).json({
        error: 'Las estrellas deben ser un número entero entre 1 y 5'
      });
    }

    // Verificar que la publicación exista
    const { data: post, error: postErr } = await (req.supabase || supabaseClient)
      .from('community_posts')
      .select('id, author_id, title')
      .eq('id', postId)
      .maybeSingle();

    if (postErr) throw postErr;
    if (!post) {
      return res.status(404).json({ error: 'La publicación a calificar no existe' });
    }

    // Upsert de calificación
    const { data, error } = await req.supabase
      .from('post_ratings')
      .upsert({
        post_id: postId,
        user_id: req.user.id,
        stars: parsedStars
      }, {
        onConflict: 'post_id,user_id'
      })
      .select()
      .single();

    if (error) throw error;

    // Obtener estadísticas actualizadas de calificaciones para este post
    const { data: allRatings } = await (req.supabase || supabaseClient)
      .from('post_ratings')
      .select('stars')
      .eq('post_id', postId);

    const count = allRatings?.length || 0;
    const avg = count > 0
      ? Number((allRatings.reduce((sum, r) => sum + r.stars, 0) / count).toFixed(2))
      : parsedStars;

    if (post.author_id && post.author_id !== req.user.id) {
      const raterName = req.user?.user_metadata?.username || 'Un estratega';
      createAndSendNotification({
        userId: post.author_id,
        title: `⭐ Nueva calificación en "${post.title || 'tu publicación'}"`,
        body: `${raterName} calificó tu publicación con ${parsedStars} estrella${parsedStars > 1 ? 's' : ''} (Promedio: ⭐ ${avg}).`,
        type: 'community_rating',
        data: {
          post_id: postId,
          stars: parsedStars
        }
      }).catch(() => {});
    }

    res.status(200).json({
      message: 'Calificación registrada exitosamente',
      rating: data,
      average_rating: avg,
      ratings_count: count
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtener todas las calificaciones de una publicación y su promedio
 */
export const getPostRatings = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const client = req.supabase || supabaseClient;

    const { data, error } = await client
      .from('post_ratings')
      .select(`
        id,
        stars,
        created_at,
        user:profiles (id, username, avatar_url)
      `)
      .eq('post_id', postId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const count = data.length;
    const avg = count > 0
      ? Number((data.reduce((sum, r) => sum + r.stars, 0) / count).toFixed(2))
      : 0;

    res.status(200).json({
      count,
      average_rating: avg,
      ratings: data
    });
  } catch (error) {
    next(error);
  }
};
