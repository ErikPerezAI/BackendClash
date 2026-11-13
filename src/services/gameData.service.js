/**
 * Servicio de datos del juego de Clash of Clans.
 * Conecta los datos estáticos de balance con las URLs oficiales de imágenes WebP.
 */

import {
  DEFENSES,
  DEFENSES_BY_ID,
  SPELLS,
  SPELLS_BY_ID,
  HERO_EQUIPMENT,
  EQUIPMENT_BY_ID,
  resolveGameEntity
} from '../data/cocGameData.js';
import { cleanAssetName } from '../utils/assets.util.js';

const ASSETS_BASE = process.env.COC_ASSETS_BASE_URL || 'https://raw.githubusercontent.com/ClashKingInc/ClashKingAssets/main/assets';

/**
 * Mapeo de carpetas de edificios en ClashKingAssets que difieren del ID interno (ej. guiones)
 */
const BUILDING_FOLDER_MAP = {
  x_bow: 'x-bow',
  multi_archer_tower: 'multi-archer_tower',
  cake_a_pult: 'cake-a-pult'
};

const getBuildingFolder = (id) => BUILDING_FOLDER_MAP[id] || id;

/**
 * Obtiene la lista resumida de todas las defensas y estructuras con su rango de niveles
 */
export const getAllDefenses = () => {
  return Object.values(DEFENSES).map((defense) => {
    const levelKeys = Object.keys(defense.levels).map(Number).sort((a, b) => a - b);
    const minLevel = levelKeys[0];
    const maxLevel = levelKeys[levelKeys.length - 1];
    const folder = getBuildingFolder(defense.id);
    const levelsSummary = levelKeys.map((lvl) => {
      const lData = defense.levels[lvl] || {};
      const scKeys = lData.supercharges ? Object.keys(lData.supercharges).map(Number).sort((a, b) => a - b) : [];
      return {
        level: lvl,
        hp: lData.hp,
        dps: lData.dps ?? null,
        thRequired: lData.thRequired ?? null,
        supercharges: scKeys.map((sc) => ({
          level: sc,
          hp: lData.supercharges[sc]?.hp ?? lData.hp,
          dps: lData.supercharges[sc]?.dps ?? lData.dps ?? null
        }))
      };
    });

    return {
      id: defense.id,
      name: defense.name,
      spanishName: defense.spanishName,
      category: defense.category,
      minLevel,
      maxLevel,
      imageUrl: `${ASSETS_BASE}/buildings/home-village/${folder}/level_${maxLevel}.webp`,
      levelsSummary
    };
  });
};

/**
 * Obtiene el detalle de una defensa, opcionalmente filtrando por un nivel específico y supercarga
 */
export const getDefenseById = (id, level = null, supercharge = null) => {
  const numId = Number(id);
  const defense = (!Number.isNaN(numId) && DEFENSES_BY_ID[numId])
    ? DEFENSES_BY_ID[numId]
    : DEFENSES[cleanAssetName(id)];
  if (!defense) return null;

  const folder = getBuildingFolder(defense.id);

  if (level !== null && level !== undefined) {
    let lvlNum = Number(level);
    // Para defensas crafteadas (donde a veces se consulta el nivel de la estructura 3-30 en vez del módulo 1-10)
    if (!defense.levels[lvlNum] && defense.category === 'crafted_defense') {
      if (lvlNum >= 3 && lvlNum <= 30) {
        const mapped = Math.min(10, Math.max(1, Math.round(1 + ((lvlNum - 3) / 27) * 9)));
        if (defense.levels[mapped]) lvlNum = mapped;
      }
    }
    const levelData = defense.levels[lvlNum];
    if (!levelData) return null;

    let finalHp = levelData.hp;
    let finalDps = levelData.dps;
    let activeSc = null;

    if (supercharge !== null && supercharge !== undefined && levelData.supercharges) {
      const scNum = Number(supercharge);
      const scData = levelData.supercharges[scNum];
      if (scData) {
        activeSc = scNum;
        if (scData.hp !== undefined) finalHp = scData.hp;
        if (scData.dps !== undefined) finalDps = scData.dps;
      }
    }

    return {
      id: defense.id,
      name: defense.name,
      spanishName: defense.spanishName,
      category: defense.category,
      level: lvlNum,
      ...levelData,
      hp: finalHp,
      ...(finalDps !== undefined ? { dps: finalDps } : {}),
      ...(activeSc ? { activeSupercharge: activeSc } : {}),
      imageUrl: `${ASSETS_BASE}/buildings/home-village/${folder}/level_${lvlNum}.webp`
    };
  }

  // Si no se especificó nivel, devolver toda la tabla enriquecida con imágenes por nivel
  const enrichedLevels = {};
  for (const [lvl, data] of Object.entries(defense.levels)) {
    enrichedLevels[lvl] = {
      ...data,
      imageUrl: `${ASSETS_BASE}/buildings/home-village/${folder}/level_${lvl}.webp`
    };
  }

  return {
    id: defense.id,
    name: defense.name,
    spanishName: defense.spanishName,
    category: defense.category,
    levels: enrichedLevels
  };
};

