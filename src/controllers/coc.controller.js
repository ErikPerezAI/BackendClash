import { encodeTag } from '../utils/tag.util.js';
import {
  enrichClanWithAssets,
  enrichPlayerWithAssets,
  getBuilderBaseLeagueImageUrl,
  getCapitalLeagueImageUrl,
  getCountryFlagUrl,
  getWarLeagueImageUrl,
  resolvePlayerLeagueInfo
} from '../utils/assets.util.js';
import { getFullClanDetails, normalizeTag } from '../services/clan.service.js';
import {
  supercellApi,
  getSupercellApiStatus,
  ROYALE_API_PROXY_IP
} from '../services/supercell.service.js';
import { getUserRole } from '../middlewares/auth.middleware.js';

export { supercellApi };

// ============================================================================
// 1. JUGADORES (PLAYERS)
// ============================================================================

/**
 * Consultar información completa de un jugador por su Tag.
 * Devuelve aldea principal, base del constructor, tropas, hechizos, héroes,
 * equipamiento de héroes, clan actual, logros y URLs de imágenes para el frontend.
 */
export const getPlayer = async (req, res, next) => {
  try {
    const { tag } = req.params;
    if (!tag) {
      return res.status(400).json({ error: 'El tag del jugador es requerido' });
    }

    const encodedTag = encodeTag(tag);
    const response = await supercellApi.get(`/players/${encodedTag}`);
    
    const enrichedData = enrichPlayerWithAssets(response.data);

    // Si el usuario tiene sesión iniciada, verificar si esta aldea es suya o está en sus favoritos
    let isClaimedByMe = false;
    let isFavorite = false;
    let villageTracker = null;

    if (req.user && req.supabase) {
      const decodedTag = decodeURIComponent(tag).trim().toUpperCase();
      const normalizedTag = decodedTag.startsWith('#') ? decodedTag : `#${decodedTag}`;

      const [claimedRes, favRes] = await Promise.all([
        req.supabase
          .from('claimed_players')
          .select('id, verified_at, last_imported_at, village_data')
          .eq('user_id', req.user.id)
          .eq('player_tag', normalizedTag)
          .maybeSingle(),
        req.supabase
          .from('favorites')
          .select('id')
          .eq('user_id', req.user.id)
          .eq('type', 'player')
          .eq('target_tag', normalizedTag)
          .maybeSingle()
      ]);

      if (claimedRes?.data) {
        isClaimedByMe = true;
        villageTracker = claimedRes.data.village_data || null;
      }
      if (favRes?.data) {
        isFavorite = true;
      }
    }

    res.status(200).json({
      ...enrichedData,
      is_claimed_by_me: isClaimedByMe,
      is_favorite: isFavorite,
      ...(villageTracker ? { village_tracker: villageTracker } : {})
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================================
// 2. CLANES (CLANS)
// ============================================================================

/**
 * Buscar clanes con filtros de búsqueda.
 * Query params soportados: name (mínimo 3 caracteres), warFrequency, locationId,
 * minMembers, maxMembers, minClanPoints, minClanLevel, limit, after, before, labelIds.
 */
export const searchClans = async (req, res, next) => {
  try {
    const { name } = req.query;
    if (name && name.trim().length < 3) {
      return res.status(400).json({
        error: 'El nombre del clan para la búsqueda debe tener al menos 3 caracteres'
      });
    }

    const response = await supercellApi.get('/clans', { params: req.query });
    const items = Array.isArray(response.data?.items)
      ? response.data.items.map((c) => enrichClanWithAssets(c))
      : [];
    res.status(200).json({
      ...response.data,
      items
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Consultar información completa y unificada de un clan por su Tag.
 * Agrupa perfil, miembros con resumen de roles, guerra actual, registro de guerras,
 * asaltos de capital, CWL y si es favorito del usuario actual.
 */
export const getClan = async (req, res, next) => {
  try {
    const { tag } = req.params;
    if (!tag) {
      return res.status(400).json({ error: 'El tag del clan es requerido' });
    }

    // Si se pasa ?raw=true devuelve solo el objeto básico enriquecido con assets
    if (req.query.raw === 'true') {
      const encodedTag = encodeTag(tag);
      const response = await supercellApi.get(`/clans/${encodedTag}`);
      return res.status(200).json(enrichClanWithAssets(response.data));
    }

    // Dashboard completo y unificado con tolerancia a fallos y verificación de favorito
    const fullClan = await getFullClanDetails(tag, req.supabase, req.user?.id);
    res.status(200).json(fullClan);
  } catch (error) {
    next(error);
  }
};

/**
 * Alternar clan en los favoritos del usuario autenticado (Toggle rápido).
 * Agrega si no está en favoritos, elimina si ya existe.
 * POST /api/coc/clan/:tag/favorite
 */
export const toggleClanFavorite = async (req, res, next) => {
  try {
    const { tag } = req.params;
    if (!tag) {
      return res.status(400).json({ error: 'El tag del clan es requerido' });
    }

    const cleanTag = normalizeTag(tag);
    const encodedTag = encodeTag(cleanTag);
    const { target_name, metadata, action } = req.body || {};

    // 1. Comprobar si ya existe en favoritos de este usuario
    const { data: existing, error: findErr } = await req.supabase
      .from('favorites')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('type', 'clan')
      .eq('target_tag', cleanTag)
      .maybeSingle();

    if (findErr) throw findErr;

    if (existing || action === 'remove') {
      if (existing) {
        const { error: delErr } = await req.supabase
          .from('favorites')
          .delete()
          .eq('id', existing.id)
          .eq('user_id', req.user.id);

        if (delErr) throw delErr;
      }

      return res.status(200).json({
        message: 'Clan eliminado de favoritos',
        is_favorite: false,
        isFavorite: false,
        target_tag: cleanTag
      });
    }

    let finalName = target_name?.trim() || null;
    let finalMetadata = metadata && typeof metadata === 'object' ? { ...metadata } : {};

    // 2. Obtener datos oficiales del clan para metadata en favoritos si no vinieron completos
    if (!finalName || Object.keys(finalMetadata).length === 0) {
      try {
        const clanResponse = await supercellApi.get(`/clans/${encodedTag}`);
        const clanData = clanResponse.data;
        const warLeagueName = clanData.warLeague?.name || null;
        const capitalLeagueName = clanData.capitalLeague?.name || null;
        const countryCode = clanData.location?.countryCode || null;
        const membersCount = Array.isArray(clanData.memberList)
          ? clanData.memberList.length
          : (clanData.members ?? 0);

        finalName = finalName || clanData.name;
        finalMetadata = {
          clan_level: clanData.clanLevel || 1,
          members: membersCount,
          clan_points: clanData.clanPoints ?? 0,
          clan_builder_base_points: clanData.clanBuilderBasePoints ?? 0,
          clan_capital_points: clanData.clanCapitalPoints ?? 0,
          badge_url:
            clanData.badgeUrls?.medium ||
            clanData.badgeUrls?.large ||
            clanData.badgeUrls?.small ||
            null,
          war_league: warLeagueName,
          war_league_image_url: getWarLeagueImageUrl(warLeagueName),
          capital_league: capitalLeagueName,
          capital_league_image_url: getCapitalLeagueImageUrl(capitalLeagueName),
          location_name: clanData.location?.name || null,
          country_code: countryCode,
          flag_url: countryCode ? getCountryFlagUrl(countryCode) : null,
          ...finalMetadata
        };
      } catch (cocErr) {
        if (!finalName) {
          throw cocErr;
        }
      }
    }

    // 3. Insertar nuevo favorito
    const { data: newFav, error } = await req.supabase
      .from('favorites')
      .insert({
        user_id: req.user.id,
        type: 'clan',
        target_tag: cleanTag,
        target_name: finalName,
        metadata: finalMetadata
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Clan agregado a favoritos exitosamente',
      is_favorite: true,
      isFavorite: true,
      favorite: newFav
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Consultar la lista de miembros de un clan por su Tag.
 */
export const getClanMembers = async (req, res, next) => {
  try {
    const { tag } = req.params;
    if (!tag) {
      return res.status(400).json({ error: 'El tag del clan es requerido' });
    }

    const encodedTag = encodeTag(tag);
    const response = await supercellApi.get(`/clans/${encodedTag}/members`, {
      params: req.query
    });
    
    res.status(200).json(response.data);
  } catch (error) {
    next(error);
  }
};

/**
 * Consultar el historial de guerras pasadas de un clan (War Log).
 * Requiere que el clan tenga su registro de guerras público en el juego.
 */
export const getClanWarLog = async (req, res, next) => {
  try {
    const { tag } = req.params;
    if (!tag) {
      return res.status(400).json({ error: 'El tag del clan es requerido' });
    }

    const encodedTag = encodeTag(tag);
    const response = await supercellApi.get(`/clans/${encodedTag}/warlog`, {
      params: req.query
    });
    
    res.status(200).json(response.data);
  } catch (error) {
    next(error);
  }
};

/**
 * Consultar información de la guerra actual del clan (Current War).
 */
export const getClanCurrentWar = async (req, res, next) => {
  try {
    const { tag } = req.params;
    if (!tag) {
      return res.status(400).json({ error: 'El tag del clan es requerido' });
    }

    const encodedTag = encodeTag(tag);
    const response = await supercellApi.get(`/clans/${encodedTag}/currentwar`);
    
    res.status(200).json(response.data);
  } catch (error) {
    next(error);
  }
};

/**
 * Consultar información del grupo de Liga de Guerras de Clanes (CWL).
 */
export const getClanWarLeagueGroup = async (req, res, next) => {
  try {
    const { tag } = req.params;
    if (!tag) {
      return res.status(400).json({ error: 'El tag del clan es requerido' });
    }

    const encodedTag = encodeTag(tag);
    const response = await supercellApi.get(`/clans/${encodedTag}/currentwar/leaguegroup`);
    
    res.status(200).json(response.data);
  } catch (error) {
    next(error);
  }
};

/**
 * Consultar temporadas de asaltos de la Capital del Clan (Clan Capital Raid Seasons).
 */
export const getClanCapitalRaidSeasons = async (req, res, next) => {
  try {
    const { tag } = req.params;
    if (!tag) {
      return res.status(400).json({ error: 'El tag del clan es requerido' });
    }

    const encodedTag = encodeTag(tag);
    const response = await supercellApi.get(`/clans/${encodedTag}/capitalraidseasons`, {
      params: req.query
    });
    
    res.status(200).json(response.data);
  } catch (error) {
    next(error);
  }
};

// ============================================================================
// 3. RANKINGS Y UBICACIONES (LEADERBOARDS & LOCATIONS)
// ============================================================================

/**
 * Listar ubicaciones / países disponibles (enriquecidos con flagUrl).
 */
export const getLocations = async (req, res, next) => {
  try {
    const response = await supercellApi.get('/locations', { params: req.query });
    const items = Array.isArray(response.data?.items)
      ? response.data.items.map((loc) => ({
          ...loc,
          flagUrl: loc.isCountry && loc.countryCode ? getCountryFlagUrl(loc.countryCode) : null
        }))
      : [];
    res.status(200).json({
      ...response.data,
      items
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtener detalles de una ubicación específica.
 */
export const getLocationById = async (req, res, next) => {
  try {
    const { locationId } = req.params;
    const response = await supercellApi.get(`/locations/${locationId}`);
    res.status(200).json(response.data);
  } catch (error) {
    next(error);
  }
};

/**
 * Ranking de mejores clanes por copas (global o por ID de país), enriquecido con bandera y liga.
 */
export const getClanRankings = async (req, res, next) => {
  try {
    const locationId = req.params.locationId || 'global';
    const response = await supercellApi.get(`/locations/${locationId}/rankings/clans`, {
      params: req.query
    });
    const items = Array.isArray(response.data?.items)
      ? response.data.items.map((item) => enrichClanWithAssets(item))
      : [];
    res.status(200).json({
      ...response.data,
      items
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Ranking de mejores jugadores por copas (global o por ID de país), enriquecido con imagen de liga.
 */
export const getPlayerRankings = async (req, res, next) => {
  try {
    const locationId = req.params.locationId || 'global';
    const response = await supercellApi.get(`/locations/${locationId}/rankings/players`, {
      params: req.query
    });
    const items = Array.isArray(response.data?.items)
      ? response.data.items.map((item) => {
          const { leagueName, leagueImageUrl } = resolvePlayerLeagueInfo(item);
          return {
            ...item,
            leagueName,
            leagueImageUrl
          };
        })
      : [];
    res.status(200).json({
      ...response.data,
      items
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Ranking de mejores clanes en la Base del Constructor, enriquecido con bandera.
 */
export const getClanBuilderBaseRankings = async (req, res, next) => {
  try {
    const locationId = req.params.locationId || 'global';
    const response = await supercellApi.get(`/locations/${locationId}/rankings/clans-builder-base`, {
      params: req.query
    });
    const items = Array.isArray(response.data?.items)
      ? response.data.items.map((item) => enrichClanWithAssets(item))
      : [];
    res.status(200).json({
      ...response.data,
      items
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Ranking de mejores jugadores en la Base del Constructor, enriquecido con imagen de liga.
 */
export const getPlayerBuilderBaseRankings = async (req, res, next) => {
  try {
    const locationId = req.params.locationId || 'global';
    const response = await supercellApi.get(`/locations/${locationId}/rankings/players-builder-base`, {
      params: req.query
    });
    const items = Array.isArray(response.data?.items)
      ? response.data.items.map((item) => {
          const bbLeagueName = item.builderBaseLeague?.name || null;
          const bbLeagueImg = getBuilderBaseLeagueImageUrl(bbLeagueName);
          return {
            ...item,
            leagueName: bbLeagueName,
            leagueImageUrl: bbLeagueImg,
            builderBaseLeagueImageUrl: bbLeagueImg,
            ...(item.builderBaseLeague
              ? {
                  builderBaseLeague: {
                    ...item.builderBaseLeague,
                    imageUrl: bbLeagueImg
                  }
                }
              : {})
          };
        })
      : [];
    res.status(200).json({
      ...response.data,
      items
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Ranking de mejores Capitales de Clan (por puntos de capital), enriquecido con bandera.
 */
export const getCapitalRankings = async (req, res, next) => {
  try {
    const locationId = req.params.locationId || 'global';
    const response = await supercellApi.get(`/locations/${locationId}/rankings/capitals`, {
      params: req.query
    });
    const items = Array.isArray(response.data?.items)
      ? response.data.items.map((item) => enrichClanWithAssets(item))
      : [];
    res.status(200).json({
      ...response.data,
      items
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================================
// 4. LIGAS (LEAGUES)
// ============================================================================

/**
 * Listar todas las ligas normales (Bronce, Plata, Oro, Cristal, Maestro, Campeón, Titán, Leyenda).
 */
export const getLeagues = async (req, res, next) => {
  try {
    const response = await supercellApi.get('/leagues', { params: req.query });
    res.status(200).json(response.data);
  } catch (error) {
    next(error);
  }
};

/**
 * Obtener detalle de una liga específica.
 */
export const getLeagueById = async (req, res, next) => {
  try {
    const { leagueId } = req.params;
    const response = await supercellApi.get(`/leagues/${leagueId}`);
    res.status(200).json(response.data);
  } catch (error) {
    next(error);
  }
};

/**
 * Listar temporadas pasadas de la liga (especialmente útil para Liga de Leyendas, ej: leagueId=29000022).
 */
export const getLeagueSeasons = async (req, res, next) => {
  try {
    const { leagueId } = req.params;
    const response = await supercellApi.get(`/leagues/${leagueId}/seasons`, {
      params: req.query
    });
    res.status(200).json(response.data);
  } catch (error) {
    next(error);
  }
};

/**
 * Ranking histórico de jugadores de una temporada específica de la liga.
 */
export const getLeagueSeasonRankings = async (req, res, next) => {
  try {
    const { leagueId, seasonId } = req.params;
    const response = await supercellApi.get(`/leagues/${leagueId}/seasons/${seasonId}`, {
      params: req.query
    });
    res.status(200).json(response.data);
  } catch (error) {
    next(error);
  }
};

/**
 * Listar ligas de Guerra de Clanes (Clan War Leagues - CWL) enriquecidas con imageUrl.
 */
export const getWarLeagues = async (req, res, next) => {
  try {
    const response = await supercellApi.get('/warleagues', { params: req.query });
    const items = Array.isArray(response.data?.items)
      ? response.data.items.map((item) => ({
          ...item,
          imageUrl: getWarLeagueImageUrl(item.name)
        }))
      : [];
    res.status(200).json({
      ...response.data,
      items
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Detalle de una liga de Guerra de Clanes (CWL) enriquecida con imageUrl.
 */
export const getWarLeagueById = async (req, res, next) => {
  try {
    const { leagueId } = req.params;
    const response = await supercellApi.get(`/warleagues/${leagueId}`);
    res.status(200).json({
      ...response.data,
      imageUrl: getWarLeagueImageUrl(response.data?.name)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Listar ligas de la Base del Constructor (enriquecidas con imageUrl).
 */
export const getBuilderBaseLeagues = async (req, res, next) => {
  try {
    const response = await supercellApi.get('/builderbaseleagues', { params: req.query });
    const items = Array.isArray(response.data?.items)
      ? response.data.items.map((item) => ({
          ...item,
          imageUrl: getBuilderBaseLeagueImageUrl(item.name)
        }))
      : [];
    res.status(200).json({
      ...response.data,
      items
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Detalle de una liga de la Base del Constructor.
 */
export const getBuilderBaseLeagueById = async (req, res, next) => {
  try {
    const { leagueId } = req.params;
    const response = await supercellApi.get(`/builderbaseleagues/${leagueId}`);
    res.status(200).json({
      ...response.data,
      imageUrl: getBuilderBaseLeagueImageUrl(response.data?.name)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Listar ligas de la Capital del Clan enriquecidas con imageUrl.
 */
export const getCapitalLeagues = async (req, res, next) => {
  try {
    const response = await supercellApi.get('/capitalleagues', { params: req.query });
    const items = Array.isArray(response.data?.items)
      ? response.data.items.map((item) => ({
          ...item,
          imageUrl: getCapitalLeagueImageUrl(item.name)
        }))
      : [];
    res.status(200).json({
      ...response.data,
      items
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Detalle de una liga de la Capital del Clan enriquecida con imageUrl.
 */
export const getCapitalLeagueById = async (req, res, next) => {
  try {
    const { leagueId } = req.params;
    const response = await supercellApi.get(`/capitalleagues/${leagueId}`);
    res.status(200).json({
      ...response.data,
      imageUrl: getCapitalLeagueImageUrl(response.data?.name)
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================================
// 5. ETIQUETAS (LABELS)
// ============================================================================

/**
 * Listar etiquetas oficiales de clanes.
 */
export const getClanLabels = async (req, res, next) => {
  try {
    const response = await supercellApi.get('/labels/clans', { params: req.query });
    res.status(200).json(response.data);
  } catch (error) {
    next(error);
  }
};

/**
 * Listar etiquetas oficiales de jugadores.
 */
export const getPlayerLabels = async (req, res, next) => {
  try {
    const response = await supercellApi.get('/labels/players', { params: req.query });
    res.status(200).json(response.data);
  } catch (error) {
    next(error);
  }
};

// ============================================================================
// 6. PASE DE ORO (GOLD PASS)
// ============================================================================

/**
 * Consultar temporada actual del Pase de Oro (fechas de inicio y fin).
 */
export const getCurrentGoldPassSeason = async (req, res, next) => {
  try {
    const response = await supercellApi.get('/goldpass/seasons/current');
    res.status(200).json(response.data);
  } catch (error) {
    next(error);
  }
};

// ============================================================================
// 7. DIAGNÓSTICO DE CONECTIVIDAD SUPERCELL
// ============================================================================

/**
 * Reporta el estado de conexión hacia Supercell/RoyaleAPI Proxy sin exponer claves.
 * En producción solo expone la IP pública saliente e información interna a administradores.
 */
export const getApiStatus = async (req, res, next) => {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    const role = req.user ? await getUserRole(req) : 'user';
    const allowDiagnostics = !isProd || role === 'admin';

    const status = await getSupercellApiStatus({ probeIp: allowDiagnostics });

    if (!allowDiagnostics) {
      return res.status(200).json({
        status: 'ok',
        configured: status.configured,
        activeMode: status.activeMode,
        cacheEntries: status.cacheEntries,
        hasRecentError: Boolean(status.lastErrorStatus),
        lastSuccessAt: status.lastSuccessAt
      });
    }

    res.status(200).json({
      status: 'ok',
      ...status,
      recommendation: status.primaryBaseUrl?.includes('royaleapi.dev')
        ? `Usando proxy RoyaleAPI. Asegurate de tener autorizada la IP ${ROYALE_API_PROXY_IP} en developer.clashofclans.com.`
        : `Si falla con 403 invalidIp en Render o red doméstica, configurá COC_API_BASE_URL=https://cocproxy.royaleapi.dev/v1 y autorizá ${ROYALE_API_PROXY_IP} (IP local actual: ${status.outboundIp || 'desconocida'}).`
    });
  } catch (error) {
    next(error);
  }
};
