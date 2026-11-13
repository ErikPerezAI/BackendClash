/**
 * Servicio de Verificación de Titularidad y Tracker de Aldea de Clash of Clans.
 * Permite:
 * 1. Verificar tokens de jugador contra la API oficial de Supercell.
 * 2. Parsear y enriquecer el JSON de exportación oficial del juego (Data Export)
 *    con soporte nativo completo para IDs numéricos de Supercell, cantidades (cnt),
 *    defensas, muros, trampas, héroes, laboratorio, mascotas, equipamiento y
 *    Base del Constructor (estilo Clash Ninja).
 */

import { supercellApi } from './supercell.service.js';
import { encodeTag } from '../utils/tag.util.js';
import {
  cleanAssetName,
  getTownHallImageUrl,
  getBuilderHallImageUrl,
  getHeroImageUrl,
  getEquipmentImageUrl,
  getSpellImageUrl,
  getPetImageUrl,
  getTroopImageUrl
} from '../utils/assets.util.js';
import { DEFENSES } from '../data/cocGameData.js';
import {
  SUPERCELL_BUILDINGS,
  SUPERCELL_TRAPS,
  SUPERCELL_HEROES,
  SUPERCELL_SPELLS,
  SUPERCELL_UNITS,
  SUPERCELL_PETS,
  SUPERCELL_EQUIPMENT,
  SUPERCELL_HELPERS,
  SUPERCELL_GUARDIANS,
  SUPERCELL_BUILDER_BASE,
  resolveSupercellEntity
} from '../data/cocSupercellIds.js';

const ASSETS_BASE = process.env.COC_ASSETS_BASE_URL || 'https://raw.githubusercontent.com/ClashKingInc/ClashKingAssets/main/assets';

/**
 * Mapeo de carpetas de edificios en ClashKingAssets
 */
const BUILDING_FOLDER_MAP = {
  x_bow: 'x-bow',
  'x-bow': 'x-bow',
  multi_archer_tower: 'multi-archer_tower',
  'multi-archer_tower': 'multi-archer_tower',
  cake_a_pult: 'cake-a-pult',
  'cake-a-pult': 'cake-a-pult',
  air_defense: 'air_defense',
  air_sweeper: 'air_sweeper',
  scattershot: 'scattershot',
  inferno_tower: 'inferno_tower',
  eagle_artillery: 'eagle_artillery',
  monolith: 'monolith',
  spell_tower: 'spell_tower',
  ricochet_cannon: 'ricochet_cannon',
  bomb_tower: 'bomb_tower',
  wizard_tower: 'wizard_tower',
  hidden_tesla: 'hidden_tesla',
  archer_tower: 'archer_tower',
  cannon: 'cannon',
  mortar: 'mortar',
  town_hall: 'town_hall',
  clan_castle: 'clan_castle',
  army_camp: 'army_camp',
  gold_mine: 'gold_mine',
  gold_storage: 'gold_storage',
  elixir_collector: 'elixir_collector',
  elixir_storage: 'elixir_storage',
  laboratory: 'laboratory',
  spell_factory: 'spell_factory',
  dark_spell_factory: 'dark_spell_factory',
  dark_elixir_drill: 'dark_elixir_drill',
  dark_elixir_storage: 'dark_elixir_storage',
  pet_house: 'pet_house',
  barracks: 'barracks',
  dark_barracks: 'dark_barracks',
  blacksmith: 'blacksmith',
  siege_workshop: 'workshop',
  workshop: 'workshop',
  builders_hut: "builder's_hut",
  builder_s_hut: "builder's_hut",
  "builder's_hut": "builder's_hut",
  wall: 'wall'
};

const TRAP_FOLDER_MAP = {
  bomb: 'bomb',
  spring_trap: 'spring_trap',
  giant_bomb: 'giant_bomb',
  air_bomb: 'air_bomb',
  seeking_air_mine: 'seeking_air_mine',
  skeleton_trap: 'skeleton_trap',
  tornado_trap: 'tornado_trap',
  giga_bomb: 'giga_bomb',
  freeze_trap: 'freeze_trap'
};

/**
 * Categorías estándar de Clash of Clans
 */
