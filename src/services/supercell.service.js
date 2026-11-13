import axios from 'axios';

export const DEFAULT_COC_API_BASE_URL = 'https://api.clashofclans.com/v1';
export const ROYALE_API_PROXY_BASE_URL = 'https://cocproxy.royaleapi.dev/v1';
export const ROYALE_API_PROXY_IP = '45.79.218.79';

const DEFAULT_TIMEOUT_MS = 12000;
const PROXY_STICKY_MS = 5 * 60 * 1000;
const STALE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const OUTBOUND_IP_TTL_MS = 10 * 60 * 1000;

const STATIC_TTL_MS = 30 * 60 * 1000;
const RANKINGS_TTL_MS = 10 * 60 * 1000;
const ENTITY_TTL_MS = 2 * 60 * 1000;

/**
 * Normaliza una URL base eliminando espacios y barras finales.
 * @param {string | undefined} rawUrl
 * @returns {string}
 */
const normalizeBaseUrl = (rawUrl) => (rawUrl || '').trim().replace(/\/+$/, '');

/**
 * Determina si la URL apunta a un proxy comunitario o externo distinto al host oficial.
 * @param {string} baseUrl
 * @returns {boolean}
 */
const isProxyUrl = (baseUrl) =>
  Boolean(baseUrl) && !baseUrl.includes('api.clashofclans.com');

/**
 * Serializa de forma determinística los parámetros de consulta para la clave de caché.
 * @param {Record<string, unknown> | undefined} params
 * @returns {string}
 */
