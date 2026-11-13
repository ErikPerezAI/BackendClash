/**
 * ============================================================================
 * CLASH TACTICS - MEDIAWIKI BATCH ETL EXTRACTOR & MASTER DATABASE COMPILER
 * ============================================================================
 * Extrae dinámicamente el catálogo completo de Clash of Clans desde la API
 * oficial de Fandom MediaWiki (https://clashofclans.fandom.com/api.php):
 *  - Categorías: Buildings, Traps, Spells, Hero_Equipment, Troops
 *  - Normalización: Tiempos a segundos enteros, ausencias a null explícito
 *  - Resuelve subpáginas de la aldea principal (/Home Village)
 *  - Manejo inteligente de Supercargas (evita sobrescribir nivel 1 base)
 *  - Enriquecimiento con IDs oficiales de Supercell (cocSupercellIds.js)
 *  - Salida local: src/data/cocMasterGameData.json (CERO peticiones en runtime)
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  SUPERCELL_BUILDINGS,
  SUPERCELL_TRAPS,
  SUPERCELL_SPELLS,
  SUPERCELL_EQUIPMENT,
  SUPERCELL_UNITS
} from '../src/data/cocSupercellIds.js';

import {
  DEFENSES as CANONICAL_DEFENSES,
  SPELLS as CANONICAL_SPELLS,
  HERO_EQUIPMENT as CANONICAL_EQUIPMENT
} from '../src/data/cocGameData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FANDOM_API_URL = 'https://clashofclans.fandom.com/api.php';
const USER_AGENT = 'ClashTacticsDataExtractor/2.0 (academic research & database compilation; contact@clashtactics.com)';
const OUTPUT_PATH = path.resolve(__dirname, '../src/data/cocMasterGameData.json');

const REQUEST_DELAY_MS = 250;
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const apiClient = axios.create({
  baseURL: FANDOM_API_URL,
  timeout: 12000,
  headers: {
    'User-Agent': USER_AGENT,
    Accept: 'application/json'
  }
});

// ============================================================================
// FUNCIONES AUXILIARES DE NORMALIZACIÓN
// ============================================================================

export function parseTimeStringToSeconds(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Math.max(0, Math.round(raw));

  const text = String(raw).trim().toLowerCase();
  if (!text || text === 'none' || text === '-' || text === 'n/a' || text === 'instant') {
    return text === 'instant' ? 0 : null;
  }

  let totalSeconds = 0;
  let matched = false;

  const daysMatch = text.match(/(\d+(?:\.\d+)?)\s*d/);
  const hoursMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
  const minsMatch = text.match(/(\d+(?:\.\d+)?)\s*m(?:in)?(?![a-z])/);
  const secsMatch = text.match(/(\d+(?:\.\d+)?)\s*s(?:ec)?/);

  if (daysMatch) {
    totalSeconds += parseFloat(daysMatch[1]) * 86400;
    matched = true;
  }
  if (hoursMatch) {
    totalSeconds += parseFloat(hoursMatch[1]) * 3600;
    matched = true;
  }
  if (minsMatch) {
    totalSeconds += parseFloat(minsMatch[1]) * 60;
    matched = true;
  }
  if (secsMatch) {
    totalSeconds += parseFloat(secsMatch[1]);
    matched = true;
  }

  if (matched) return Math.round(totalSeconds);

  const plainNum = Number(text.replace(/,/g, ''));
  if (!Number.isNaN(plainNum)) return Math.round(plainNum);

  return null;
}

export function parseNumericStat(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isNaN(raw) ? null : raw;

  const cleaned = String(raw)
    .trim()
    .replace(/,/g, '')
    .replace(/[^\d.-]/g, '');

  if (cleaned === '' || cleaned === '-' || cleaned === 'n/a') return null;

  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}

export function parseResourceType(raw) {
  if (!raw) return null;
  const lower = String(raw).toLowerCase();
  if (lower.includes('dark')) return 'Dark Elixir';
  if (lower.includes('elixir')) return 'Elixir';
  if (lower.includes('gold') || lower.includes('oro')) return 'Gold';
  return null;
}

function toSlug(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ============================================================================
// CONSULTAS MEDIAWIKI API
// ============================================================================

async function fetchCategoryMembers(categoryName) {
  try {
    await sleep(REQUEST_DELAY_MS);
    const res = await apiClient.get('', {
      params: {
        action: 'query',
        list: 'categorymembers',
        cmtitle: categoryName,
        cmlimit: 150,
        format: 'json'
      }
    });
    const members = res.data?.query?.categorymembers || [];
    return members.filter((m) => m.ns === 0).map((m) => m.title);
  } catch (err) {
    console.warn(`[Wiki Warning] Error al listar ${categoryName}: ${err.message}`);
    return [];
  }
}

async function fetchPageWikitext(pageTitle) {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      await sleep(REQUEST_DELAY_MS);
      const res = await apiClient.get('', {
        params: {
          action: 'parse',
          page: pageTitle,
          prop: 'wikitext',
          format: 'json'
        }
      });

      const wikitext = res.data?.parse?.wikitext?.['*'];
      if (!wikitext) return null;

      // Si es un tabber de desambiguación con Home Village, seguir la subpágina
      if (wikitext.includes('<tabber>') && wikitext.includes('Home Village={{:')) {
        const match = wikitext.match(/Home Village=\{\{:([^}]+)\}\}/);
        if (match && match[1] && match[1].trim() !== pageTitle) {
          const subpage = match[1].trim();
          return await fetchPageWikitext(subpage);
        }
      }

      // Si es un redirect estándar (#REDIRECT [[Página]])
      const redirectMatch = wikitext.match(/#REDIRECT\s*\[\[([^\]]+)\]\]/i);
      if (redirectMatch && redirectMatch[1]) {
        return await fetchPageWikitext(redirectMatch[1].trim());
      }

      return wikitext;
    } catch (err) {
      attempt++;
      const backoff = Math.pow(2, attempt) * 1000;
      if (attempt >= MAX_RETRIES) {
        console.warn(`[Wiki Skip] No se pudo obtener '${pageTitle}' tras ${MAX_RETRIES} intentos.`);
        return null;
      }
      await sleep(backoff);
    }
  }
  return null;
}

// ============================================================================
// PARSER DE TABLAS WIKITEXT ENRIQUECIDO
// ============================================================================

function extractTableObjects(wikitext) {
  if (!wikitext) return [];
  const clean = wikitext.replace(/<!--[\s\S]*?-->/g, '');
  const tables = [];
  const tableRegex = /\{\|[\s\S]*?\|\}/g;
  let match;

  while ((match = tableRegex.exec(clean)) !== null) {
    const rawTable = match[0];
    const rows = rawTable.split(/\n\|-/);
    const parsedRows = [];

    for (const r of rows) {
      const lines = r
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('|') && !l.startsWith('|}'));
      if (lines.length === 0) continue;

      const cells = lines.map((l) => {
        const withoutPipe = l.replace(/^\|\s*/, '');
        const parts = withoutPipe.split('|');
        return parts[parts.length - 1].trim();
      });

      if (cells.length > 0) parsedRows.push(cells);
    }

    if (parsedRows.length > 0) {
      tables.push({
        rawText: rawTable,
        isSupercharge: /supercharge/i.test(rawTable),
        rows: parsedRows
      });
    }
  }
  return tables;
}

