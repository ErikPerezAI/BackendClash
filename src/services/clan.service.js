/**
 * Servicio para consulta agregada y unificada de Clanes de Clash of Clans.
 * Agrupa en una sola petición concurrente:
 * 1. Perfil del clan y miembros.
 * 2. Guerra actual (Current War).
 * 3. Historial de guerras (War Log) con manejo resiliente ante registros privados.
 * 4. Asaltos de la Capital del Clan (Capital Raids).
 * 5. Liga de Guerra de Clanes (CWL).
 * 6. Estado contextual de favorito para el usuario autenticado (is_favorite).
 */

import { supercellApi } from './supercell.service.js';
import { enrichClanWithAssets } from '../utils/assets.util.js';
import { encodeTag } from '../utils/tag.util.js';

/**
 * Normaliza un tag de Clash of Clans para que siempre inicie con '#'
 */
export const normalizeTag = (tag) => {
  if (!tag) return '';
  const decoded = decodeURIComponent(tag).trim().toUpperCase();
  return decoded.startsWith('#') ? decoded : `#${decoded}`;
};

/**
 * Consulta y consolida toda la información de un clan en una única respuesta.
 *
 * @param {string} clanTag - Tag del clan (ej: "#2YQVGPU8C")
 * @param {object} [supabaseClient] - Cliente de Supabase autenticado (opcional)
 * @param {string} [userId] - ID del usuario autenticado (opcional)
 * @returns {Promise<object>} Dashboard unificado del clan
 */
export const getFullClanDetails = async (clanTag, supabaseClient = null, userId = null) => {
  if (!clanTag) {
    throw new Error('El tag del clan es requerido');
  }

  const cleanTag = normalizeTag(clanTag);
  const encodedTag = encodeTag(cleanTag);

  // 1. Ejecutar todas las llamadas concurrentemente con Promise.allSettled
  const promises = [
    // 0: Perfil y miembros principales
    supercellApi.get(`/clans/${encodedTag}`),
    // 1: Guerra actual
    supercellApi.get(`/clans/${encodedTag}/currentwar`),
    // 2: Historial de guerras pasadas
    supercellApi.get(`/clans/${encodedTag}/warlog`, { params: { limit: 10 } }),
    // 3: Temporadas de asaltos de capital
    supercellApi.get(`/clans/${encodedTag}/capitalraidseasons`, { params: { limit: 5 } }),
    // 4: Grupo de Liga de Guerra de Clanes (CWL)
    supercellApi.get(`/clans/${encodedTag}/currentwar/leaguegroup`)
  ];

  // 5: Verificación de favorito en Supabase si hay usuario
  if (supabaseClient && userId) {
    promises.push(
      supabaseClient
        .from('favorites')
        .select('id, created_at, metadata')
        .eq('user_id', userId)
        .eq('type', 'clan')
        .eq('target_tag', cleanTag)
        .maybeSingle()
    );
  }

  const results = await Promise.allSettled(promises);

  // 2. Procesar respuesta principal del clan (índice 0)
  const clanResult = results[0];
  if (clanResult.status === 'rejected') {
    throw clanResult.reason;
  }

  const clanData = clanResult.value.data;

  // 3. Procesar Guerra Actual (índice 1)
  const currentWarResult = results[1];
  let currentWar = null;
  if (currentWarResult.status === 'fulfilled') {
    currentWar = currentWarResult.value.data;
  } else {
    const warStatus = currentWarResult.reason?.response?.status;
    if (warStatus === 403) {
      currentWar = {
        state: 'private',
        message: 'La guerra actual de este clan es privada en los ajustes del juego.'
      };
    } else if (warStatus === 404) {
      currentWar = {
        state: 'notInWar',
        message: 'El clan no se encuentra participando en una guerra actualmente.'
      };
    } else {
      currentWar = {
        state: 'unknown',
        message: currentWarResult.reason?.message || 'No disponible'
      };
    }
  }

  // 4. Procesar Historial de Guerras (índice 2)
  const warLogResult = results[2];
  let warLog = null;
  if (warLogResult.status === 'fulfilled') {
    warLog = {
      isPublic: true,
      total: warLogResult.value.data.items?.length || 0,
      items: warLogResult.value.data.items || []
    };
  } else {
    const logStatus = warLogResult.reason?.response?.status;
    if (logStatus === 403) {
      warLog = {
        isPublic: false,
        message: 'El registro de guerras de este clan es privado en el juego.',
        items: []
      };
    } else {
      warLog = {
        isPublic: false,
        message: warLogResult.reason?.message || 'No se pudo obtener el historial de guerras.',
        items: []
      };
    }
  }

  // 5. Procesar Temporadas de Capital (índice 3)
  const capitalResult = results[3];
  let capitalRaids = null;
  if (capitalResult.status === 'fulfilled') {
    capitalRaids = {
      total: capitalResult.value.data.items?.length || 0,
      seasons: capitalResult.value.data.items || []
    };
  } else {
    capitalRaids = {
      total: 0,
      seasons: []
    };
  }

  // 6. Procesar Grupo de Liga de Guerras CWL (índice 4)
  const cwlResult = results[4];
  let cwlGroup = null;
  if (cwlResult.status === 'fulfilled') {
    cwlGroup = {
      inWarLeague: true,
      data: cwlResult.value.data
    };
  } else {
    cwlGroup = {
      inWarLeague: false,
      data: null
    };
  }

  // 7. Procesar Estado de Favorito (índice 5 si existe)
  let isFavorite = false;
  let favoriteInfo = null;
  if (supabaseClient && userId && results[5]) {
    const favResult = results[5];
    if (favResult.status === 'fulfilled' && favResult.value?.data) {
      isFavorite = true;
      favoriteInfo = favResult.value.data;
    }
  }

  // 8. Resumen estadístico de miembros
  const memberList = clanData.memberList || [];
  const memberCount = memberList.length;
  const roleCounts = {
    leader: 0,
    coLeader: 0,
    admin: 0, // 'admin' = veterano (elder) en la API de Supercell
    member: 0
  };

  let totalTrophies = 0;
  let totalDonations = 0;
  let totalDonationsReceived = 0;

  for (const m of memberList) {
    if (roleCounts[m.role] !== undefined) {
      roleCounts[m.role]++;
    }
    totalTrophies += m.trophies || 0;
    totalDonations += m.donations || 0;
    totalDonationsReceived += m.donationsReceived || 0;
  }

  const memberSummary = {
    totalMembers: memberCount,
    roles: {
      leader: roleCounts.leader,
      coLeaders: roleCounts.coLeader,
      elders: roleCounts.admin,
      members: roleCounts.member
    },
    averageTrophies: memberCount > 0 ? Math.round(totalTrophies / memberCount) : 0,
    totalDonationsCycle: totalDonations,
    totalDonationsReceivedCycle: totalDonationsReceived
  };

  // 9. Consolidar el Dashboard Completo del Clan enriquecido con assets
  const { memberList: _unused, ...clanCore } = clanData;

  return enrichClanWithAssets({
    ...clanCore,
    is_favorite: isFavorite,
    favorite_info: favoriteInfo,
    member_summary: memberSummary,
    members: memberList,
    current_war: currentWar,
    war_log: warLog,
    capital_raids: capitalRaids,
    cwl_group: cwlGroup
  });
};

export default {
  normalizeTag,
  getFullClanDetails
};

