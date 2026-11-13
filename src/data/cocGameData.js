/**
 * ============================================================================
 * CLASH TACTICS - UNIFIED GAME DATA LAYER (SINGLE SOURCE OF TRUTH - SSOT)
 * ============================================================================
 * Capa de datos unificada del backend para Clash of Clans.
 * Carga en memoria `cocMasterGameData.json` (520+ KB) y provee índices bidireccionales
 * ultra rápidos O(1) tanto por slug textual ('air_defense') como por ID numérico oficial
 * de Supercell (1000012).
 *
 * Alimenta simultáneamente:
 * 1. Calculadora Táctica (Combate: HP, DPS, Daño de impacto, Supercargas, Hechizos)
 * 2. Village Tracker (Gestión: Costes, Tiempos en segundos, Ayuntamiento, Minerales,
 *    IDs de Supercell, Helpers, Guardianes y Base del Constructor)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CARGA EN MEMORIA DEL DATASET MAESTRO (LATENCIA 0 MS)
// ============================================================================

const MASTER_PATH = path.resolve(__dirname, 'cocMasterGameData.json');
export const MASTER_GAME_DATA = JSON.parse(fs.readFileSync(MASTER_PATH, 'utf-8'));

// ============================================================================
// FUNCIÓN AUXILIAR DE CÁLCULO DINÁMICO DE NIVELES MÁXIMOS POR TH (maxPerTH)
// ============================================================================

/**
 * Calcula dinámicamente el diccionario maxPerTH (techo de nivel por Ayuntamiento 1 a 18)
 * analizando la propiedad town_hall_required de cada nivel en la Fuente Única de Verdad.
 */
function computeMaxPerTH(levelsObj, defaultMax = 20) {
  if (!levelsObj || typeof levelsObj !== 'object') {
    const map = {};
    for (let th = 1; th <= 18; th++) map[th] = defaultMax;
    return { maxLevel: defaultMax, maxPerTH: map };
  }
  const lvlNums = Object.keys(levelsObj).map(Number).sort((a, b) => a - b);
  const maxLevel = lvlNums.length > 0 ? lvlNums[lvlNums.length - 1] : defaultMax;
  const maxPerTH = {};
  for (let th = 1; th <= 18; th++) {
    let maxForThisTH = 1;
    for (const lvl of lvlNums) {
      const thReq = Number(levelsObj[lvl]?.town_hall_required ?? levelsObj[lvl]?.townHall ?? 1);
      if (thReq <= th && lvl > maxForThisTH) {
        maxForThisTH = lvl;
      }
    }
    maxPerTH[th] = maxForThisTH;
  }
  return { maxLevel, maxPerTH };
}

// ============================================================================
// 1. ADAPTADORES DE COMBATE PARA LA CALCULADORA TÁCTICA
// ============================================================================

/**
 * 1.A ESTRUCTURAS Y DEFENSAS (DEFENSES & DEFENSES_BY_ID)
 */
export const DEFENSES = {};
export const DEFENSES_BY_ID = {};

