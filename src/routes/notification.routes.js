import { Router } from 'express';
import {
  getWorkerStatus,
  listMyNotifications,
  markRead,
  registerPushToken,
  sendTestNotification,
  triggerBackgroundSync
} from '../controllers/notification.controller.js';
import { optionalAuth, requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', requireAuth, listMyNotifications);
router.post('/register-token', requireAuth, registerPushToken);
router.put('/read', requireAuth, markRead);
router.post('/test', requireAuth, sendTestNotification);
router.get('/background-status', optionalAuth, getWorkerStatus);
router.post('/run-background-sync', requireAuth, triggerBackgroundSync);

export default router;
