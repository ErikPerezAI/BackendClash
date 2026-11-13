import { Router } from 'express';
import {
  listProfiles,
  getMyProfile,
  getProfileById,
  updateMyProfile,
  switchMyRoleForDemo,
  updateUserRoleByAdmin
} from '../controllers/profile.controller.js';
import { requireAdmin, requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', listProfiles);
router.get('/me', requireAuth, getMyProfile);
router.put('/me', requireAuth, updateMyProfile);
router.patch('/me', requireAuth, updateMyProfile);
router.put('/me/role', requireAuth, switchMyRoleForDemo);
router.put('/:id/role', requireAuth, requireAdmin, updateUserRoleByAdmin);
router.get('/:id', getProfileById);

export default router;