for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.home_village?.structures || MASTER_GAME_DATA.structures || {})) {
  const levels = {};
  for (const [lvlStr, lData] of Object.entries(raw.levels || {})) {
    const lvlNum = Number(lvlStr);

    // Adaptar supercargas si existen
    let supercharges = null;
    if (lData.supercharges) {
      supercharges = {};
      for (const [scLvl, scData] of Object.entries(lData.supercharges)) {
        supercharges[Number(scLvl)] = {
          hp: scData.hitpoints ?? scData.hp ?? null,
          hitpoints: scData.hitpoints ?? scData.hp ?? null,
          dps: scData.damage_per_second ?? scData.dps ?? null,
          damage_per_second: scData.damage_per_second ?? scData.dps ?? null,
          damage_per_shot: scData.damage_per_shot ?? null,
          upgrade_cost: scData.upgrade_cost ?? null,
          upgrade_time_seconds: scData.upgrade_time_seconds ?? null
        };
      }
    }

    levels[lvlNum] = {
      level: lvlNum,
      hp: lData.hitpoints ?? null,
      hitpoints: lData.hitpoints ?? null,
      dps: lData.damage_per_second ?? null,
      damage_per_second: lData.damage_per_second ?? null,
      damage_per_shot: lData.damage_per_shot ?? null,
      townHall: lData.town_hall_required ?? 1,
      town_hall_required: lData.town_hall_required ?? 1,
      upgrade_cost: lData.upgrade_cost ?? null,
      upgrade_time_seconds: lData.upgrade_time_seconds ?? null,
      resource_type: lData.resource_type ?? 'Gold',
      range: lData.range ?? raw.range ?? null,
      attack_speed: lData.attack_speed ?? raw.attack_speed ?? null,
      supercharges
    };
  }

  const defenseObj = {
    id: raw.id || slug,
    data_id: raw.data_id || null,
    name: raw.name,
    spanishName: raw.spanish_name || raw.spanishName || raw.name,
    spanish_name: raw.spanish_name || raw.spanishName || raw.name,
    category: raw.category || 'defense',
    village_type: raw.village_type || 'home',
    town_hall_required: raw.town_hall_required || 1,
    range: raw.range ?? null,
    attackSpeed: raw.attack_speed ?? null,
    levels
  };

  DEFENSES[slug] = defenseObj;
  if (raw.data_id) {
    DEFENSES_BY_ID[raw.data_id] = defenseObj;
  }
  if (Array.isArray(raw.secondary_data_ids)) {
    for (const secId of raw.secondary_data_ids) {
      DEFENSES_BY_ID[secId] = defenseObj;
    }
  }
}

/**
 * 1.B HECHIZOS (SPELLS & SPELLS_BY_ID)
 */
export const SPELLS = {};
export const SPELLS_BY_ID = {};

for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.home_village?.spells || MASTER_GAME_DATA.spells || {})) {
  const levels = {};
  for (const [lvlStr, lData] of Object.entries(raw.levels || {})) {
    const lvlNum = Number(lvlStr);
    levels[lvlNum] = {
      level: lvlNum,
      damage: lData.total_damage ?? lData.damage ?? null,
      total_damage: lData.total_damage ?? lData.damage ?? null,
      damagePercent: lData.building_damage_percent ?? lData.damage_percent ?? lData.damagePercent ?? null,
      damage_percent: lData.building_damage_percent ?? lData.damage_percent ?? lData.damagePercent ?? null,
      earthquakePercent: lData.building_damage_percent ?? lData.damage_percent ?? lData.damagePercent ?? null,
      research_cost: lData.research_cost ?? null,
      research_time_seconds: lData.research_time_seconds ?? null,
      resource_type: lData.resource_type ?? (raw.sub_type === 'Dark Elixir' ? 'Dark Elixir' : 'Elixir'),
      laboratory_level_required: lData.laboratory_level_required ?? null,
      town_hall_required: lData.town_hall_required ?? null
    };
  }

  const spellObj = {
    id: raw.id || slug,
    data_id: raw.data_id || null,
    name: raw.name,
    spanishName: raw.spanish_name || raw.spanishName || raw.name,
    spanish_name: raw.spanish_name || raw.spanishName || raw.name,
    type: raw.type || 'Spell',
    sub_type: raw.sub_type || 'Elixir',
    housingSpace: raw.housing_space || (raw.sub_type === 'Dark Elixir' ? 1 : 2),
    radiusTiles: raw.range || 2.5,
    levels
  };

  SPELLS[slug] = spellObj;
  if (raw.data_id) {
    SPELLS_BY_ID[raw.data_id] = spellObj;
  }
  if (Array.isArray(raw.secondary_data_ids)) {
    for (const secId of raw.secondary_data_ids) {
      SPELLS_BY_ID[secId] = spellObj;
    }
  }
}