const serializeParams = (params) => {
  if (!params || typeof params !== 'object') return '';
  const entries = Object.entries(params)
    .filter(([, val]) => val !== undefined && val !== null && val !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
};

/**
 * Construye la clave única de caché para una petición GET.
 * @param {string} url
 * @param {Record<string, unknown> | undefined} params
 * @returns {string}
 */
const buildCacheKey = (url, params) => {
  const qs = serializeParams(params);
  return qs ? `${url}?${qs}` : url;
};

/**
 * Determina el TTL de caché según la volatilidad del endpoint de Clash of Clans.
 * @param {string} url
 * @returns {number}
 */
const getTtlForPath = (url = '') => {
  const lower = url.toLowerCase();
  if (lower.includes('/rankings')) {
    return RANKINGS_TTL_MS;
  }
  if (
    lower.startsWith('/locations') ||
    lower.startsWith('/leagues') ||
    lower.startsWith('/warleagues') ||
    lower.startsWith('/builderbaseleagues') ||
    lower.startsWith('/capitalleagues') ||
    lower.startsWith('/labels') ||
    lower.startsWith('/goldpass')
  ) {
    return STATIC_TTL_MS;
  }
  return ENTITY_TTL_MS;
};

/**
 * Indica si un error permite activar conmutación hacia el proxy configurado.
 * (No conmuta ante 404/400 porque esos indican autenticación válida).
 * @param {any} error
 * @returns {boolean}
 */
const isFailoverEligibleError = (error) => {
  if (!error?.response) {
    return true;
  }
  return error.response.status === 403;
};

/**
 * Determina si ante una falla en vivo se puede responder con copia previa de respaldo.
 * Solo permite respaldo ante 403 si ya hubo al menos una respuesta exitosa previa.
 * @param {any} error
 * @param {boolean} hasPriorSuccess
 * @returns {boolean}
 */
const isStaleFallbackAllowed = (error, hasPriorSuccess) => {
  if (!error?.response) return true;
  const status = error.response.status;
  if (status === 429 || status >= 500) return true;
  if (status === 403 && hasPriorSuccess) return true;
  return false;
};

/**
 * Crea una instancia aislada y configurable del cliente de Supercell API.
 * Facilita tanto el uso en producción como las pruebas unitarias con mocks.
 */
export const createSupercellClient = ({
  httpRequest = (reqConfig) => axios.request(reqConfig),
  getConfig = () => ({
    primaryBaseUrl:
      normalizeBaseUrl(process.env.COC_API_BASE_URL) || DEFAULT_COC_API_BASE_URL,
    proxyBaseUrl:
      process.env.COC_API_PROXY_BASE_URL !== undefined
        ? normalizeBaseUrl(process.env.COC_API_PROXY_BASE_URL)
        : ROYALE_API_PROXY_BASE_URL,
    primaryKey: (process.env.COC_API_KEY || '').trim(),
    proxyKey: (process.env.COC_PROXY_API_KEY || process.env.COC_API_KEY || '').trim(),
    timeoutMs: Number(process.env.COC_API_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
  }),
  now = () => Date.now()
} = {}) => {
  const cache = new Map();
  const state = {
    stickyProxyUntil: 0,
    lastTransportUsed: null,
    lastErrorReason: null,
    lastErrorStatus: null,
    lastErrorAt: null,
    lastSuccessAt: null,
    outboundIp: null,
    outboundIpCheckedAt: 0
  };

  const setCacheEntry = (key, response, ttlMs) => {
    if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }
    const ts = now();
    cache.set(key, {
      data: response.data,
      status: response.status || 200,
      headers: response.headers || {},
      expiresAt: ts + ttlMs,
      staleUntil: ts + STALE_MAX_AGE_MS
    });
  };

  const resolveTargets = () => {
    const cfg = getConfig();
    const hasDistinctProxy =
      Boolean(cfg.proxyBaseUrl) &&
      cfg.proxyBaseUrl !== cfg.primaryBaseUrl &&
      Boolean(cfg.proxyKey || cfg.primaryKey);

    const preferProxy = hasDistinctProxy && state.stickyProxyUntil > now();

    const primaryTarget = {
      name: isProxyUrl(cfg.primaryBaseUrl) ? 'proxy-primary' : 'direct',
      baseURL: cfg.primaryBaseUrl,
      token: cfg.primaryKey,
      timeoutMs: cfg.timeoutMs
    };

    const fallbackTarget = hasDistinctProxy
      ? {
          name: 'proxy-fallback',
          baseURL: cfg.proxyBaseUrl,
          token: cfg.proxyKey || cfg.primaryKey,
          timeoutMs: cfg.timeoutMs
        }
      : null;

    if (preferProxy && fallbackTarget) {
      return [fallbackTarget, primaryTarget];
    }
    return fallbackTarget ? [primaryTarget, fallbackTarget] : [primaryTarget];
  };

  const executeOnTarget = async (target, method, url, data, config) => {
    const headers = { ...(config.headers || {}) };
    if (target.token && !headers.Authorization) {
      headers.Authorization = `Bearer ${target.token}`;
    }

    const response = await httpRequest({
      ...config,
      method,
      url,
      baseURL: target.baseURL,
      data,
      timeout: config.timeout || target.timeoutMs,
      headers
    });

    state.lastTransportUsed = target.name;
    state.lastSuccessAt = new Date(now()).toISOString();
    state.lastErrorReason = null;
    state.lastErrorStatus = null;

    if (target.name === 'proxy-fallback') {
      state.stickyProxyUntil = now() + PROXY_STICKY_MS;
    }

    return response;
  };

  const requestWithFailover = async (method, url, data, config = {}) => {
    const upperMethod = (method || 'GET').toUpperCase();
    const isCacheableGet = upperMethod === 'GET' && !config.bypassCache;
    const cacheKey = isCacheableGet ? buildCacheKey(url, config.params) : null;
    const ts = now();

    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > ts) {
        return {
          data: cached.data,
          status: cached.status,
          headers: cached.headers,
          fromCache: true,
          stale: false
        };
      }
    }

    const targets = resolveTargets();
    let lastError = null;

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      try {
        const response = await executeOnTarget(target, upperMethod, url, data, config);
        if (cacheKey && response?.data !== undefined) {
          setCacheEntry(cacheKey, response, getTtlForPath(url));
        }
        return response;
      } catch (err) {
        lastError = err;
        state.lastErrorStatus = err?.response?.status || null;
        state.lastErrorReason =
          err?.response?.data?.reason || err?.response?.data?.message || err?.message || 'unknown_error';
        state.lastErrorAt = new Date(now()).toISOString();

        const hasNextTarget = i + 1 < targets.length;
        if (!hasNextTarget || !isFailoverEligibleError(err)) {
          break;
        }
      }
    }

    if (cacheKey) {
      const staleEntry = cache.get(cacheKey);
      const hasPriorSuccess = state.lastSuccessAt !== null;
      if (
        staleEntry &&
        staleEntry.staleUntil > now() &&
        isStaleFallbackAllowed(lastError, hasPriorSuccess)
      ) {
        console.warn(
          `[SupercellService] Sirviendo respaldo en caché (stale) para ${url} tras error: ${state.lastErrorReason}`
        );
        return {
          data: staleEntry.data,
          status: staleEntry.status,
          headers: staleEntry.headers,
          fromCache: true,
          stale: true
        };
      }
    }

    throw lastError;
  };

  /**
   * Consulta la IPv4 pública actual desde la que egresa el servidor.
   */
  const getOutboundIp = async ({ forceRefresh = false } = {}) => {
    const ts = now();
    if (
      !forceRefresh &&
      state.outboundIp &&
      ts - state.outboundIpCheckedAt < OUTBOUND_IP_TTL_MS
    ) {
      return state.outboundIp;
    }

    try {
      const res = await httpRequest({
        method: 'GET',
        url: 'https://api.ipify.org?format=json',
        timeout: 2500
      });
      if (res?.data?.ip) {
        state.outboundIp = res.data.ip;
        state.outboundIpCheckedAt = now();
      }
    } catch {
      // No bloquear la app si api.ipify.org no responde
    }

    return state.outboundIp;
  };

  /**
   * Devuelve el modo de transporte activo sin llamadas de red.
   */
  const getMode = () => {
    if (state.lastTransportUsed) return state.lastTransportUsed;
    const cfg = getConfig();
    if (isProxyUrl(cfg.primaryBaseUrl)) return 'proxy-primary';
    if (state.stickyProxyUntil > now()) return 'proxy-fallback';
    return 'direct';
  };

  /**
   * Devuelve un resumen seguro del estado de conexión hacia Supercell (sin claves).
   */
  const getStatus = async ({ probeIp = false } = {}) => {
    const cfg = getConfig();
    const outboundIp = probeIp ? await getOutboundIp() : state.outboundIp;
    const mode = getMode();

    return {
      configured: Boolean(cfg.primaryKey || cfg.proxyKey),
      activeMode: mode,
      hasPrimaryKey: Boolean(cfg.primaryKey),
      hasProxyKey: Boolean(cfg.proxyKey),
      primaryBaseUrl: cfg.primaryBaseUrl,
      proxyBaseUrl: cfg.proxyBaseUrl || null,
      royaleApiRecommendedIp: ROYALE_API_PROXY_IP,
      cacheEntries: cache.size,
      outboundIp: outboundIp || null,
      lastErrorStatus: state.lastErrorStatus,
      lastErrorReason: state.lastErrorReason,
      lastErrorAt: state.lastErrorAt,
      lastSuccessAt: state.lastSuccessAt
    };
  };

  return {
    api: {
      get: (url, config = {}) => requestWithFailover('GET', url, undefined, config),
      post: (url, data, config = {}) => requestWithFailover('POST', url, data, config),
      request: (config = {}) =>
        requestWithFailover(
          (config.method || 'GET').toUpperCase(),
          config.url || '',
          config.data,
          config
        )
    },
    getOutboundIp,
    getCachedOutboundIp: () => state.outboundIp,
    getMode,
    getStatus,
    clearCache: () => cache.clear()
  };
};

const defaultSupercellClient = createSupercellClient();

export const supercellApi = defaultSupercellClient.api;
export const getOutboundIp = defaultSupercellClient.getOutboundIp;
export const getCachedOutboundIp = defaultSupercellClient.getCachedOutboundIp;
export const getSupercellMode = defaultSupercellClient.getMode;
export const getSupercellApiStatus = defaultSupercellClient.getStatus;