const CATEGORY_MAP = {
  town_hall: 'Ayuntamiento',
  clan_castle: 'Ejército',
  army_camp: 'Ejército',
  barracks: 'Ejército',
  dark_barracks: 'Ejército',
  laboratory: 'Ejército',
  spell_factory: 'Ejército',
  dark_spell_factory: 'Ejército',
  pet_house: 'Ejército',
  blacksmith: 'Ejército',
  siege_workshop: 'Ejército',
  air_defense: 'Defensas',
  air_sweeper: 'Defensas',
  scattershot: 'Defensas',
  inferno_tower: 'Defensas',
  eagle_artillery: 'Defensas',
  monolith: 'Defensas',
  spell_tower: 'Defensas',
  ricochet_cannon: 'Defensas',
  multi_archer_tower: 'Defensas',
  bomb_tower: 'Defensas',
  wizard_tower: 'Defensas',
  hidden_tesla: 'Defensas',
  archer_tower: 'Defensas',
  cannon: 'Defensas',
  mortar: 'Defensas',
  x_bow: 'Defensas',
  builders_hut: 'Defensas',
  cake_a_pult: 'Defensas',
  gold_mine: 'Recursos',
  elixir_collector: 'Recursos',
  dark_elixir_drill: 'Recursos',
  gold_storage: 'Recursos',
  elixir_storage: 'Recursos',
  dark_elixir_storage: 'Recursos',
  wall: 'Muros'
};

/**
 * Formatea segundos a texto amigable (ej. "2d 4h 30m" o "45m")
 */
export const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return '0m';
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
};

/**
 * Resuelve la URL de la imagen de un edificio por ID/slug y nivel
 */