/**
 * Obtiene la lista de todos los hechizos disponibles
 */
export const getAllSpells = () => {
  return Object.values(SPELLS).map((spell) => {
    const levelKeys = Object.keys(spell.levels).map(Number).sort((a, b) => a - b);
    const minLevel = levelKeys[0];
    const maxLevel = levelKeys[levelKeys.length - 1];
    const slug = cleanAssetName(spell.name);

    return {
      id: spell.id,
      name: spell.name,
      spanishName: spell.spanishName,
      housingSpace: spell.housingSpace,
      radiusTiles: spell.radiusTiles,
      type: spell.type,
      minLevel,
      maxLevel,
      imageUrl: `${ASSETS_BASE}/spells/${slug}.webp`
    };
  });
};

/**
 * Obtiene el detalle de un hechizo por ID y opcionalmente por nivel
 */
export const getSpellById = (id, level = null) => {
  const numId = Number(id);
  const spell = (!Number.isNaN(numId) && SPELLS_BY_ID[numId])
    ? SPELLS_BY_ID[numId]
    : SPELLS[cleanAssetName(id)];
  if (!spell) return null;

  const slug = cleanAssetName(spell.name);

  if (level !== null && level !== undefined) {
    const lvlNum = Number(level);
    const levelData = spell.levels[lvlNum];
    if (!levelData) return null;

    return {
      id: spell.id,
      name: spell.name,
      spanishName: spell.spanishName,
      housingSpace: spell.housingSpace,
      radiusTiles: spell.radiusTiles,
      type: spell.type,
      level: lvlNum,
      ...levelData,
      imageUrl: `${ASSETS_BASE}/spells/${slug}.webp`
    };
  }

  return {
    ...spell,
    imageUrl: `${ASSETS_BASE}/spells/${slug}.webp`
  };
};

/**
 * Obtiene la lista de todos los equipamientos heroicos
 */
export const getAllEquipment = () => {
  return Object.values(HERO_EQUIPMENT).map((eq) => {
    const slug = cleanAssetName(eq.name);

    return {
      id: eq.id,
      name: eq.name,
      spanishName: eq.spanishName,
      hero: eq.hero,
      rarity: eq.rarity,
      maxLevel: eq.maxLevel,
      type: eq.type,
      description: eq.description,
      imageUrl: `${ASSETS_BASE}/equipment/${slug}.webp`
    };
  });
};

/**
 * Obtiene el detalle de un equipamiento heroico por ID y opcionalmente por nivel
 */
export const getEquipmentById = (id, level = null) => {
  const numId = Number(id);
  const eq = (!Number.isNaN(numId) && EQUIPMENT_BY_ID[numId])
    ? EQUIPMENT_BY_ID[numId]
    : HERO_EQUIPMENT[cleanAssetName(id)];
  if (!eq) return null;

  const slug = cleanAssetName(eq.name);

  if (level !== null && level !== undefined) {
    const lvlNum = Number(level);
    const levelData = eq.levels[lvlNum];
    if (!levelData) return null;

    return {
      id: eq.id,
      name: eq.name,
      spanishName: eq.spanishName,
      hero: eq.hero,
      rarity: eq.rarity,
      type: eq.type,
      level: lvlNum,
      ...levelData,
      imageUrl: `${ASSETS_BASE}/equipment/${slug}.webp`
    };
  }

  return {
    ...eq,
    imageUrl: `${ASSETS_BASE}/equipment/${slug}.webp`
  };
};