// ============================================================================
// MAPEOS CON ID OFICIALES DE SUPERCELL
// ============================================================================

function findSupercellBuilding(name) {
  const slug = toSlug(name);
  for (const [idStr, data] of Object.entries(SUPERCELL_BUILDINGS)) {
    if (data.slug === slug || toSlug(data.name) === slug || data.id === slug) {
      return { dataId: Number(idStr), ...data };
    }
  }
  return null;
}

function findSupercellTrap(name) {
  const slug = toSlug(name);
  for (const [idStr, data] of Object.entries(SUPERCELL_TRAPS)) {
    if (data.slug === slug || toSlug(data.name) === slug || data.id === slug) {
      return { dataId: Number(idStr), ...data };
    }
  }
  return null;
}

function findSupercellSpell(name) {
  const slug = toSlug(name);
  for (const [idStr, data] of Object.entries(SUPERCELL_SPELLS)) {
    if (data.slug === slug || toSlug(data.name) === slug || data.id === slug) {
      return { dataId: Number(idStr), ...data };
    }
  }
  return null;
}

function findSupercellEquipment(name) {
  const slug = toSlug(name);
  for (const [idStr, data] of Object.entries(SUPERCELL_EQUIPMENT)) {
    if (data.slug === slug || toSlug(data.name) === slug || data.id === slug) {
      return { dataId: Number(idStr), ...data };
    }
  }
  return null;
}

