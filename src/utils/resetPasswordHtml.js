/**
 * Genera la página HTML interactiva para el restablecimiento de contraseñas de ClashTactics.
 * Diseñada para funcionar tanto en computadoras de escritorio como en dispositivos móviles (iOS/Android).
 */
export function getResetPasswordHtml() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Restablecer Contraseña | ClashTactics</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #0d1117;
      color: #f0f6fc;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      width: 100%;
      max-width: 440px;
      background-color: #161b22;
      border: 1px solid #30363d;
      border-radius: 16px;
      padding: 32px 24px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
      text-align: center;
    }
    .brand-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      background: linear-gradient(135deg, #E6A620, #D97706);
      border-radius: 14px;
      margin-bottom: 16px;
      box-shadow: 0 4px 16px rgba(230, 166, 32, 0.35);
    }
    .brand-badge svg {
      width: 32px;
      height: 32px;
      fill: #11141A;
    }
    h1 {
      font-size: 24px;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 8px;
      letter-spacing: -0.3px;
    }
    .subtitle {
      font-size: 14px;
      color: #8b949e;
      margin-bottom: 24px;
      line-height: 1.5;
    }
    .alert {
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 13px;
      margin-bottom: 20px;
      text-align: left;
      line-height: 1.4;
      display: none;
    }
    .alert-error {
      background-color: rgba(239, 68, 68, 0.15);
      border: 1px solid #ef4444;
      color: #fca5a5;
    }
    .alert-success {
      background-color: rgba(16, 185, 129, 0.15);
      border: 1px solid #10b981;
      color: #6ee7b7;
    }
    .form-group {
      text-align: left;
      margin-bottom: 18px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #c9d1d9;
      margin-bottom: 6px;
    }
    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    input {
      width: 100%;
      background-color: #0d1117;
      border: 1px solid #30363d;
      border-radius: 10px;
      padding: 12px 14px;
      padding-right: 44px;
      font-size: 15px;
      color: #f0f6fc;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    input:focus {
      border-color: #E6A620;
      box-shadow: 0 0 0 3px rgba(230, 166, 32, 0.2);
    }
    .toggle-pwd {
      position: absolute;
      right: 12px;
      background: none;
      border: none;
      color: #8b949e;
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .toggle-pwd svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }
    .submit-btn {
      width: 100%;
      background: linear-gradient(135deg, #F7B928, #E6A620);
      color: #11141A;
      font-size: 15px;
      font-weight: 700;
      border: none;
      border-radius: 10px;
      padding: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(230, 166, 32, 0.25);
      transition: opacity 0.2s, transform 0.1s;
      margin-top: 24px;
    }
    .submit-btn:hover {
      opacity: 0.95;
    }
    .submit-btn:active {
      transform: scale(0.98);
    }
    .submit-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(17, 20, 26, 0.3);
      border-top-color: #11141A;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      display: none;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .success-view {
      display: none;
      text-align: center;
      padding: 10px 0;
    }
    .success-icon {
      width: 64px;
      height: 64px;
      background-color: rgba(16, 185, 129, 0.2);
      border: 2px solid #10b981;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }
    .success-icon svg {
      width: 36px;
      height: 36px;
      fill: #10b981;
    }
    .app-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: linear-gradient(135deg, #F7B928, #E6A620);
      color: #11141A;
      font-size: 15px;
      font-weight: 700;
      text-decoration: none;
      border-radius: 10px;
      padding: 14px 24px;
      margin-top: 24px;
      box-shadow: 0 4px 16px rgba(230, 166, 32, 0.3);
    }
    .app-btn svg {
      width: 20px;
      height: 20px;
      fill: #11141A;
    }
    .footer-text {
      font-size: 12px;
      color: #8b949e;
      margin-top: 24px;
    }
    .footer-text a {
      color: #E6A620;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand-badge">
      <!-- Shield SVG Icon -->
      <svg viewBox="0 0 24 24">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
      </svg>
    </div>

    <h1>ClashTactics</h1>
    <p class="subtitle" id="form-subtitle">Ingresa tu nueva contraseña para acceder a tu cuenta.</p>

    <div class="alert alert-error" id="error-alert"></div>
    <div class="alert alert-success" id="success-alert"></div>

    <form id="reset-form" onsubmit="handleResetPassword(event)">
      <!-- Campos opcionales si no se cuenta con token en la URL -->
      <div class="form-group" id="group-email" style="display: none;">
        <label for="email">Correo electrónico</label>
        <div class="input-wrapper">
          <input type="email" id="email" placeholder="correo@ejemplo.com" autocomplete="email">
        </div>
      </div>

      <div class="form-group" id="group-token" style="display: none;">
        <label for="token">Código de recuperación (OTP)</label>
        <div class="input-wrapper">
          <input type="text" id="token" placeholder="Ej: 12345678" autocomplete="one-time-code">
        </div>
      </div>

      <div class="form-group">
        <label for="password">Nueva contraseña</label>
        <div class="input-wrapper">
          <input type="password" id="password" placeholder="Mínimo 6 caracteres" required minlength="6" autocomplete="new-password">
          <button type="button" class="toggle-pwd" onclick="togglePasswordVisibility('password')">
            <svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
          </button>
        </div>
      </div>

      <div class="form-group">
        <label for="confirm-password">Confirmar nueva contraseña</label>
        <div class="input-wrapper">
          <input type="password" id="confirm-password" placeholder="Repite la nueva contraseña" required minlength="6" autocomplete="new-password">
          <button type="button" class="toggle-pwd" onclick="togglePasswordVisibility('confirm-password')">
            <svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
          </button>
        </div>
      </div>

      <button type="submit" class="submit-btn" id="submit-btn">
        <span class="spinner" id="btn-spinner"></span>
        <span id="btn-text">Guardar nueva contraseña</span>
      </button>
    </form>

    <div class="success-view" id="success-view">
      <div class="success-icon">
        <svg viewBox="0 0 24 24">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
      </div>
      <h2 style="color: #ffffff; font-size: 20px; margin-bottom: 8px;">¡Contraseña Restablecida!</h2>
      <p style="color: #8b949e; font-size: 14px; line-height: 1.5; margin-bottom: 20px;">
        Tu contraseña ha sido actualizada exitosamente. Ya puedes abrir la aplicación ClashTactics e iniciar sesión.
      </p>
      <a href="clashtactics://" class="app-btn">
        <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
        Abrir ClashTactics
      </a>
    </div>

    <p class="footer-text">
      ¿Problemas para acceder? Contacta al soporte de <a href="clashtactics://">ClashTactics</a>.
    </p>
  </div>

  <script>
    let currentAccessToken = null;

    // Analizar fragmento hash (#access_token=...&type=recovery) y query params (?code=...&token=...)
    function parseAuthParameters() {
      const hash = window.location.hash.substring(1);
      const hashParams = new URLSearchParams(hash);
      const queryParams = new URLSearchParams(window.location.search);

      const accessToken = hashParams.get('access_token') || queryParams.get('access_token');
      const token = queryParams.get('token') || queryParams.get('code');
      const email = queryParams.get('email');

      if (accessToken) {
        currentAccessToken = accessToken;
      } else {
        // Si no hay access_token, mostramos los campos de email y código OTP
        document.getElementById('group-email').style.display = 'block';
        document.getElementById('group-token').style.display = 'block';
        if (email) document.getElementById('email').value = email;
        if (token) document.getElementById('token').value = token;
      }
    }

    parseAuthParameters();

    function togglePasswordVisibility(inputId) {
      const input = document.getElementById(inputId);
      input.type = input.type === 'password' ? 'text' : 'password';
    }

    function showError(msg) {
      const el = document.getElementById('error-alert');
      el.textContent = msg;
      el.style.display = 'block';
      document.getElementById('success-alert').style.display = 'none';
    }

    function hideError() {
      document.getElementById('error-alert').style.display = 'none';
    }

    async function handleResetPassword(e) {
      e.preventDefault();
      hideError();

      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirm-password').value;

      if (!password || password.length < 6) {
        showError('La nueva contraseña debe tener al menos 6 caracteres.');
        return;
      }

      if (password !== confirmPassword) {
        showError('Las contraseñas no coinciden. Por favor verifícalas.');
        return;
      }

      const submitBtn = document.getElementById('submit-btn');
      const spinner = document.getElementById('btn-spinner');
      const btnText = document.getElementById('btn-text');

      submitBtn.disabled = true;
      spinner.style.display = 'inline-block';
      btnText.textContent = 'Actualizando...';

      const payload = {
        new_password: password,
        confirm_password: confirmPassword
      };

      if (currentAccessToken) {
        payload.access_token = currentAccessToken;
      } else {
        payload.email = document.getElementById('email').value.trim();
        payload.token = document.getElementById('token').value.trim();

        if (!payload.email || !payload.token) {
          showError('Debes ingresar tu correo electrónico y el código de recuperación.');
          submitBtn.disabled = false;
          spinner.style.display = 'none';
          btnText.textContent = 'Guardar nueva contraseña';
          return;
        }
      }

      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || data.detail || 'No se pudo restablecer la contraseña.');
        }

        // Mostrar vista de éxito
        document.getElementById('reset-form').style.display = 'none';
        document.getElementById('form-subtitle').style.display = 'none';
        document.getElementById('success-view').style.display = 'block';

        // Intento automático de abrir la app mediante deep link después de 1 segundo
        setTimeout(() => {
          window.location.href = 'clashtactics://';
        }, 1200);
      } catch (err) {
        showError(err.message);
      } finally {
        submitBtn.disabled = false;
        spinner.style.display = 'none';
        btnText.textContent = 'Guardar nueva contraseña';
      }
    }
  </script>
</body>
</html>`;
}
