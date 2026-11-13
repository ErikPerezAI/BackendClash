import { Router } from 'express';
import {
  listPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost
} from '../controllers/post.controller.js';
import { ratePost, getPostRatings } from '../controllers/rating.controller.js';
import { listComments, addComment, deleteComment } from '../controllers/comment.controller.js';
import { requireAuth, optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Publicaciones
router.get('/', optionalAuth, listPosts);
router.post('/', requireAuth, createPost);
router.get('/:id', optionalAuth, getPostById);
router.put('/:id', requireAuth, updatePost);
router.delete('/:id', requireAuth, deletePost);

// Calificaciones (Ratings)
router.post('/:postId/ratings', requireAuth, ratePost);
router.get('/:postId/ratings', optionalAuth, getPostRatings);

// Comentarios
router.get('/:postId/comments', optionalAuth, listComments);
router.post('/:postId/comments', requireAuth, addComment);
router.delete('/:postId/comments/:commentId', requireAuth, deleteComment);

export default router;
