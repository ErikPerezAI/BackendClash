import { supercellApi } from '../services/supercell.service.js';
import { encodeTag } from '../utils/tag.util.js';
import {
  getTownHallImageUrl,
  resolvePlayerLeagueInfo
} from '../utils/assets.util.js';
import {
  verifyTokenWithSupercell,
  parseVillageExport
} from '../services/villageTracker.service.js';
import { createAndSendNotification } from '../services/notification.service.js';

/**
 * Normaliza un tag de Clash of Clans para que siempre inicie con '#'
 */
const normalizeTag = (tag) => {
  if (!tag) return '';
  const decoded = decodeURIComponent(tag).trim().toUpperCase().replace(/\s+/g, '');
  return decoded.startsWith('#') ? decoded : `#${decoded}`;
};

/**
 * Enriquece un registro de claimed_players con URLs de imágenes
 */
const enrichClaimedPlayerRow = (row) => {
  if (!row) return row;
  const thLevel = Number(row.town_hall_level || row.village_data?.townHallLevel || row.metadata?.town_hall || 1);
  const meta = { ...(row.metadata || {}) };
  meta.town_hall = thLevel;
  meta.town_hall_image_url = meta.town_hall_image_url || getTownHallImageUrl(thLevel);
  return {
    ...row,
    town_hall_level: thLevel,
    town_hall_image_url: meta.town_hall_image_url,
    metadata: meta
  };
};

/**
 * Claimea un jugador verificando su API Token oficial de Clash of Clans
 * POST /api/coc/player/:tag/claim
 */
