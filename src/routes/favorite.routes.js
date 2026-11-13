import { Router } from 'express';
import {
  listFavorites,
  addFavorite,
  toggleFavorite,
  removeFavorite,
  removeFavoriteByTarget,
  checkFavorite,
  getFavoriteLive
} from '../controllers/favorite.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Todas las rutas de favoritos requieren usuario autenticado
router.use(requireAuth);

router.get('/', listFavorites);
router.get('/check', checkFavorite);
router.post('/toggle', toggleFavorite);
router.delete('/target', removeFavoriteByTarget);
router.get('/:id/live', getFavoriteLive);
router.post('/', addFavorite);
router.delete('/:id', removeFavorite);

export default router;