/**
 * 1.C EQUIPAMIENTO DE HÉROES (HERO_EQUIPMENT & EQUIPMENT_BY_ID)
 */
export const HERO_EQUIPMENT = {};
export const EQUIPMENT_BY_ID = {};

for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.home_village?.hero_equipment || MASTER_GAME_DATA.hero_equipment || {})) {
  const levels = {};
  let maxLevel = 0;
  for (const [lvlStr, lData] of Object.entries(raw.levels || {})) {
    const lvlNum = Number(lvlStr);
    if (lvlNum > maxLevel) maxLevel = lvlNum;
    levels[lvlNum] = {
      level: lvlNum,
      damage: lData.damage ?? lData.projectile_damage ?? lData.ability_damage ?? lData.damage_increase ?? null,
      burst_damage: lData.damage ?? lData.projectile_damage ?? lData.ability_damage ?? null,
      damage_increase: lData.damage_increase ?? lData.damage ?? null,
      hp: lData.hp_increase ?? lData.hp ?? null,
      hp_increase: lData.hp_increase ?? lData.hp ?? null,
      durationSeconds: lData.ability_duration ?? lData.durationSeconds ?? null,
      ability_duration: lData.ability_duration ?? lData.durationSeconds ?? null,
      dpsBoost: lData.damage_per_second_boost ?? lData.dpsBoost ?? null,
      damage_per_second_boost: lData.damage_per_second_boost ?? lData.dpsBoost ?? null,
      reductionPercent: lData.damage_reduction_percent ?? lData.reductionPercent ?? null,
      damage_reduction_percent: lData.damage_reduction_percent ?? lData.reductionPercent ?? null,
      area_damage_radius: lData.area_damage_radius ?? lData.splashRadiusTiles ?? null,
      splashRadiusTiles: lData.area_damage_radius ?? lData.splashRadiusTiles ?? null,
      bounces: lData.bounces ?? lData.number_of_targets ?? lData.max_targets ?? null,
      self_heal_per_second: lData.self_heal_per_second ?? null,
      shiny_ore: lData.shiny_ore ?? 0,
      glowy_ore: lData.glowy_ore ?? 0,
      starry_ore: lData.starry_ore ?? null,
      blacksmith_level_required: lData.blacksmith_level_required ?? 1
    };
  }

  const rarity = raw.rarity || 'Common';
  const defaultMaxLevel = rarity === 'Epic' ? 27 : 18;
  const computedMaxLevel = maxLevel || defaultMaxLevel;
  const hasDirectDamage = Object.values(levels).some((l) => typeof l.burst_damage === 'number' && l.burst_damage > 0);

  const equipObj = {
    id: raw.id || slug,
    data_id: raw.data_id || null,
    name: raw.name,
    spanishName: raw.spanish_name || raw.spanishName || raw.name,
    spanish_name: raw.spanish_name || raw.spanishName || raw.name,
    hero: raw.hero || 'General',
    rarity,
    maxLevel: computedMaxLevel,
    type: raw.type || (hasDirectDamage ? 'active_damage' : 'passive_or_buff'),
    description: raw.description || `Equipamiento ${rarity === 'Epic' ? 'Épico' : 'Común'} de ${raw.hero || 'Héroe'} (Niv. máx ${computedMaxLevel})`,
    blacksmith_level_required: raw.blacksmith_level_required || 1,
    levels
  };

  HERO_EQUIPMENT[slug] = equipObj;
  if (raw.data_id) {
    EQUIPMENT_BY_ID[raw.data_id] = equipObj;
  }
  if (Array.isArray(raw.secondary_data_ids)) {
    for (const secId of raw.secondary_data_ids) {
      EQUIPMENT_BY_ID[secId] = equipObj;
    }
  }
}

