import { supercellApi } from '../services/supercell.service.js';
import { encodeTag } from '../utils/tag.util.js';
import {
  enrichPlayerWithAssets,
  getCapitalLeagueImageUrl,
  getCountryFlagUrl,
  getTownHallImageUrl,
  getWarLeagueImageUrl,
  resolvePlayerLeagueInfo
} from '../utils/assets.util.js';

/**
 * Normaliza un tag de Clash of Clans para que siempre inicie con '#'
 */
const normalizeTag = (tag) => {
  if (!tag) return '';
  const decoded = decodeURIComponent(tag).trim().toUpperCase().replace(/\s+/g, '');
  return decoded.startsWith('#') ? decoded : `#${decoded}`;
};

/**
 * Asegura que la metadata de un registro de favorito tenga todas las URLs de assets resueltas.
 */
const enrichFavoriteRow = (row) => {
  if (!row) return row;
  const meta = { ...(row.metadata || {}) };

  if (row.type === 'player') {
    const th = Number(meta.town_hall || meta.townHallLevel || 1);
    meta.town_hall = th;
    meta.town_hall_image_url =
      meta.town_hall_image_url || meta.townHallImageUrl || getTownHallImageUrl(th);
  } else if (row.type === 'clan') {
    const warLeague = meta.war_league || meta.warLeagueName || null;
    const capitalLeague = meta.capital_league || meta.capitalLeagueName || null;
    const countryCode = meta.country_code || meta.countryCode || null;

    if (warLeague && !meta.war_league_image_url) {
      meta.war_league_image_url = getWarLeagueImageUrl(warLeague);
    }
    if (capitalLeague && !meta.capital_league_image_url) {
      meta.capital_league_image_url = getCapitalLeagueImageUrl(capitalLeague);
    }
    if (countryCode && !meta.flag_url) {
      meta.flag_url = getCountryFlagUrl(countryCode);
    }
  }

  return {
    ...row,
    metadata: meta
  };
};

/**
 * Consulta la API oficial de Supercell para autocompletar el nombre y metadata del jugador o clan.
 */
const fetchCocData = async (type, cleanTag) => {
  const encoded = encodeTag(cleanTag);
  if (type === 'player') {
    const res = await supercellApi.get(`/players/${encoded}`);
    const { leagueName, leagueImageUrl } = resolvePlayerLeagueInfo(res.data);
    return {
      target_name: res.data.name,
      metadata: {
        town_hall: res.data.townHallLevel || 1,
        town_hall_image_url: getTownHallImageUrl(res.data.townHallLevel || 1),
        trophies: res.data.trophies ?? 0,
        best_trophies: res.data.bestTrophies ?? 0,
        exp_level: res.data.expLevel ?? 1,
        clan_name: res.data.clan?.name || null,
        clan_tag: res.data.clan?.tag || null,
        league: leagueName,
        league_image_url: leagueImageUrl,
        badge_url:
          res.data.clan?.badgeUrls?.small ||
          res.data.clan?.badgeUrls?.medium ||
          res.data.clan?.badgeUrls?.large ||
          null
      }
    };
  } else if (type === 'clan') {
    const res = await supercellApi.get(`/clans/${encoded}`);
    const warLeagueName = res.data.warLeague?.name || null;
    const capitalLeagueName = res.data.capitalLeague?.name || null;
    const countryCode = res.data.location?.countryCode || null;
    const membersCount = Array.isArray(res.data.memberList)
      ? res.data.memberList.length
      : (res.data.members ?? 0);

    return {
      target_name: res.data.name,
      metadata: {
        clan_level: res.data.clanLevel || 1,
        members: membersCount,
        clan_points: res.data.clanPoints ?? 0,
        clan_builder_base_points: res.data.clanBuilderBasePoints ?? 0,
        clan_capital_points: res.data.clanCapitalPoints ?? 0,
        war_league: warLeagueName,
        war_league_image_url: getWarLeagueImageUrl(warLeagueName),
        capital_league: capitalLeagueName,
        capital_league_image_url: getCapitalLeagueImageUrl(capitalLeagueName),
        location_name: res.data.location?.name || null,
        country_code: countryCode,
        flag_url: countryCode ? getCountryFlagUrl(countryCode) : null,
        badge_url:
          res.data.badgeUrls?.medium ||
          res.data.badgeUrls?.large ||
          res.data.badgeUrls?.small ||
          null
      }
    };
  }
  return null;
};