export const getBuildingImageUrl = (slug, level) => {
  if (slug === 'town_hall') {
    return getTownHallImageUrl(level);
  }
  if (TRAP_FOLDER_MAP[slug]) {
    const trapFolder = TRAP_FOLDER_MAP[slug];
    return `${ASSETS_BASE}/traps/home-village/${trapFolder}/level_${level}.webp`;
  }
  if (slug === 'cake_a_pult' || slug === 'cake-a-pult') {
    return `${ASSETS_BASE}/buildings/seasonal-defense/cake-a-pult/level_${level}.webp`;
  }
  if (slug === 'helper_hut') {
    return `${ASSETS_BASE}/helpers/builder%27s_apprentice.webp`;
  }
  const folder = BUILDING_FOLDER_MAP[slug] || slug;
  const encodedFolder = folder.includes("'") ? folder.replace(/'/g, '%27') : folder;
  return `${ASSETS_BASE}/buildings/home-village/${encodedFolder}/level_${level}.webp`;
};

/**
 * 1. Verifica el API Token del jugador contra la API oficial de Supercell.
 */
export const verifyTokenWithSupercell = async (playerTag, token) => {
  if (!playerTag || !token) {
    return { valid: false, error: 'Tag de jugador y token son requeridos' };
  }

  try {
    const encodedTag = encodeTag(playerTag);
    const response = await supercellApi.post(`/players/${encodedTag}/verifytoken`, {
      token: token.trim()
    });

    const isOk = response.data?.status === 'ok';
    return {
      valid: isOk,
      tag: response.data?.tag || playerTag,
      status: response.data?.status || 'invalid'
    };
  } catch (error) {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message;

    if (status === 400 || status === 404) {
      return {
        valid: false,
        status: 'invalid',
        error: 'Token o tag inválido según la API de Supercell'
      };
    }

    throw new Error(`Error en llamada a Supercell verifytoken: ${message}`);
  }
};

/**
 * 2. Parsea y procesa el JSON completo de exportación del juego.
 * Soporta tanto el JSON oficial nativo de Clash of Clans como el formato simplificado.
 *
 * @param {string|object} rawInput - Datos exportados en JSON
 * @returns {object} Tracker estructurado completo de la aldea estilo Clash Ninja
 */
export const parseVillageExport = (rawInput) => {
  if (!rawInput) {
    throw new Error('No se proporcionaron datos de aldea para procesar.');
  }

  let parsed = rawInput;
  if (typeof rawInput === 'string') {
    try {
      parsed = JSON.parse(rawInput.trim());
    } catch {
      throw new Error('El texto proporcionado no es un JSON válido. Asegúrate de copiar el JSON completo del juego.');
    }
  }

  const now = Date.now();
  const isNativeExport = Boolean(parsed && typeof parsed === 'object' && (parsed.buildings || parsed.heroes || parsed.units));

  // ---------------------------------------------------------------------------
  // A. DETERMINAR EL NIVEL DE AYUNTAMIENTO (TOWN HALL)
  // ---------------------------------------------------------------------------
  let townHallLevel = Number(parsed.townHallLevel || parsed.th || 0);

  if (!townHallLevel && Array.isArray(parsed.buildings)) {
    // En el JSON nativo: data 1000001 = Town Hall
    const thEntry = parsed.buildings.find(
      (b) => b && (b.data === 1000001 || b.name === 'Town Hall' || b.id === 'town_hall')
    );
    if (thEntry) {
      townHallLevel = Number(thEntry.lvl || thEntry.level || 1);
    }
  }

  if (!townHallLevel) {
    townHallLevel = 1;
  }

  // ---------------------------------------------------------------------------
  // B. EDIFICIOS Y ESTRUCTURAS (BUILDINGS)
  // ---------------------------------------------------------------------------
  const rawBuildings = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.buildings)
    ? parsed.buildings
    : Array.isArray(parsed.structures)
    ? parsed.structures
    : [];

  // Si no se detectó Town Hall previamente, buscarlo en rawBuildings por slug o nombre
  if (!townHallLevel && Array.isArray(rawBuildings)) {
    const thEntry = rawBuildings.find(
      (b) => b && (b.data === 1000001 || cleanAssetName(b.name || b.id || '') === 'town_hall')
    );
    if (thEntry) {
      townHallLevel = Number(thEntry.lvl || thEntry.level || 1);
    }
  }

  const structuresList = [];
  const categorized = {};
  const activeUpgrades = [];
  const wallsSummary = {
    total: 0,
    maxLevelForTH: 19,
    maxedCount: 0,
    byLevel: {}
  };

  let totalDefensesCount = 0;
  let maxedDefensesCount = 0;

  for (const item of rawBuildings) {
    if (!item || typeof item !== 'object') continue;

    const dataId = item.data || item.dataId || item.id || null;
    const level = Number(item.lvl ?? item.level ?? 1);
    const count = Number(item.cnt ?? item.count ?? 1);
    const timerSeconds = Number(item.timer ?? item.upgradeTimeLeft ?? item.remainingTime ?? 0);
    const isUpgrading = Boolean(item.upgrading || item.isUpgrading || timerSeconds > 0);
    const isGearedUp = Boolean(item.gear_up);

    // Resolver metadatos de la entidad por ID numérico o fallback por slug/nombre
    let entity = (dataId && SUPERCELL_BUILDINGS[dataId]) || null;
    const itemSlug = cleanAssetName(item.name || item.id || '');

    if (!entity && dataId) {
      entity = resolveSupercellEntity(dataId, 'Defensas');
    }

    if (!entity || entity.slug === 'unknown') {
      const matchInSupercell = Object.values(SUPERCELL_BUILDINGS).find(
        (b) => b.slug === itemSlug || cleanAssetName(b.name) === itemSlug || cleanAssetName(b.spanishName) === itemSlug
      );
      if (matchInSupercell) {
        entity = matchInSupercell;
      } else if (DEFENSES[itemSlug]) {
        const d = DEFENSES[itemSlug];
        const lvls = Object.keys(d.levels || {}).map(Number);
        const maxLevel = lvls.length > 0 ? Math.max(...lvls) : 20;
        const maxPerTH = Object.keys(d.levels || {}).reduce((acc, l) => {
          const th = d.levels[l].townHall;
          if (!acc[th] || Number(l) > acc[th]) acc[th] = Number(l);
          return acc;
        }, {});
        entity = {
          id: d.id,
          name: d.name,
          spanishName: d.spanishName,
          slug: itemSlug,
          category: d.category || 'Defensas',
          maxLevel,
          maxPerTH
        };
      } else {
        entity = resolveSupercellEntity(dataId || 0, 'Defensas');
      }
    }

    const slug = entity.slug || itemSlug || 'estructura';
    const name = entity.name || item.name || 'Estructura';
    const spanishName = entity.spanishName || name;
    const category = entity.category || CATEGORY_MAP[slug] || 'Defensas';

    // Nivel máximo permitido para el Ayuntamiento del usuario y nivel máximo global
    let maxForTH = entity.maxLevel || 20;
    if (entity.maxPerTH) {
      if (entity.maxPerTH[townHallLevel] !== undefined) {
        maxForTH = entity.maxPerTH[townHallLevel];
      } else {
        const availableTHs = Object.keys(entity.maxPerTH).map(Number).sort((a, b) => a - b);
        const eligibleTHs = availableTHs.filter((th) => th <= townHallLevel);
        if (eligibleTHs.length > 0) {
          maxForTH = entity.maxPerTH[eligibleTHs[eligibleTHs.length - 1]];
        }
      }
    }

    const maxOverall = entity.maxLevel || maxForTH;
    const isMaxForTH = level >= maxForTH;
    const isMaxOverall = level >= maxOverall;

    // Manejo especial de Muros (Wall: 1000010)
    if (slug === 'wall' || dataId === 1000010) {
      wallsSummary.total += count;
      wallsSummary.maxLevelForTH = maxForTH;
      wallsSummary.byLevel[level] = (wallsSummary.byLevel[level] || 0) + count;
      if (isMaxForTH) {
        wallsSummary.maxedCount += count;
      }
    } else {
      // Contabilizar defensas y estructuras para el cálculo de porcentaje
      totalDefensesCount += count;
      if (isMaxForTH) {
        maxedDefensesCount += count;
      }
    }

    const imageUrl = getBuildingImageUrl(slug, level);

    const structureObj = {
      dataId,
      slug,
      name,
      spanishName,
      category,
      level,
      count,
      gearedUp: isGearedUp,
      maxLevelForTH: maxForTH,
      maxLevelOverall: maxOverall,
      isMaxLevel: isMaxForTH,
      isMaxOverall,
      levelsRemaining: Math.max(0, maxForTH - level),
      isUpgrading,
      imageUrl
    };

    if (isUpgrading) {
      const finishTimestamp = timerSeconds > 0 ? new Date(now + timerSeconds * 1000).toISOString() : null;
      const upgradeInfo = {
        type: 'building',
        workerType: 'builder',
        dataId,
        slug,
        name,
        spanishName,
        currentLevel: level,
        targetLevel: level + 1,
        timeLeftSeconds: timerSeconds,
        timeLeftFormatted: formatDuration(timerSeconds),
        finishTimestamp,
        imageUrl: getBuildingImageUrl(slug, level + 1)
      };
      activeUpgrades.push(upgradeInfo);
      structureObj.upgrade = upgradeInfo;
    }

    // Estructuras temporales crafteadas modulares (ej. 1000097)
    if (Array.isArray(item.types)) {
      structureObj.craftedModules = item.types;
      for (const t of item.types) {
        if (Array.isArray(t.modules)) {
          for (const m of t.modules) {
            if (m.timer && m.timer > 0) {
              activeUpgrades.push({
                type: 'crafted_module',
                workerType: 'builder',
                name: 'Módulo de Defensa Crafteada',
                spanishName: 'Módulo Crafteado',
                currentLevel: m.lvl,
                targetLevel: m.lvl + 1,
                timeLeftSeconds: m.timer,
                timeLeftFormatted: formatDuration(m.timer),
                finishTimestamp: new Date(now + m.timer * 1000).toISOString()
              });
            }
          }
        }
      }
    }

    structuresList.push(structureObj);

    if (!categorized[category]) {
      categorized[category] = [];
    }
    categorized[category].push(structureObj);
  }

  // ---------------------------------------------------------------------------
  // C. TRAMPAS (TRAPS)
  // ---------------------------------------------------------------------------
  const rawTraps = Array.isArray(parsed.traps) ? parsed.traps : [];
  const trapsList = [];

  for (const item of rawTraps) {
    if (!item || typeof item !== 'object') continue;

    const dataId = item.data;
    const level = Number(item.lvl ?? 1);
    const count = Number(item.cnt ?? 1);
    const timerSeconds = Number(item.timer ?? 0);
    const isUpgrading = timerSeconds > 0;

    const entity = (dataId && SUPERCELL_TRAPS[dataId]) || resolveSupercellEntity(dataId, 'Trampas');
    const maxForTH = (entity.maxPerTH && entity.maxPerTH[townHallLevel]) || entity.maxLevel || 12;
    const isMaxForTH = level >= maxForTH;

    totalDefensesCount += count;
    if (isMaxForTH) maxedDefensesCount += count;

    const trapObj = {
      dataId,
      slug: entity.slug,
      name: entity.name,
      spanishName: entity.spanishName,
      category: 'Trampas',
      level,
      count,
      maxLevelForTH: maxForTH,
      isMaxLevel: isMaxForTH,
      isUpgrading,
      timeLeftSeconds: timerSeconds,
      timeLeftFormatted: formatDuration(timerSeconds),
      imageUrl: getBuildingImageUrl(entity.slug, level)
    };

    if (isUpgrading) {
      activeUpgrades.push({
        type: 'trap',
        workerType: 'builder',
        dataId,
        name: entity.name,
        spanishName: entity.spanishName,
        currentLevel: level,
        targetLevel: level + 1,
        timeLeftSeconds: timerSeconds,
        timeLeftFormatted: formatDuration(timerSeconds),
        finishTimestamp: new Date(now + timerSeconds * 1000).toISOString(),
        imageUrl: getBuildingImageUrl(entity.slug, level + 1)
      });
    }

    trapsList.push(trapObj);
    if (!categorized.Trampas) {
      categorized.Trampas = [];
    }
    categorized.Trampas.push(trapObj);
  }

  // ---------------------------------------------------------------------------
  // D. HÉROES (HEROES)
  // ---------------------------------------------------------------------------
  const rawHeroes = Array.isArray(parsed.heroes) ? parsed.heroes : [];
  const heroesList = [];
  let totalHeroLevels = 0;
  let maxHeroLevelsForTH = 0;

  for (const item of rawHeroes) {
    if (!item || typeof item !== 'object') continue;

    const dataId = item.data;
    const level = Number(item.lvl ?? 1);
    const timerSeconds = Number(item.timer ?? 0);
    const isUpgrading = timerSeconds > 0;

    const entity = (dataId && SUPERCELL_HEROES[dataId]) || resolveSupercellEntity(dataId, 'Héroes');
    const maxForTH = (entity.maxPerTH && entity.maxPerTH[townHallLevel]) || entity.maxLevel || 100;

    totalHeroLevels += level;
    maxHeroLevelsForTH += maxForTH;

    const heroObj = {
      dataId,
      name: entity.name,
      spanishName: entity.spanishName,
      slug: entity.slug,
      level,
      maxLevelForTH: maxForTH,
      isMaxLevel: level >= maxForTH,
      isUpgrading,
      timeLeftSeconds: timerSeconds,
      timeLeftFormatted: formatDuration(timerSeconds),
      imageUrl: getHeroImageUrl(entity.name)
    };

    if (isUpgrading) {
      activeUpgrades.push({
        type: 'hero',
        workerType: 'builder',
        dataId,
        name: entity.name,
        spanishName: entity.spanishName,
        currentLevel: level,
        targetLevel: level + 1,
        timeLeftSeconds: timerSeconds,
        timeLeftFormatted: formatDuration(timerSeconds),
        finishTimestamp: new Date(now + timerSeconds * 1000).toISOString(),
        imageUrl: getHeroImageUrl(entity.name)
      });
    }

    heroesList.push(heroObj);
  }

  // ---------------------------------------------------------------------------
  // E. LABORATORIO: HECHIZOS, TROPAS Y MÁQUINAS DE ASEDIO (LABORATORY)
  // ---------------------------------------------------------------------------
  const rawSpells = Array.isArray(parsed.spells) ? parsed.spells : [];
  const rawUnits = Array.isArray(parsed.units) ? parsed.units : [];
  const rawSiege = Array.isArray(parsed.siege_machines) ? parsed.siege_machines : [];

  const spellsList = [];
  const unitsList = [];
  const siegeList = [];

  let totalLabLevels = 0;
  let maxLabLevels = 0;

  // Hechizos
  for (const item of rawSpells) {
    if (!item || typeof item !== 'object') continue;
    const dataId = item.data;
    const level = Number(item.lvl ?? 1);
    const timerSeconds = Number(item.timer ?? 0);
    const isUpgrading = timerSeconds > 0;

    const entity = (dataId && SUPERCELL_SPELLS[dataId]) || resolveSupercellEntity(dataId, 'Hechizos');
    const maxLevel = entity.maxLevel || 10;
    totalLabLevels += level;
    maxLabLevels += maxLevel;

    const spellObj = {
      dataId,
      name: entity.name,
      spanishName: entity.spanishName,
      level,
      maxLevel,
      isMaxLevel: level >= maxLevel,
      isUpgrading,
      imageUrl: getSpellImageUrl(entity.name)
    };

    if (isUpgrading) {
      activeUpgrades.push({
        type: 'laboratory_spell',
        workerType: 'laboratory',
        dataId,
        name: entity.name,
        spanishName: entity.spanishName,
        currentLevel: level,
        targetLevel: level + 1,
        timeLeftSeconds: timerSeconds,
        timeLeftFormatted: formatDuration(timerSeconds),
        finishTimestamp: new Date(now + timerSeconds * 1000).toISOString(),
        imageUrl: getSpellImageUrl(entity.name)
      });
    }

    spellsList.push(spellObj);
  }

  // Tropas
  for (const item of rawUnits) {
    if (!item || typeof item !== 'object') continue;
    const dataId = item.data;
    const level = Number(item.lvl ?? 1);
    const timerSeconds = Number(item.timer ?? 0);
    const isUpgrading = timerSeconds > 0;

    const entity = (dataId && SUPERCELL_UNITS[dataId]) || resolveSupercellEntity(dataId, 'Tropas');
    const maxLevel = entity.maxLevel || 13;
    totalLabLevels += level;
    maxLabLevels += maxLevel;

    const troopObj = {
      dataId,
      name: entity.name,
      spanishName: entity.spanishName,
      level,
      maxLevel,
      isMaxLevel: level >= maxLevel,
      isUpgrading,
      timeLeftSeconds: timerSeconds,
      timeLeftFormatted: formatDuration(timerSeconds),
      imageUrl: getTroopImageUrl(entity.name)
    };

    if (isUpgrading) {
      activeUpgrades.push({
        type: 'laboratory_troop',
        workerType: 'laboratory',
        dataId,
        name: entity.name,
        spanishName: entity.spanishName,
        currentLevel: level,
        targetLevel: level + 1,
        timeLeftSeconds: timerSeconds,
        timeLeftFormatted: formatDuration(timerSeconds),
        finishTimestamp: new Date(now + timerSeconds * 1000).toISOString(),
        imageUrl: getTroopImageUrl(entity.name)
      });
    }

    unitsList.push(troopObj);
  }

  // Máquinas de Asedio
  for (const item of rawSiege) {
    if (!item || typeof item !== 'object') continue;
    const dataId = item.data;
    const level = Number(item.lvl ?? 1);
    const timerSeconds = Number(item.timer ?? 0);
    const isUpgrading = timerSeconds > 0;

    const entity = (dataId && SUPERCELL_UNITS[dataId]) || resolveSupercellEntity(dataId, 'Asedio');
    const maxLevel = entity.maxLevel || 5;
    totalLabLevels += level;
    maxLabLevels += maxLevel;

    const siegeObj = {
      dataId,
      name: entity.name,
      spanishName: entity.spanishName,
      level,
      maxLevel,
      isMaxLevel: level >= maxLevel,
      isUpgrading,
      timeLeftSeconds: timerSeconds,
      timeLeftFormatted: formatDuration(timerSeconds),
      imageUrl: getTroopImageUrl(entity.name)
    };

    if (isUpgrading) {
      activeUpgrades.push({
        type: 'laboratory_siege',
        workerType: 'laboratory',
        dataId,
        name: entity.name,
        spanishName: entity.spanishName,
        currentLevel: level,
        targetLevel: level + 1,
        timeLeftSeconds: timerSeconds,
        timeLeftFormatted: formatDuration(timerSeconds),
        finishTimestamp: new Date(now + timerSeconds * 1000).toISOString(),
        imageUrl: getTroopImageUrl(entity.name)
      });
    }

    siegeList.push(siegeObj);
  }

  // ---------------------------------------------------------------------------
  // F. MASCOTAS (PETS)
  // ---------------------------------------------------------------------------
  const rawPets = Array.isArray(parsed.pets) ? parsed.pets : [];
  const petsList = [];

  for (const item of rawPets) {
    if (!item || typeof item !== 'object') continue;
    const dataId = item.data;
    const level = Number(item.lvl ?? 1);
    const timerSeconds = Number(item.timer ?? 0);
    const isUpgrading = timerSeconds > 0;

    const entity = (dataId && SUPERCELL_PETS[dataId]) || resolveSupercellEntity(dataId, 'Mascotas');
    const maxLevel = entity.maxLevel || 15;

    const petObj = {
      dataId,
      name: entity.name,
      spanishName: entity.spanishName,
      level,
      maxLevel,
      isMaxLevel: level >= maxLevel,
      isUpgrading,
      timeLeftFormatted: formatDuration(timerSeconds),
      imageUrl: getPetImageUrl(entity.name)
    };

    if (isUpgrading) {
      activeUpgrades.push({
        type: 'pet',
        workerType: 'pet_house',
        dataId,
        name: entity.name,
        spanishName: entity.spanishName,
        currentLevel: level,
        targetLevel: level + 1,
        timeLeftSeconds: timerSeconds,
        timeLeftFormatted: formatDuration(timerSeconds),
        finishTimestamp: new Date(now + timerSeconds * 1000).toISOString(),
        imageUrl: getPetImageUrl(entity.name)
      });
    }

    petsList.push(petObj);
  }

  // ---------------------------------------------------------------------------
  // G. EQUIPAMIENTO DE HÉROES (EQUIPMENT)
  // ---------------------------------------------------------------------------
  const rawEquipment = Array.isArray(parsed.equipment) ? parsed.equipment : [];
  const equipmentList = rawEquipment.map((item) => {
    const dataId = item.data;
    const level = Number(item.lvl ?? 1);
    const entity = (dataId && SUPERCELL_EQUIPMENT[dataId]) || resolveSupercellEntity(dataId, 'Equipamiento');
    return {
      dataId,
      name: entity.name,
      spanishName: entity.spanishName,
      hero: entity.hero,
      level,
      maxLevel: entity.maxLevel || 27,
      imageUrl: getEquipmentImageUrl(entity.name)
    };
  });

  // ---------------------------------------------------------------------------
  // H. HELPERS Y GUARDIANES
  // ---------------------------------------------------------------------------
  const rawHelpers = Array.isArray(parsed.helpers) ? parsed.helpers : [];
  const helpersList = rawHelpers.map((item) => {
    const entity = (item.data && SUPERCELL_HELPERS[item.data]) || resolveSupercellEntity(item.data, 'Helpers');
    return {
      dataId: item.data,
      name: entity.name,
      spanishName: entity.spanishName,
      level: item.lvl,
      cooldownSeconds: item.helper_cooldown,
      cooldownFormatted: formatDuration(item.helper_cooldown)
    };
  });

  const rawGuardians = Array.isArray(parsed.guardians) ? parsed.guardians : [];
  const guardiansList = [];
  for (const item of rawGuardians) {
    const entity = (item.data && SUPERCELL_GUARDIANS[item.data]) || resolveSupercellEntity(item.data, 'Guardianes');
    const isUpgrading = Boolean(item.timer && item.timer > 0);
    const guardianObj = {
      dataId: item.data,
      name: entity.name,
      spanishName: entity.spanishName,
      level: item.lvl,
      isUpgrading,
      timerSeconds: item.timer || 0
    };
    if (isUpgrading) {
      activeUpgrades.push({
        type: 'guardian',
        workerType: 'builder',
        name: entity.name,
        spanishName: entity.spanishName,
        currentLevel: item.lvl,
        targetLevel: item.lvl + 1,
        timeLeftSeconds: item.timer,
        timeLeftFormatted: formatDuration(item.timer),
        finishTimestamp: new Date(now + item.timer * 1000).toISOString()
      });
    }
    guardiansList.push(guardianObj);
  }

  // ---------------------------------------------------------------------------
  // I. BASE DEL CONSTRUCTOR (BUILDER BASE)
  // ---------------------------------------------------------------------------
  const rawBuildings2 = Array.isArray(parsed.buildings2) ? parsed.buildings2 : [];
  const rawHeroes2 = Array.isArray(parsed.heroes2) ? parsed.heroes2 : [];
  const rawUnits2 = Array.isArray(parsed.units2) ? parsed.units2 : [];

  let builderHallLevel = 1;
  const bbBuildings = [];

  for (const b of rawBuildings2) {
    const entity = SUPERCELL_BUILDER_BASE.buildings[b.data] || resolveSupercellEntity(b.data, 'BaseConstructor');
    if (b.data === 1000034) {
      builderHallLevel = b.lvl;
    }
    bbBuildings.push({
      dataId: b.data,
      name: entity.name,
      spanishName: entity.spanishName,
      level: b.lvl,
      count: b.cnt || 1
    });
  }

  const bbHeroes = rawHeroes2.map((h) => {
    const entity = SUPERCELL_BUILDER_BASE.heroes[h.data] || resolveSupercellEntity(h.data, 'HéroesTaller');
    return {
      dataId: h.data,
      name: entity.name,
      spanishName: entity.spanishName,
      level: h.lvl,
      maxLevel: entity.maxLevel || 35
    };
  });

  const bbUnits = rawUnits2.map((u) => {
    const entity = SUPERCELL_BUILDER_BASE.units[u.data] || resolveSupercellEntity(u.data, 'TropasTaller');
    return {
      dataId: u.data,
      name: entity.name,
      spanishName: entity.spanishName,
      level: u.lvl,
      maxLevel: entity.maxLevel || 20
    };
  });

  const builderBaseSummary = {
    builderHallLevel,
    totalBuildings: bbBuildings.length,
    buildings: bbBuildings,
    heroes: bbHeroes,
    units: bbUnits
  };

  // ---------------------------------------------------------------------------
  // J. CÁLCULO DE PROGRESO PORCENTUAL (CLASH NINJA PROGRESS)
  // ---------------------------------------------------------------------------
  const defensesPercentage = totalDefensesCount > 0 ? Number(((maxedDefensesCount / totalDefensesCount) * 100).toFixed(2)) : 0;
  const heroesPercentage = maxHeroLevelsForTH > 0 ? Number(((totalHeroLevels / maxHeroLevelsForTH) * 100).toFixed(2)) : 0;
  const labPercentage = maxLabLevels > 0 ? Number(((totalLabLevels / maxLabLevels) * 100).toFixed(2)) : 0;
  const wallsPercentage = wallsSummary.total > 0 ? Number(((wallsSummary.maxedCount / wallsSummary.total) * 100).toFixed(2)) : 0;

  // Promedio ponderado global: 40% Defensas, 25% Héroes, 25% Laboratorio, 10% Muros
  const overallPercentage = Number((defensesPercentage * 0.4 + heroesPercentage * 0.25 + labPercentage * 0.25 + wallsPercentage * 0.1).toFixed(2));

  // Constructores ocupados (trabajando en estructuras, trampas o héroes)
  const busyBuilders = activeUpgrades.filter((u) => u.workerType === 'builder').length;

  return {
    tag: parsed.tag || null,
    townHallLevel,
    totalStructures: totalDefensesCount + (wallsSummary.total > 0 ? 1 : 0),
    maxedStructures: maxedDefensesCount + (wallsSummary.maxedCount === wallsSummary.total && wallsSummary.total > 0 ? 1 : 0),
    completionPercentage: isNativeExport ? overallPercentage : defensesPercentage,
    progress: {
      overall_percentage: overallPercentage,
      defenses_percentage: defensesPercentage,
      heroes_percentage: heroesPercentage,
      lab_percentage: labPercentage,
      walls_percentage: wallsPercentage
    },
    builders: {
      total: 6,
      busy: busyBuilders,
      available: Math.max(0, 6 - busyBuilders)
    },
    activeUpgradesCount: activeUpgrades.length,
    activeUpgrades,
    walls: wallsSummary,
    heroes: heroesList,
    laboratory: {
      total_items: spellsList.length + unitsList.length + siegeList.length,
      completion_percentage: labPercentage,
      spells: spellsList,
      units: unitsList,
      siege_machines: siegeList
    },
    pets: petsList,
    equipment: equipmentList,
    helpers: helpersList,
    guardians: guardiansList,
    builder_base: builderBaseSummary,
    categories: categorized,
    structures: structuresList,
    traps: trapsList,
    parsedAt: new Date().toISOString()
  };
};

export default {
  verifyTokenWithSupercell,
  parseVillageExport,
  formatDuration,
  getBuildingImageUrl
};