/**
 * 1.D TROPAS, HÉROES, MASCOTAS, ASEDIO Y OTRAS ENTIDADES
 */
export const UNITS = {};
export const UNITS_BY_ID = {};

const allUnitsRaw = {
  ...(MASTER_GAME_DATA.home_village?.troops || {}),
  ...(MASTER_GAME_DATA.home_village?.super_troops || {}),
  ...(MASTER_GAME_DATA.home_village?.siege_machines || {})
};

for (const [slug, raw] of Object.entries(allUnitsRaw)) {
  UNITS[slug] = raw;
  if (raw.data_id) {
    UNITS_BY_ID[raw.data_id] = raw;
  }
  if (Array.isArray(raw.secondary_data_ids)) {
    for (const secId of raw.secondary_data_ids) {
      UNITS_BY_ID[secId] = raw;
    }
  }
}

export const HEROES = {};
export const HEROES_BY_ID = {};

for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.home_village?.heroes || MASTER_GAME_DATA.heroes || {})) {
  HEROES[slug] = raw;
  if (raw.data_id) {
    HEROES_BY_ID[raw.data_id] = raw;
  }
}

export const PETS = {};
export const PETS_BY_ID = {};

for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.home_village?.pets || MASTER_GAME_DATA.pets || {})) {
  PETS[slug] = raw;
  if (raw.data_id) {
    PETS_BY_ID[raw.data_id] = raw;
  }
}

export const SIEGE_MACHINES = {};
export const SIEGE_MACHINES_BY_ID = {};

for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.home_village?.siege_machines || MASTER_GAME_DATA.siege_machines || {})) {
  SIEGE_MACHINES[slug] = raw;
  if (raw.data_id) {
    SIEGE_MACHINES_BY_ID[raw.data_id] = raw;
  }
  if (Array.isArray(raw.secondary_data_ids)) {
    for (const secId of raw.secondary_data_ids) {
      SIEGE_MACHINES_BY_ID[secId] = raw;
    }
  }
}

export const BUILDER_BASE = MASTER_GAME_DATA.builder_base || { structures: {}, troops: {}, heroes: {} };
export const CLAN_CAPITAL = MASTER_GAME_DATA.other?.clan_capital || { structures: {}, troops: {}, spells: {} };

// ============================================================================
// 2. ÍNDICES NUMÉRICOS OFICIALES DE SUPERCELL PARA EL VILLAGE TRACKER O(1)
// ============================================================================

export const SUPERCELL_BUILDINGS = {};
export const SUPERCELL_TRAPS = {};

for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.home_village?.structures || {})) {
  const { maxLevel, maxPerTH } = computeMaxPerTH(raw.levels, 20);
  const isTrap = raw.category === 'Trampas';
  const entry = {
    id: raw.id || slug,
    name: raw.name,
    spanishName: raw.spanish_name || raw.spanishName || raw.name,
    spanish_name: raw.spanish_name || raw.spanishName || raw.name,
    slug,
    category: isTrap ? 'Trampas' : (raw.category || 'Defensas'),
    maxLevel,
    maxPerTH
  };

  const targetMap = isTrap ? SUPERCELL_TRAPS : SUPERCELL_BUILDINGS;
  if (raw.data_id) {
    targetMap[raw.data_id] = entry;
  }
  if (Array.isArray(raw.secondary_data_ids)) {
    for (const secId of raw.secondary_data_ids) {
      targetMap[secId] = entry;
    }
  }
}

export const SUPERCELL_HEROES = {};
for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.home_village?.heroes || {})) {
  const { maxLevel, maxPerTH } = computeMaxPerTH(raw.levels, 100);
  const entry = {
    id: raw.id || slug,
    name: raw.name,
    spanishName: raw.spanish_name || raw.spanishName || raw.name,
    spanish_name: raw.spanish_name || raw.spanishName || raw.name,
    slug,
    category: 'Héroes',
    maxLevel,
    maxPerTH
  };
  if (raw.data_id) SUPERCELL_HEROES[raw.data_id] = entry;
}