/**
 * Listar favoritos del usuario autenticado
 * Soporta filtro opcional por query: ?type=player o ?type=clan
 */
export const listFavorites = async (req, res, next) => {
  try {
    const { type } = req.query;

    let query = req.supabase
      .from('favorites')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (type) {
      if (!['clan', 'player'].includes(type)) {
        return res.status(400).json({ error: 'El tipo debe ser "clan" o "player"' });
      }
      query = query.eq('type', type);
    }

    const { data, error } = await query;
    if (error) throw error;

    const favorites = (data || []).map(enrichFavoriteRow);

    res.status(200).json({
      count: favorites.length,
      favorites
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Agregar un clan o jugador a los favoritos del usuario.
 * Si no se envía target_name, consulta automáticamente a la API de Supercell para autocompletarlo.
 */
export const addFavorite = async (req, res, next) => {
  try {
    const { type, target_tag, target_name, metadata } = req.body;

    if (!type || !target_tag) {
      return res.status(400).json({
        error: 'Los campos "type" y "target_tag" son obligatorios'
      });
    }

    if (!['clan', 'player'].includes(type)) {
      return res.status(400).json({
        error: 'El tipo debe ser "clan" o "player"'
      });
    }

    const cleanTag = normalizeTag(target_tag);
    let finalName = target_name?.trim();
    let finalMetadata = metadata || {};

    // Si no se proporcionó el nombre, autocompletarlo desde la API de Supercell
    if (!finalName) {
      const cocData = await fetchCocData(type, cleanTag);
      if (cocData) {
        finalName = cocData.target_name;
        finalMetadata = { ...cocData.metadata, ...finalMetadata };
      }
    }

    if (!finalName) {
      return res.status(400).json({
        error: `No se pudo obtener el nombre del ${type}. Verifica que el tag sea correcto.`
      });
    }

    const { data, error } = await req.supabase
      .from('favorites')
      .insert({
        user_id: req.user.id,
        type,
        target_tag: cleanTag,
        target_name: finalName,
        metadata: finalMetadata
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          error: `Este ${type === 'clan' ? 'clan' : 'jugador'} ya se encuentra en tus favoritos.`
        });
      }
      throw error;
    }

    res.status(201).json({
      message: 'Favorito agregado exitosamente',
      favorite: enrichFavoriteRow(data)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Alternar favorito (Toggle): Si ya está en favoritos lo elimina; si no, lo agrega automáticamente.
 * Ideal para el botón de estrella en el frontend.
 */
export const toggleFavorite = async (req, res, next) => {
  try {
    const { type, target_tag, target_name, metadata, action } = req.body;

    if (!type || !target_tag) {
      return res.status(400).json({ error: 'Campos "type" y "target_tag" son requeridos' });
    }

    if (!['clan', 'player'].includes(type)) {
      return res.status(400).json({ error: 'El tipo debe ser "clan" o "player"' });
    }

    const cleanTag = normalizeTag(target_tag);

    // Verificar si ya existe para este usuario
    const { data: existing, error: findErr } = await req.supabase
      .from('favorites')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('type', type)
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
        message: 'Eliminado de favoritos',
        isFavorite: false,
        is_favorite: false,
        target_tag: cleanTag
      });
    }

    let finalName = target_name?.trim() || null;
    let finalMetadata = metadata && typeof metadata === 'object' ? { ...metadata } : {};

    // Si no se envió nombre o metadata completa, enriquecer desde la API de Supercell
    if (!finalName || Object.keys(finalMetadata).length === 0) {
      try {
        const cocData = await fetchCocData(type, cleanTag);
        if (cocData) {
          finalName = finalName || cocData.target_name;
          finalMetadata = { ...cocData.metadata, ...finalMetadata };
        }
      } catch (cocErr) {
        if (!finalName) {
          throw cocErr;
        }
      }
    }

    if (!finalName) {
      return res.status(404).json({ error: 'No se encontró el objetivo en Clash of Clans' });
    }

    const { data: newFav, error } = await req.supabase
      .from('favorites')
      .insert({
        user_id: req.user.id,
        type,
        target_tag: cleanTag,
        target_name: finalName,
        metadata: finalMetadata
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Agregado a favoritos exitosamente',
      isFavorite: true,
      is_favorite: true,
      favorite: enrichFavoriteRow(newFav)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Eliminar un favorito por su tipo ('player' | 'clan') y tag ('#...')
 * DELETE /api/favorites/target?type=player&target_tag=%23Y8J8RPVJU
 */
export const removeFavoriteByTarget = async (req, res, next) => {
  try {
    const type = req.query.type || req.body?.type;
    const rawTag = req.query.target_tag || req.body?.target_tag;

    if (!type || !rawTag) {
      return res.status(400).json({
        error: 'Los parámetros "type" y "target_tag" son requeridos'
      });
    }

    if (!['clan', 'player'].includes(type)) {
      return res.status(400).json({ error: 'El tipo debe ser "clan" o "player"' });
    }

    const cleanTag = normalizeTag(rawTag);

    const { data, error } = await req.supabase
      .from('favorites')
      .delete()
      .eq('user_id', req.user.id)
      .eq('type', type)
      .eq('target_tag', cleanTag)
      .select();

    if (error) throw error;

    res.status(200).json({
      message: 'Favorito eliminado exitosamente',
      isFavorite: false,
      is_favorite: false,
      target_tag: cleanTag,
      deleted: data?.[0] || null
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Consulta en tiempo real (LIVE) los datos de Clash of Clans para un favorito guardado.
 */
export const getFavoriteLive = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data: fav, error } = await req.supabase
      .from('favorites')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (error || !fav) {
      return res.status(404).json({ error: 'Favorito no encontrado' });
    }

    const encoded = encodeTag(fav.target_tag);
    const endpoint = fav.type === 'player' ? `/players/${encoded}` : `/clans/${encoded}`;
    const liveResponse = await supercellApi.get(endpoint);

    const liveData = fav.type === 'player'
      ? enrichPlayerWithAssets(liveResponse.data)
      : liveResponse.data;

    res.status(200).json({
      favorite: enrichFavoriteRow(fav),
      live_data: liveData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Eliminar un favorito por su ID (UUID)
 */
export const removeFavorite = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data, error } = await req.supabase
      .from('favorites')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({
        error: 'Favorito no encontrado o no tienes permiso para eliminarlo'
      });
    }

    res.status(200).json({
      message: 'Favorito eliminado exitosamente',
      deleted: data[0]
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Comprobar si un clan o jugador ya está en los favoritos del usuario
 */
export const checkFavorite = async (req, res, next) => {
  try {
    const { type, target_tag } = req.query;

    if (!type || !target_tag) {
      return res.status(400).json({ error: 'Parámetros "type" y "target_tag" son requeridos' });
    }

    const cleanTag = normalizeTag(target_tag);

    const { data, error } = await req.supabase
      .from('favorites')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('type', type)
      .eq('target_tag', cleanTag)
      .maybeSingle();

    if (error) throw error;

    res.status(200).json({
      isFavorite: !!data,
      is_favorite: !!data,
      favorite: data ? enrichFavoriteRow(data) : null
    });
  } catch (error) {
    next(error);
  }
};