export const claimPlayer = async (req, res, next) => {
  try {
    const { tag } = req.params;
    const { token } = req.body;

    if (!tag) {
      return res.status(400).json({ error: 'El tag del jugador es obligatorio' });
    }

    if (!token || !token.trim()) {
      return res.status(400).json({
        error: 'El token de API es obligatorio. Puedes obtenerlo en Clash of Clans: Ajustes > Más ajustes > Token de API'
      });
    }

    const cleanTag = normalizeTag(tag);
    const encodedTag = encodeTag(cleanTag);

    // 1. Verificar titularidad contra la API de Supercell
    const verification = await verifyTokenWithSupercell(cleanTag, token.trim());

    if (!verification.valid) {
      return res.status(400).json({
        error: 'Token de verificación inválido. Por favor genera un token nuevo dentro del juego (Ajustes > Más ajustes > Token de API).',
        detail: verification.status
      });
    }

    // 2. Obtener datos oficiales del jugador para enriquecer la entrada
    const playerResponse = await supercellApi.get(`/players/${encodedTag}`);
    const playerData = playerResponse.data;
    const { leagueName, leagueImageUrl } = resolvePlayerLeagueInfo(playerData);
    const thLevel = playerData.townHallLevel || 1;

    // 3. Guardar en public.claimed_players (Supabase con RLS)
    const { data: claimed, error } = await req.supabase
      .from('claimed_players')
      .upsert({
        user_id: req.user.id,
        player_tag: cleanTag,
        player_name: playerData.name,
        town_hall_level: thLevel,
        metadata: {
          town_hall: thLevel,
          town_hall_image_url: getTownHallImageUrl(thLevel),
          trophies: playerData.trophies ?? 0,
          best_trophies: playerData.bestTrophies ?? 0,
          exp_level: playerData.expLevel ?? 1,
          clan_name: playerData.clan?.name || null,
          clan_tag: playerData.clan?.tag || null,
          badge_url:
            playerData.clan?.badgeUrls?.small ||
            playerData.clan?.badgeUrls?.medium ||
            playerData.clan?.badgeUrls?.large ||
            null,
          league: leagueName,
          league_image_url: leagueImageUrl
        },
        verified_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,player_tag'
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: `¡Aldea de ${playerData.name} (${cleanTag}) claimeada y verificada exitosamente!`,
      claimed_player: enrichClaimedPlayerRow(claimed)
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Desvincular / Desclaimear una aldea del usuario
 * DELETE /api/coc/player/:tag/claim
 */
export const unclaimPlayer = async (req, res, next) => {
  try {
    const { tag } = req.params;
    const cleanTag = normalizeTag(tag);

    const { data, error } = await req.supabase
      .from('claimed_players')
      .delete()
      .eq('user_id', req.user.id)
      .eq('player_tag', cleanTag)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({
        error: `No tienes claimeada ninguna aldea con el tag ${cleanTag}`
      });
    }

    res.status(200).json({
      message: `Aldea ${cleanTag} desvinculada exitosamente`,
      deleted: data[0]
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Listar todas las aldeas claimeadas por el usuario autenticado
 * GET /api/coc/claimed-players
 */
export const listMyClaimedPlayers = async (req, res, next) => {
  try {
    const { data, error } = await req.supabase
      .from('claimed_players')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const enriched = (data || []).map(enrichClaimedPlayerRow);

    res.status(200).json({
      count: enriched.length,
      claimed_players: enriched
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Importar JSON de exportación del juego para trackear estructuras y tiempos
 * POST /api/coc/player/:tag/village-data
 */
export const importVillageData = async (req, res, next) => {
  try {
    const { tag } = req.params;
    const rawInput = req.body.villageData || req.body.village_data || req.body;

    if (!rawInput || (typeof rawInput === 'object' && Object.keys(rawInput).length === 0)) {
      return res.status(400).json({
        error: 'Se requiere el JSON de exportación de la aldea en el cuerpo de la petición'
      });
    }

    const cleanTag = normalizeTag(tag);

    // 1. Validar que la aldea esté claimeada por este usuario
    const { data: claimed, error: findError } = await req.supabase
      .from('claimed_players')
      .select('id, player_tag, player_name, metadata')
      .eq('user_id', req.user.id)
      .eq('player_tag', cleanTag)
      .maybeSingle();

    if (findError) throw findError;

    if (!claimed) {
      return res.status(403).json({
        error: `Debes claimear la aldea ${cleanTag} con tu API Token antes de importar sus datos de tracker.`
      });
    }

    // 2. Parsear y enriquecer los datos de la aldea
    const parsedTracker = parseVillageExport(rawInput);
    const updatedTh = parsedTracker.townHallLevel || undefined;
    const updatedMeta = {
      ...(claimed.metadata || {}),
      ...(updatedTh
        ? {
            town_hall: updatedTh,
            town_hall_image_url: getTownHallImageUrl(updatedTh)
          }
        : {})
    };

    // 3. Guardar en Supabase
    const { data: updated, error: updateError } = await req.supabase
      .from('claimed_players')
      .update({
        village_data: parsedTracker,
        raw_export: typeof rawInput === 'object' ? rawInput : null,
        town_hall_level: updatedTh,
        metadata: updatedMeta,
        last_imported_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', claimed.id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (updateError) throw updateError;

    // 4. Registrar snapshot histórico en village_snapshots (para gráficas temporales RF-07)
    let snapshotRecord = null;
    try {
      const { data: snapshotData, error: snapErr } = await req.supabase
        .from('village_snapshots')
        .insert({
          claimed_player_id: claimed.id,
          user_id: req.user.id,
          player_tag: cleanTag,
          town_hall_level: parsedTracker.townHallLevel || 1,
          total_structures: parsedTracker.totalStructures || 0,
          maxed_structures: parsedTracker.maxedStructures || 0,
          completion_percentage: parsedTracker.completionPercentage || 0,
          active_upgrades_count: parsedTracker.activeUpgradesCount || 0,
          summary_data: {
            progress: parsedTracker.progress || {},
            builders: parsedTracker.builders || {},
            walls: {
              total: parsedTracker.walls?.total || 0,
              maxed: parsedTracker.walls?.maxedCount || 0
            },
            categories: Object.keys(parsedTracker.categories || {}).reduce((acc, cat) => {
              acc[cat] = parsedTracker.categories[cat].length;
              return acc;
            }, {})
          }
        })
        .select()
        .single();

      if (!snapErr) {
        snapshotRecord = snapshotData;
      } else {
        console.warn('[VillageTracker] No se pudo guardar snapshot histórico:', snapErr.message);
      }
    } catch (snapEx) {
      console.warn('[VillageTracker] Excepción al registrar snapshot:', snapEx.message);
    }

    // 5. Generar notificación de confirmación con resumen de mejoras activas
    const overallPct = Number(
      parsedTracker.progress?.overall_percentage ?? parsedTracker.completionPercentage ?? 0
    ).toFixed(1);
    const activeCount = Number(parsedTracker.activeUpgradesCount || 0);

    createAndSendNotification({
      userId: req.user.id,
      title: `🏰 Aldea sincronizada: ${claimed.player_name} (TH${parsedTracker.townHallLevel || 1})`,
      body: `Progreso general al ${overallPct}% • ${activeCount} mejora${activeCount === 1 ? '' : 's'} activa${activeCount === 1 ? '' : 's'} monitoreada${activeCount === 1 ? '' : 's'} en segundo plano.`,
      type: 'village_imported',
      data: {
        player_tag: cleanTag,
        overall_percentage: Number(overallPct),
        active_upgrades: activeCount
      }
    }).catch(() => {});

    res.status(200).json({
      message: 'Datos de estructuras y mejoras importados exitosamente',
      player_tag: cleanTag,
      player_name: claimed.player_name,
      tracker: parsedTracker,
      claimed_record: enrichClaimedPlayerRow(updated),
      snapshot: snapshotRecord
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtener los datos del tracker de una aldea claimeada
 * GET /api/coc/player/:tag/tracker
 */
export const getClaimedPlayerTracker = async (req, res, next) => {
  try {
    const { tag } = req.params;
    const cleanTag = normalizeTag(tag);

    const { data: claimed, error } = await req.supabase
      .from('claimed_players')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('player_tag', cleanTag)
      .maybeSingle();

    if (error) throw error;

    if (!claimed) {
      return res.status(404).json({
        error: `No se encontró una aldea claimeada con el tag ${cleanTag} en tu cuenta`
      });
    }

    const enriched = enrichClaimedPlayerRow(claimed);

    res.status(200).json({
      player_tag: enriched.player_tag,
      player_name: enriched.player_name,
      town_hall_level: enriched.town_hall_level,
      town_hall_image_url: enriched.town_hall_image_url,
      metadata: enriched.metadata,
      verified_at: enriched.verified_at,
      last_imported_at: enriched.last_imported_at,
      village_tracker: enriched.village_data || null
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Consultar el historial temporal de snapshots de una aldea claimeada para gráficas (RF-07)
 * GET /api/coc/player/:tag/history
 */
export const getVillageHistory = async (req, res, next) => {
  try {
    const { tag } = req.params;
    const { limit = 30 } = req.query;
    const cleanTag = normalizeTag(tag);

    // Verificar que la aldea pertenezca al usuario
    const { data: claimed, error: findError } = await req.supabase
      .from('claimed_players')
      .select('id, player_tag, player_name')
      .eq('user_id', req.user.id)
      .eq('player_tag', cleanTag)
      .maybeSingle();

    if (findError) throw findError;

    if (!claimed) {
      return res.status(404).json({
        error: `No tienes una aldea claimeada con el tag ${cleanTag}`
      });
    }

    const { data: history, error: histErr } = await req.supabase
      .from('village_snapshots')
      .select('id, town_hall_level, total_structures, maxed_structures, completion_percentage, active_upgrades_count, summary_data, created_at')
      .eq('user_id', req.user.id)
      .eq('player_tag', cleanTag)
      .order('created_at', { ascending: true })
      .limit(parseInt(limit, 10));

    if (histErr) throw histErr;

    res.status(200).json({
      player_tag: cleanTag,
      player_name: claimed.player_name,
      total_snapshots: history?.length || 0,
      history: history || []
    });
  } catch (error) {
    next(error);
  }
};

export default {
  claimPlayer,
  unclaimPlayer,
  listMyClaimedPlayers,
  importVillageData,
  getClaimedPlayerTracker,
  getVillageHistory
};