export const SUPERCELL_SPELLS = {};
for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.home_village?.spells || {})) {
  const { maxLevel, maxPerTH } = computeMaxPerTH(raw.levels, 12);
  const entry = {
    id: raw.id || slug,
    name: raw.name,
    spanishName: raw.spanish_name || raw.spanishName || raw.name,
    spanish_name: raw.spanish_name || raw.spanishName || raw.name,
    slug,
    category: 'Hechizos',
    maxLevel,
    maxPerTH
  };
  if (raw.data_id) SUPERCELL_SPELLS[raw.data_id] = entry;
  if (Array.isArray(raw.secondary_data_ids)) {
    for (const secId of raw.secondary_data_ids) {
      SUPERCELL_SPELLS[secId] = entry;
    }
  }
}

export const SUPERCELL_UNITS = {};
for (const [slug, raw] of Object.entries(allUnitsRaw)) {
  const { maxLevel, maxPerTH } = computeMaxPerTH(raw.levels, 15);
  const entry = {
    id: raw.id || slug,
    name: raw.name,
    spanishName: raw.spanish_name || raw.spanishName || raw.name,
    spanish_name: raw.spanish_name || raw.spanishName || raw.name,
    slug,
    category: 'Tropas',
    maxLevel,
    maxPerTH
  };
  if (raw.data_id) SUPERCELL_UNITS[raw.data_id] = entry;
  if (Array.isArray(raw.secondary_data_ids)) {
    for (const secId of raw.secondary_data_ids) {
      SUPERCELL_UNITS[secId] = entry;
    }
  }
}

export const SUPERCELL_PETS = {};
for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.home_village?.pets || {})) {
  const { maxLevel, maxPerTH } = computeMaxPerTH(raw.levels, 15);
  const entry = {
    id: raw.id || slug,
    name: raw.name,
    spanishName: raw.spanish_name || raw.spanishName || raw.name,
    spanish_name: raw.spanish_name || raw.spanishName || raw.name,
    slug,
    category: 'Mascotas',
    maxLevel,
    maxPerTH
  };
  if (raw.data_id) SUPERCELL_PETS[raw.data_id] = entry;
}

export const SUPERCELL_EQUIPMENT = {};
for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.home_village?.hero_equipment || {})) {
  const { maxLevel, maxPerTH } = computeMaxPerTH(raw.levels, 27);
  const entry = {
    id: raw.id || slug,
    name: raw.name,
    spanishName: raw.spanish_name || raw.spanishName || raw.name,
    spanish_name: raw.spanish_name || raw.spanishName || raw.name,
    slug,
    category: 'Equipamiento',
    hero: raw.hero || 'General',
    maxLevel,
    maxPerTH
  };
  if (raw.data_id) SUPERCELL_EQUIPMENT[raw.data_id] = entry;
  if (Array.isArray(raw.secondary_data_ids)) {
    for (const secId of raw.secondary_data_ids) {
      SUPERCELL_EQUIPMENT[secId] = entry;
    }
  }
}

export const SUPERCELL_HELPERS = {};
for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.home_village?.helpers || {})) {
  const entry = {
    id: raw.id || slug,
    name: raw.name,
    spanishName: raw.spanish_name || raw.spanishName || raw.name,
    spanish_name: raw.spanish_name || raw.spanishName || raw.name,
    slug,
    category: 'Helpers',
    maxLevel: raw.max_level || raw.maxLevel || 8
  };
  if (raw.data_id) SUPERCELL_HELPERS[raw.data_id] = entry;
}

