import { Router } from 'express';
import {
  // Jugadores
  getPlayer,
  
  // Clanes
  searchClans,
  getClan,
  toggleClanFavorite,
  getClanMembers,
  getClanWarLog,
  getClanCurrentWar,
  getClanWarLeagueGroup,
  getClanCapitalRaidSeasons,
  
  // Rankings y Ubicaciones
  getLocations,
  getLocationById,
  getClanRankings,
  getPlayerRankings,
  getClanBuilderBaseRankings,
  getPlayerBuilderBaseRankings,
  getCapitalRankings,
  
  // Ligas
  getLeagues,
  getLeagueById,
  getLeagueSeasons,
  getLeagueSeasonRankings,
  getWarLeagues,
  getWarLeagueById,
  getBuilderBaseLeagues,
  getBuilderBaseLeagueById,
  getCapitalLeagues,
  getCapitalLeagueById,
  
  // Etiquetas
  getClanLabels,
  getPlayerLabels,
  
  // Pase de oro y diagnóstico
  getCurrentGoldPassSeason,
  getApiStatus
} from '../controllers/coc.controller.js';
import {
  claimPlayer,
  unclaimPlayer,
  listMyClaimedPlayers,
  importVillageData,
  getClaimedPlayerTracker,
  getVillageHistory
} from '../controllers/villageTracker.controller.js';
import { requireAuth, optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// ============================================================================
// 1. JUGADORES Y TRACKER DE ALDEA (PLAYERS & VILLAGE TRACKER)
// ============================================================================
// Consulta de jugador (pública, enriquecida con estado de claim y favoritos si hay sesión)
router.get('/player/:tag', optionalAuth, getPlayer);
router.get('/players/:tag', optionalAuth, getPlayer); // Alias plural para conveniencia REST

// Aldeas Claimeadas y Tracker (Requiere sesión iniciada)
router.get('/claimed-players', requireAuth, listMyClaimedPlayers);
router.post('/player/:tag/claim', requireAuth, claimPlayer);
router.delete('/player/:tag/claim', requireAuth, unclaimPlayer);
router.post('/player/:tag/village-data', requireAuth, importVillageData);
router.get('/player/:tag/tracker', requireAuth, getClaimedPlayerTracker);
router.get('/player/:tag/history', requireAuth, getVillageHistory); // Serie temporal de snapshots para gráficas (RF-07)

// ============================================================================
// 2. CLANES (CLANS)
// ============================================================================
router.get('/clans', searchClans); // Búsqueda de clanes con filtros (?name=..., etc.)
router.get('/clan/:tag', optionalAuth, getClan); // Dashboard completo unificado (con is_favorite si hay sesión)
router.post('/clan/:tag/favorite', requireAuth, toggleClanFavorite); // Alternar favorito (Toggle rápido)
router.get('/clan/:tag/members', getClanMembers);
router.get('/clan/:tag/warlog', getClanWarLog);
router.get('/clan/:tag/currentwar', getClanCurrentWar);
router.get('/clan/:tag/leaguegroup', getClanWarLeagueGroup);
router.get('/clan/:tag/capitalraids', getClanCapitalRaidSeasons);

// ============================================================================
// 3. RANKINGS Y UBICACIONES (LEADERBOARDS)
// ============================================================================
router.get('/locations', getLocations);
router.get('/locations/:locationId', getLocationById);
router.get('/rankings/clans/:locationId?', getClanRankings);
router.get('/rankings/players/:locationId?', getPlayerRankings);
router.get('/rankings/clans-builder-base/:locationId?', getClanBuilderBaseRankings);
router.get('/rankings/players-builder-base/:locationId?', getPlayerBuilderBaseRankings);
router.get('/rankings/capitals/:locationId?', getCapitalRankings);

// ============================================================================
// 4. LIGAS
// ============================================================================
router.get('/leagues', getLeagues);
router.get('/leagues/:leagueId/seasons/:seasonId', getLeagueSeasonRankings);
router.get('/leagues/:leagueId/seasons', getLeagueSeasons);
router.get('/leagues/:leagueId', getLeagueById);

router.get('/warleagues', getWarLeagues);
router.get('/warleagues/:leagueId', getWarLeagueById);

router.get('/builderbaseleagues', getBuilderBaseLeagues);
router.get('/builderbaseleagues/:leagueId', getBuilderBaseLeagueById);

router.get('/capitalleagues', getCapitalLeagues);
router.get('/capitalleagues/:leagueId', getCapitalLeagueById);

// ============================================================================
// 5. ETIQUETAS (LABELS)
// ============================================================================
router.get('/labels/clans', getClanLabels);
router.get('/labels/players', getPlayerLabels);

// ============================================================================
// 6. PASE DE ORO (GOLD PASS) Y ESTADO DE CONEXIÓN SUPERCELL
// ============================================================================
router.get('/goldpass/current', getCurrentGoldPassSeason);
router.get('/api-status', optionalAuth, getApiStatus);

export default router;