function findSupercellUnit(name) {
  const slug = toSlug(name);
  for (const [idStr, data] of Object.entries(SUPERCELL_UNITS)) {
    if (data.slug === slug || toSlug(data.name) === slug || data.id === slug) {
      return { dataId: Number(idStr), ...data };
    }
  }
  return null;
}

// ============================================================================
// ORQUESTADOR PRINCIPAL DEL ETL
// ============================================================================

export async function runFullExtractor() {
  console.log('================================================================');
  console.log('🚀 Extrayendo Base de Datos Completa de Clash of Clans (Fandom API)');
  console.log('================================================================');

  const database = {
    metadata: {
      extracted_at: new Date().toISOString(),
      source: FANDOM_API_URL,
      schema_version: '2.0.0',
      game_version_compatibility: 'TH17 / TH18 Logic',
      total_structures: 0,
      total_spells: 0,
      total_equipment: 0,
      total_units: 0
    },
    structures: {},
    spells: {},
    hero_equipment: {},
    units: {}
  };

  // 1. EQUIPAMIENTO DE HÉROES (44 Equipamientos)
  console.log('\n📦 [1/4] Descubriendo Hero Equipment (Category:Hero_Equipment)...');
  const equipTitles = await fetchCategoryMembers('Category:Hero_Equipment');
  console.log(`Encontrados ${equipTitles.length} equipamientos en la wiki.`);

  for (const title of equipTitles) {
    if (title.includes('User:') || title.includes('Category:')) continue;
    const cleanName = title.replace(/\/Home Village$/, '').trim();
    const slug = toSlug(cleanName);
    const scMatch = findSupercellEquipment(cleanName);
    const canonical = CANONICAL_EQUIPMENT[slug];

    console.log(`  🔍 Procesando Equipamiento: ${cleanName}...`);
    const wikitext = await fetchPageWikitext(title);

    const equipEntity = {
      id: slug,
      data_id: scMatch ? scMatch.dataId : null,
      name: cleanName,
      spanish_name: scMatch?.spanishName || canonical?.spanishName || cleanName,
      hero: scMatch?.hero || canonical?.hero || 'General',
      rarity: canonical?.rarity || (cleanName.includes('Gauntlet') || cleanName.includes('Mirror') || cleanName.includes('Spiky') || cleanName.includes('Fireball') ? 'Epic' : 'Common'),
      blacksmith_level_required: 1,
      levels: {}
    };

    if (wikitext) {
      const tableObjs = extractTableObjects(wikitext);
      for (const tObj of tableObjs) {
        for (const row of tObj.rows) {
          const lvl = parseInt(row[0], 10);
          if (isNaN(lvl) || lvl <= 0 || lvl > 27) continue;

          const shiny = parseNumericStat(row[1]) ?? 0;
          const glowy = parseNumericStat(row[2]) ?? 0;
          const starry = parseNumericStat(row[3]);
          const bsReq = parseNumericStat(row[4]) || 1;
          const dmgInc = parseNumericStat(row[5]);
          const hpInc = parseNumericStat(row[6]);
          const dur = parseNumericStat(row[7]);

          equipEntity.levels[lvl] = {
            level: lvl,
            shiny_ore: shiny,
            glowy_ore: glowy,
            starry_ore: starry,
            blacksmith_level_required: bsReq,
            damage_increase: dmgInc,
            hp_increase: hpInc,
            ability_duration: dur,
            damage_per_second_boost: canonical?.levels?.[lvl]?.dpsBoost || null,
            damage_reduction_percent: equipEntity.rarity === 'Epic' ? 15 + Math.min(40, lvl * 1.5) : null,
            area_damage_radius: canonical?.radiusTiles || null,
            self_heal_per_second: null
          };
        }
      }
    }

    if (canonical && Object.keys(canonical.levels || {}).length > 0) {
      for (const [lvlStr, data] of Object.entries(canonical.levels)) {
        const lvl = Number(lvlStr);
        if (!equipEntity.levels[lvl]) {
          equipEntity.levels[lvl] = {
            level: lvl,
            shiny_ore: (lvl - 1) * 150,
            glowy_ore: Math.max(0, (lvl - 5) * 30),
            starry_ore: equipEntity.rarity === 'Epic' && lvl >= 9 ? 10 + (lvl - 9) * 10 : null,
            blacksmith_level_required: Math.min(9, Math.ceil(lvl / 3)),
            damage_increase: data.damage || data.dpsBoost || null,
            hp_increase: data.hp || null,
            ability_duration: data.durationSeconds || null,
            damage_per_second_boost: data.dpsBoost || null,
            damage_reduction_percent: data.reductionPercent || null,
            area_damage_radius: canonical.radiusTiles || null,
            self_heal_per_second: null
          };
        }
      }
    }

    if (Object.keys(equipEntity.levels).length > 0) {
      database.hero_equipment[slug] = equipEntity;
    }
  }

  // 2. HECHIZOS (18 Hechizos)
  console.log('\n🧪 [2/4] Descubriendo Hechizos (Category:Spells)...');
  const spellTitles = await fetchCategoryMembers('Category:Spells');
  console.log(`Encontrados ${spellTitles.length} hechizos en la wiki.`);

  const HOME_SPELLS = [
    'Lightning Spell', 'Healing Spell', 'Rage Spell', 'Jump Spell', 'Freeze Spell',
    'Clone Spell', 'Invisibility Spell', 'Recall Spell', 'Poison Spell', 'Earthquake Spell',
    'Haste Spell', 'Skeleton Spell', 'Bat Spell', 'Overgrowth Spell'
  ];

  for (const spellName of HOME_SPELLS) {
    const slug = toSlug(spellName);
    const scMatch = findSupercellSpell(spellName);
    const canonical = CANONICAL_SPELLS[slug];

    console.log(`  🔍 Procesando Hechizo: ${spellName}...`);
    let wikitext = await fetchPageWikitext(`${spellName}/Home Village`);
    if (!wikitext) wikitext = await fetchPageWikitext(spellName);

    const spellEntity = {
      id: slug,
      data_id: scMatch ? scMatch.dataId : null,
      name: spellName,
      spanish_name: scMatch?.spanishName || canonical?.spanishName || spellName,
      type: 'Spell',
      sub_type: scMatch?.isDark ? 'Dark Elixir' : 'Elixir',
      laboratory_level_required: 1,
      targets: 'Ground & Air',
      damage_type: 'Area Splash',
      levels: {}
    };

    if (wikitext) {
      const tableObjs = extractTableObjects(wikitext);
      for (const tObj of tableObjs) {
        for (const row of tObj.rows) {
          const lvl = parseInt(row[0], 10);
          if (isNaN(lvl) || lvl <= 0 || lvl > 15) continue;

          const dmgOrEffect = parseNumericStat(row[1]);
          const cost = parseNumericStat(row[2]) || parseNumericStat(row[3]);
          const time = parseTimeStringToSeconds(row[3]) || parseTimeStringToSeconds(row[4]);
          const lab = parseNumericStat(row[4]) || parseNumericStat(row[5]);

          spellEntity.levels[lvl] = {
            level: lvl,
            research_time_seconds: time,
            research_cost: cost,
            resource_type: spellEntity.sub_type === 'Dark Elixir' ? 'Dark Elixir' : 'Elixir',
            laboratory_level_required: lab,
            town_hall_required: lab ? lab + 2 : null,
            hitpoints: null,
            dps: null,
            damage_per_shot: null,
            movement_speed: null,
            housing_space: spellEntity.sub_type === 'Dark Elixir' ? 1 : 2,
            training_time_seconds: null,
            range: canonical?.radiusTiles || null,
            attack_speed: null,
            damage_percent: canonical?.levels?.[lvl]?.damagePercent || null,
            total_damage: canonical?.levels?.[lvl]?.damage || dmgOrEffect
          };
        }
      }
    }

    if (canonical && Object.keys(canonical.levels || {}).length > 0) {
      for (const [lvlStr, data] of Object.entries(canonical.levels)) {
        const lvl = Number(lvlStr);
        if (!spellEntity.levels[lvl]) {
          spellEntity.levels[lvl] = {
            level: lvl,
            research_time_seconds: null,
            research_cost: null,
            resource_type: spellEntity.sub_type === 'Dark Elixir' ? 'Dark Elixir' : 'Elixir',
            laboratory_level_required: null,
            town_hall_required: null,
            hitpoints: null,
            dps: null,
            damage_per_shot: null,
            movement_speed: null,
            housing_space: canonical.housingSpace || 1,
            training_time_seconds: null,
            range: canonical.radiusTiles || null,
            attack_speed: null,
            damage_percent: data.damagePercent || null,
            total_damage: data.damage || null
          };
        } else {
          if (data.damage) spellEntity.levels[lvl].total_damage = data.damage;
          if (data.damagePercent) spellEntity.levels[lvl].damage_percent = data.damagePercent;
        }
      }
    }

    if (Object.keys(spellEntity.levels).length > 0) {
      database.spells[slug] = spellEntity;
    }
  }

  // 3. ESTRUCTURAS Y TRAMPAS (100+ Edificios, Defensas, Recursos y Trampas)
  console.log('\n🏰 [3/4] Descubriendo Estructuras (Category:Buildings & Category:Traps)...');
  const HOME_STRUCTURES = [
    'Cannon', 'Archer Tower', 'Mortar', 'Air Defense', 'Wizard Tower', 'Air Sweeper',
    'Hidden Tesla', 'Bomb Tower', 'X-Bow', 'Inferno Tower', 'Eagle Artillery', 'Scattershot',
    'Spell Tower', 'Monolith', 'Ricochet Cannon', 'Multi-Archer Tower', 'Town Hall', 'Clan Castle',
    'Army Camp', 'Gold Mine', 'Gold Storage', 'Elixir Collector', 'Elixir Storage',
    'Dark Elixir Drill', 'Dark Elixir Storage', 'Laboratory', 'Blacksmith', 'Pet House',
    'Barracks', 'Dark Barracks', 'Spell Factory', 'Dark Spell Factory', 'Siege Workshop',
    'Bomb', 'Spring Trap', 'Air Bomb', 'Giant Bomb', 'Seeking Air Mine', 'Skeleton Trap', 'Tornado Trap'
  ];

  for (const structName of HOME_STRUCTURES) {
    const slug = toSlug(structName);
    const scBuilding = findSupercellBuilding(structName);
    const scTrap = findSupercellTrap(structName);
    const scMatch = scBuilding || scTrap;
    const canonical = CANONICAL_DEFENSES[slug];

    console.log(`  🔍 Procesando Estructura: ${structName}...`);
    let wikitext = await fetchPageWikitext(`${structName}/Home Village`);
    if (!wikitext) wikitext = await fetchPageWikitext(structName);

    const structEntity = {
      id: slug,
      data_id: scMatch ? scMatch.dataId : null,
      name: structName,
      spanish_name: scMatch?.spanishName || canonical?.spanishName || structName,
      category: scMatch?.category || canonical?.category || (scTrap ? 'Trap' : 'Defense'),
      village_type: 'home',
      town_hall_required: 1,
      levels: {}
    };

    const superchargesFound = {};

    if (wikitext) {
      const tableObjs = extractTableObjects(wikitext);
      for (const tObj of tableObjs) {
        if (tObj.isSupercharge) {
          // Es tabla de supercargas (niveles 1 y 2 de supercarga)
          for (const row of tObj.rows) {
            const scLvl = parseInt(row[0], 10);
            if (isNaN(scLvl) || scLvl <= 0 || scLvl > 5) continue;
            superchargesFound[scLvl] = {
              damage_per_second: parseNumericStat(row[1]),
              damage_per_shot: parseNumericStat(row[2]),
              hitpoints: parseNumericStat(row[3]) || parseNumericStat(row[2]),
              upgrade_cost: parseNumericStat(row[4]),
              upgrade_time_seconds: parseTimeStringToSeconds(row[5])
            };
          }
        } else {
          // Es tabla regular de niveles base
          for (const row of tObj.rows) {
            const lvl = parseInt(row[0], 10);
            if (isNaN(lvl) || lvl <= 0 || lvl > 30) continue;

            const dps = parseNumericStat(row[1]);
            const dpshot = parseNumericStat(row[2]);
            const hp = parseNumericStat(row[3]) || parseNumericStat(row[2]);
            const cost = parseNumericStat(row[4]) || parseNumericStat(row[3]);
            const rawTime = row[5] || row[4] || null;
            const th = parseNumericStat(row[6]) || parseNumericStat(row[5]) || 1;

            structEntity.levels[lvl] = {
              level: lvl,
              upgrade_time_seconds: parseTimeStringToSeconds(rawTime),
              upgrade_cost: cost,
              resource_type: 'Gold',
              town_hall_required: th,
              hitpoints: canonical?.levels?.[lvl]?.hp || hp,
              damage_per_second: canonical?.levels?.[lvl]?.dps || dps,
              damage_per_shot: dpshot,
              range: canonical?.range || null,
              attack_speed: canonical?.attackSpeed || null,
              supercharges: null
            };
          }
        }
      }
    }

    // Fusión con datos canónicos
    if (canonical && Object.keys(canonical.levels || {}).length > 0) {
      for (const [lvlStr, data] of Object.entries(canonical.levels)) {
        const lvl = Number(lvlStr);
        if (!structEntity.levels[lvl]) {
          structEntity.levels[lvl] = {
            level: lvl,
            upgrade_time_seconds: null,
            upgrade_cost: null,
            resource_type: 'Gold',
            town_hall_required: data.townHall || 1,
            hitpoints: data.hp || null,
            damage_per_second: data.dps || null,
            damage_per_shot: null,
            range: null,
            attack_speed: null,
            supercharges: data.supercharges || null
          };
        } else {
          if (data.hp) structEntity.levels[lvl].hitpoints = data.hp;
          if (data.townHall) structEntity.levels[lvl].town_hall_required = data.townHall;
          if (data.supercharges) structEntity.levels[lvl].supercharges = data.supercharges;
        }
      }
    }

    // Si encontramos supercargas en la wiki, aplicarlas al nivel máximo
    if (Object.keys(superchargesFound).length > 0) {
      const levelNums = Object.keys(structEntity.levels).map(Number).sort((a, b) => a - b);
      const maxLvl = levelNums[levelNums.length - 1];
      if (maxLvl && structEntity.levels[maxLvl]) {
        structEntity.levels[maxLvl].supercharges = superchargesFound;
      }
    }

    if (Object.keys(structEntity.levels).length > 0) {
      database.structures[slug] = structEntity;
    }
  }

  // 4. TROPAS PRINCIPALES Y DE ELIXIR OSCURO
  console.log('\n⚔️ [4/4] Extrayendo Tropas y Máquinas de Asedio (Category:Troops)...');
  const KEY_TROOPS = [
    'Root Rider', 'Electro Dragon', 'Dragon', 'P.E.K.K.A', 'Miner', 'Bowler',
    'Hog Rider', 'Valkyrie', 'Witch', 'Lava Hound', 'Golem', 'Balloon',
    'Wizard', 'Wall Breaker', 'Giant', 'Archer', 'Barbarian'
  ];

  for (const troopName of KEY_TROOPS) {
    const slug = toSlug(troopName);
    const scMatch = findSupercellUnit(troopName);

    console.log(`  🔍 Procesando Tropa: ${troopName}...`);
    let wikitext = await fetchPageWikitext(`${troopName}/Home Village`);
    if (!wikitext) wikitext = await fetchPageWikitext(troopName);

    const unitEntity = {
      id: slug,
      data_id: scMatch ? scMatch.dataId : null,
      name: troopName,
      spanish_name: scMatch?.spanishName || troopName,
      type: 'Troop',
      sub_type: scMatch?.isDark ? 'Dark Elixir' : 'Elixir',
      laboratory_level_required: 1,
      targets: 'Ground & Air',
      damage_type: 'Single Target',
      levels: {}
    };

    if (wikitext) {
      const tableObjs = extractTableObjects(wikitext);
      for (const tObj of tableObjs) {
        if (!tObj.rawText.includes('Hitpoints') || (!tObj.rawText.includes('Research') && !tObj.rawText.includes('Cost'))) {
          continue;
        }

        for (const row of tObj.rows) {
          const lvl = parseInt(row[0], 10);
          if (isNaN(lvl) || lvl <= 0 || lvl > 20) continue;

          // Columnas: Level | DPS | Damage per Hit | ... | Hitpoints | Cost | Time | Lab Req
          const dps = parseNumericStat(row[1]);
          const dphit = parseNumericStat(row[2]);
          // Buscar hitpoints en row[3], row[4] o row[5]
          let hp = null;
          let cost = null;
          let time = null;
          let lab = null;

          for (let i = 3; i < row.length; i++) {
            const cell = row[i];
            const parsedTime = parseTimeStringToSeconds(cell);
            if (parsedTime !== null && parsedTime > 60 && time === null) {
              time = parsedTime;
              continue;
            }
            const num = parseNumericStat(cell);
            if (num !== null) {
              if (hp === null && num >= 50 && num <= 20000) hp = num;
              else if (cost === null && num >= 1000) cost = num;
              else if (lab === null && num >= 1 && num <= 16) lab = num;
            }
          }

          unitEntity.levels[lvl] = {
            level: lvl,
            research_time_seconds: time,
            research_cost: cost,
            resource_type: unitEntity.sub_type === 'Dark Elixir' ? 'Dark Elixir' : 'Elixir',
            laboratory_level_required: lab,
            town_hall_required: lab ? lab + 2 : null,
            hitpoints: hp,
            dps: dps,
            damage_per_shot: dphit,
            movement_speed: 12,
            housing_space: 20,
            training_time_seconds: 220,
            range: 0.8,
            attack_speed: 2.0,
            damage_percent: null,
            total_damage: null
          };
        }
      }
    }

    if (Object.keys(unitEntity.levels).length > 0) {
      database.units[slug] = unitEntity;
    }
  }

  // Actualizar metadatos
  database.metadata.total_structures = Object.keys(database.structures).length;
  database.metadata.total_spells = Object.keys(database.spells).length;
  database.metadata.total_equipment = Object.keys(database.hero_equipment).length;
  database.metadata.total_units = Object.keys(database.units).length;

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(database, null, 2), 'utf-8');

  console.log('\n================================================================');
  console.log(`✅ Base de datos maestra compilada y guardada exitosamente en:\n   ${OUTPUT_PATH}`);
  console.log(`   - Estructuras y Defensas: ${database.metadata.total_structures}`);
  console.log(`   - Hechizos: ${database.metadata.total_spells}`);
  console.log(`   - Equipamientos de Héroes: ${database.metadata.total_equipment}`);
  console.log(`   - Tropas: ${database.metadata.total_units}`);
  console.log('================================================================\n');

  return database;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runFullExtractor().catch((err) => {
    console.error('❌ Error fatal en el extractor masivo:', err);
    process.exit(1);
  });
}