export const SUPERCELL_GUARDIANS = {};
for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.home_village?.guardians || {})) {
  const entry = {
    id: raw.id || slug,
    name: raw.name,
    spanishName: raw.spanish_name || raw.spanishName || raw.name,
    spanish_name: raw.spanish_name || raw.spanishName || raw.name,
    slug,
    category: 'Guardianes',
    maxLevel: raw.max_level || raw.maxLevel || 5
  };
  if (raw.data_id) SUPERCELL_GUARDIANS[raw.data_id] = entry;
}

export const SUPERCELL_BUILDER_BASE = {
  buildings: {},
  heroes: {},
  units: {}
};

for (const [idStr, raw] of Object.entries(MASTER_GAME_DATA.builder_base?.supercell_buildings || {})) {
  const numId = Number(idStr);
  SUPERCELL_BUILDER_BASE.buildings[numId] = {
    id: raw.id,
    name: raw.name,
    spanishName: raw.spanish_name || raw.spanishName || raw.name,
    spanish_name: raw.spanish_name || raw.spanishName || raw.name,
    slug: raw.slug,
    category: raw.category || 'Taller',
    maxLevel: raw.max_level || raw.maxLevel || 10
  };
}

for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.builder_base?.heroes || {})) {
  if (raw.data_id) {
    SUPERCELL_BUILDER_BASE.heroes[raw.data_id] = {
      id: raw.id || slug,
      name: raw.name,
      spanishName: raw.spanish_name || raw.spanishName || raw.name,
      spanish_name: raw.spanish_name || raw.spanishName || raw.name,
      slug,
      category: 'HéroesTaller',
      maxLevel: Object.keys(raw.levels || {}).length || 35
    };
  }
}

for (const [slug, raw] of Object.entries(MASTER_GAME_DATA.builder_base?.troops || {})) {
  if (raw.data_id) {
    SUPERCELL_BUILDER_BASE.units[raw.data_id] = {
      id: raw.id || slug,
      name: raw.name,
      spanishName: raw.spanish_name || raw.spanishName || raw.name,
      spanish_name: raw.spanish_name || raw.spanishName || raw.name,
      slug,
      category: 'TropasTaller',
      maxLevel: Object.keys(raw.levels || {}).length || 20
    };
  }
}

// ============================================================================
// 3. RESOLVEDORES MULTI-CRITERIO O(1)
// ============================================================================

/**
 * Resuelve una entidad por su ID numérico oficial de Supercell en cualquiera
 * de las categorías del juego (Village Tracker).
 */
export function resolveSupercellEntity(dataId, categoryHint = '') {
  const numId = Number(dataId);
  if (Number.isNaN(numId)) return null;

  if (SUPERCELL_BUILDINGS[numId]) return SUPERCELL_BUILDINGS[numId];
  if (SUPERCELL_TRAPS[numId]) return SUPERCELL_TRAPS[numId];
  if (SUPERCELL_HEROES[numId]) return SUPERCELL_HEROES[numId];
  if (SUPERCELL_SPELLS[numId]) return SUPERCELL_SPELLS[numId];
  if (SUPERCELL_UNITS[numId]) return SUPERCELL_UNITS[numId];
  if (SUPERCELL_PETS[numId]) return SUPERCELL_PETS[numId];
  if (SUPERCELL_EQUIPMENT[numId]) return SUPERCELL_EQUIPMENT[numId];
  if (SUPERCELL_HELPERS[numId]) return SUPERCELL_HELPERS[numId];
  if (SUPERCELL_GUARDIANS[numId]) return SUPERCELL_GUARDIANS[numId];
  if (SUPERCELL_BUILDER_BASE.buildings[numId]) return SUPERCELL_BUILDER_BASE.buildings[numId];
  if (SUPERCELL_BUILDER_BASE.heroes[numId]) return SUPERCELL_BUILDER_BASE.heroes[numId];
  if (SUPERCELL_BUILDER_BASE.units[numId]) return SUPERCELL_BUILDER_BASE.units[numId];

  return {
    id: `item_${numId}`,
    name: `Item #${numId}`,
    spanishName: `Elemento #${numId}`,
    spanish_name: `Elemento #${numId}`,
    slug: 'unknown',
    category: categoryHint || 'Varios',
    maxLevel: null
  };
}

