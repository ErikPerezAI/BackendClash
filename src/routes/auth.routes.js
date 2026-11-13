import { Router } from 'express';
import {
  register,
  login,
  forgotPassword,
  resetPassword,
  serveResetPasswordPage,
  getGoogleOAuthUrl,
  startGoogleOAuth,
  oauthCallback,
  changePassword,
  getMe,
  logout
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/reset-password', serveResetPasswordPage);
router.get('/google-url', getGoogleOAuthUrl);
router.get('/google-start', startGoogleOAuth);
router.post('/google-callback', oauthCallback);
router.post('/oauth-callback', oauthCallback);
router.put('/change-password', requireAuth, changePassword);
router.post('/change-password', requireAuth, changePassword);
router.get('/me', requireAuth, getMe);
router.post('/logout', requireAuth, logout);

export default router;