/**
 * Resuelve cualquier entidad de Clash of Clans por Supercell ID (ej: 1000012),
 * slug ('air_defense'), o nombre ('Air Defense').
 */
export function resolveGameEntity(identifier) {
  if (identifier === null || identifier === undefined) return null;

  // Búsqueda por ID numérico de Supercell
  const numId = Number(identifier);
  if (!Number.isNaN(numId) && numId > 1000) {
    if (DEFENSES_BY_ID[numId]) return { entityType: 'structure', data: DEFENSES_BY_ID[numId] };
    if (SPELLS_BY_ID[numId]) return { entityType: 'spell', data: SPELLS_BY_ID[numId] };
    if (EQUIPMENT_BY_ID[numId]) return { entityType: 'equipment', data: EQUIPMENT_BY_ID[numId] };
    if (HEROES_BY_ID[numId]) return { entityType: 'hero', data: HEROES_BY_ID[numId] };
    if (PETS_BY_ID[numId]) return { entityType: 'pet', data: PETS_BY_ID[numId] };
    if (SIEGE_MACHINES_BY_ID[numId]) return { entityType: 'siege_machine', data: SIEGE_MACHINES_BY_ID[numId] };
    if (UNITS_BY_ID[numId]) return { entityType: 'unit', data: UNITS_BY_ID[numId] };
  }

  // Búsqueda por slug textual
  const slug = String(identifier)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (DEFENSES[slug]) return { entityType: 'structure', data: DEFENSES[slug] };
  if (SPELLS[slug]) return { entityType: 'spell', data: SPELLS[slug] };
  if (HERO_EQUIPMENT[slug]) return { entityType: 'equipment', data: HERO_EQUIPMENT[slug] };
  if (HEROES[slug]) return { entityType: 'hero', data: HEROES[slug] };
  if (PETS[slug]) return { entityType: 'pet', data: PETS[slug] };
  if (SIEGE_MACHINES[slug]) return { entityType: 'siege_machine', data: SIEGE_MACHINES[slug] };
  if (UNITS[slug]) return { entityType: 'unit', data: UNITS[slug] };

  // Base del Constructor
  if (BUILDER_BASE.structures[slug]) return { entityType: 'builder_base_structure', data: BUILDER_BASE.structures[slug] };
  if (BUILDER_BASE.troops[slug]) return { entityType: 'builder_base_troop', data: BUILDER_BASE.troops[slug] };
  if (BUILDER_BASE.heroes[slug]) return { entityType: 'builder_base_hero', data: BUILDER_BASE.heroes[slug] };

  // Capital del Clan
  if (CLAN_CAPITAL.structures[slug]) return { entityType: 'clan_capital_structure', data: CLAN_CAPITAL.structures[slug] };
  if (CLAN_CAPITAL.troops[slug]) return { entityType: 'clan_capital_troop', data: CLAN_CAPITAL.troops[slug] };
  if (CLAN_CAPITAL.spells[slug]) return { entityType: 'clan_capital_spell', data: CLAN_CAPITAL.spells[slug] };

  return null;
}

export default {
  MASTER_GAME_DATA,
  DEFENSES,
  DEFENSES_BY_ID,
  SPELLS,
  SPELLS_BY_ID,
  HERO_EQUIPMENT,
  EQUIPMENT_BY_ID,
  UNITS,
  UNITS_BY_ID,
  HEROES,
  HEROES_BY_ID,
  PETS,
  PETS_BY_ID,
  SIEGE_MACHINES,
  SIEGE_MACHINES_BY_ID,
  BUILDER_BASE,
  CLAN_CAPITAL,
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
  resolveGameEntity,
  resolveSupercellEntity
};
