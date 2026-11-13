/**
 * ============================================================================
 * CLASH TACTICS - MEDIAWIKI BATCH ETL EXTRACTOR & MASTER DATABASE COMPILER V3.0
 * ============================================================================
 * Extrae dinámicamente el catálogo 100% COMPLETO de Clash of Clans desde la API
 * oficial de Fandom MediaWiki (https://clashofclans.fandom.com/api.php):
 *  1. Home Village (Aldea Principal):
 *     - Estructuras (Defensas, Recursos, Ejército, Otras, Trampas)
 *     - Tropas de Laboratorio (Elixir y Elixir Oscuro)
 *     - Super Tropas
 *     - Héroes (con estadísticas de niveles hasta TH18 / Hero Hall)
 *     - Equipamientos Heroicos (con costes de minerales y bonus exactos)
 *     - Hechizos (Elixir y Oscuros)
 *     - Máquinas de Asedio
 *     - Mascotas (Pets)
 *  2. Builder Base (Base del Constructor):
 *     - Estructuras (Defensas, Recursos, Ejército, Trampas)
 *     - Tropas de Base del Constructor
 *     - Héroes (Battle Machine, Battle Copter)
 *  3. Other (Clan Capital / Capital del Clan):
 *     - Estructuras y Defensas
 *     - Tropas
 *     - Hechizos
 *
 * Normalización:
 *  - Tiempos a segundos enteros
 *  - Costes a enteros
 *  - Detección de tipos de recursos (Gold, Elixir, Dark Elixir, Builder Gold/Elixir, Capital Gold, Ores)
 *  - Enriquecimiento con IDs oficiales de Supercell (cocSupercellIds.js)
 *  - Compatibilidad total hacia atrás con cocGameData.js y endpoints
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  SUPERCELL_BUILDINGS,
  SUPERCELL_TRAPS,
  SUPERCELL_HEROES,
  SUPERCELL_SPELLS,
  SUPERCELL_UNITS,
  SUPERCELL_PETS,
  SUPERCELL_EQUIPMENT,
  SUPERCELL_BUILDER_BASE
} from '../src/data/cocSupercellIds.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FANDOM_API_URL = 'https://clashofclans.fandom.com/api.php';
const USER_AGENT = 'ClashTacticsDataExtractor/3.0 (academic research & db compiler; contact@clashtactics.com)';
const OUTPUT_PATH = path.resolve(__dirname, '../src/data/cocMasterGameData.json');
const CACHE_DIR = path.resolve(__dirname, '.wiki_cache');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const apiClient = axios.create({
  baseURL: FANDOM_API_URL,
  timeout: 20000,
  headers: {
    'User-Agent': USER_AGENT,
    Accept: 'application/json'
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// NORMALIZACIÓN
// ============================================================================

export function toSlug(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/\/home village$|\/builder base$|\/clan capital$/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function parseTimeToSeconds(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Math.max(0, Math.round(raw));

  const text = String(raw).trim().toLowerCase();
  if (!text || ['none', '-', 'n/a', ''].includes(text)) return null;
  if (text === 'instant' || text === '0') return 0;

  let totalSeconds = 0;
  let matched = false;

  const daysMatch = text.match(/(\d+(?:\.\d+)?)\s*d/);
  const hoursMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
  const minsMatch = text.match(/(\d+(?:\.\d+)?)\s*m(?:in)?(?![a-z])/);
  const secsMatch = text.match(/(\d+(?:\.\d+)?)\s*s(?:ec)?/);

  if (daysMatch) { totalSeconds += parseFloat(daysMatch[1]) * 86400; matched = true; }
  if (hoursMatch) { totalSeconds += parseFloat(hoursMatch[1]) * 3600; matched = true; }
  if (minsMatch) { totalSeconds += parseFloat(minsMatch[1]) * 60; matched = true; }
  if (secsMatch) { totalSeconds += parseFloat(secsMatch[1]); matched = true; }

  if (matched) return Math.round(totalSeconds);

  const plainNum = Number(text.replace(/,/g, ''));
  if (!Number.isNaN(plainNum)) return Math.round(plainNum);

  return null;
}

export function parseNumericStat(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isNaN(raw) ? null : raw;

  const str = String(raw).trim().replace(/,/g, '');
  if (!str || ['none', '-', 'n/a'].includes(str.toLowerCase())) return null;

  const match = str.match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

export function detectResourceType(text, fallback = 'Gold') {
  if (!text) return fallback;
  const lower = String(text).toLowerCase();
  if (lower.includes('dark elixir') || lower.includes('dark_elixir')) return 'Dark Elixir';
  if (lower.includes('builder gold') || lower.includes('builder_gold')) return 'Builder Gold';
  if (lower.includes('builder elixir') || lower.includes('builder_elixir')) return 'Builder Elixir';
  if (lower.includes('capital gold') || lower.includes('capital_gold')) return 'Capital Gold';
  if (lower.includes('elixir')) return 'Elixir';
  if (lower.includes('gold') || lower.includes('oro')) return 'Gold';
  if (lower.includes('ore') || lower.includes('shiny') || lower.includes('glowy')) return 'Ores';
  return fallback;
}

// ============================================================================
// CLIENTE CON CACHÉ DE MEDIAWIKI API
// ============================================================================

async function fetchPageHtml(pageTitle) {
  const cacheKey = pageTitle.replace(/[^a-zA-Z0-9_-]/g, '_') + '.html';
  const cachePath = path.join(CACHE_DIR, cacheKey);

  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath, 'utf-8');
  }

  const fallbackHV = path.join(CACHE_DIR, pageTitle.replace(/[^a-zA-Z0-9_-]/g, '_') + '_Home_Village.html');
  if (fs.existsSync(fallbackHV)) {
    return fs.readFileSync(fallbackHV, 'utf-8');
  }
  const fallbackBB = path.join(CACHE_DIR, pageTitle.replace(/[^a-zA-Z0-9_-]/g, '_') + '_Builder_Base.html');
  if (fs.existsSync(fallbackBB)) {
    return fs.readFileSync(fallbackBB, 'utf-8');
  }

  let attempt = 0;
  while (attempt < 3) {
    try {
      await sleep(150);
      const res = await apiClient.get('', {
        params: {
          action: 'parse',
          page: pageTitle,
          prop: 'text|wikitext',
          format: 'json',
          redirects: 1
        }
      });

      const html = res.data?.parse?.text?.['*'];
      const wt = res.data?.parse?.wikitext?.['*'];

      // Check if page redirects or tabber points to a subpage
      if (wt && wt.includes('<tabber>') && wt.includes('Home Village={{:')) {
        const match = wt.match(/Home Village=\{\{:([^}]+)\}\}/);
        if (match && match[1] && match[1].trim() !== pageTitle) {
          return await fetchPageHtml(match[1].trim());
        }
      }

      if (html) {
        fs.writeFileSync(cachePath, html, 'utf-8');
        return html;
      }
      return null;
    } catch (err) {
      attempt++;
      if (attempt >= 3) {
        console.warn(`[Wiki Skip] Error obteniendo '${pageTitle}': ${err.message}`);
        return null;
      }
      await sleep(1000 * attempt);
    }
  }
  return null;
}

// ============================================================================
// PARSER MATRICIAL DE TABLAS HTML WIKITABLE
// ============================================================================

export function extractHtmlTables(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const tables = [];

  $('table.wikitable').each((_, table) => {
    const $table = $(table);
    // Ignorar tablas de historial o notas de versión
    const headerText = $table.find('tr').first().text();
    if (/Date|Patch|Version|Changelog|Sound Effect/i.test(headerText) && !/Damage|Hitpoints|Cost|Level/i.test(headerText)) {
      return;
    }

    const grid = [];
    const rows = $table.find('tr');

    rows.each((rowIndex, row) => {
      const $row = $(row);
      const cells = $row.find('th, td');
      if (cells.length === 0) return;

      if (!grid[rowIndex]) grid[rowIndex] = [];
      let colIndex = 0;

      cells.each((_, cell) => {
        while (grid[rowIndex][colIndex] !== undefined) {
          colIndex++;
        }

        const $cell = $(cell);
        const rowspan = parseInt($cell.attr('rowspan') || '1', 10);
        const colspan = parseInt($cell.attr('colspan') || '1', 10);
        const isHeader = cell.tagName === 'th';

        $cell.find('style, script').remove();
        const text = $cell.text().trim().replace(/\s+/g, ' ');

        for (let r = 0; r < rowspan; r++) {
          const targetR = rowIndex + r;
          if (!grid[targetR]) grid[targetR] = [];
          for (let c = 0; c < colspan; c++) {
            grid[targetR][colIndex + c] = {
              text,
              isHeader,
              rowspan,
              colspan,
              html: $cell.html()
            };
          }
        }
        colIndex += colspan;
      });
    });

    if (grid.length > 0) {
      const headerRow = grid[0]?.map(cell => cell?.text || '') || [];
      const dataRows = grid.slice(1).map(row => (row || []).map(cell => cell?.text || ''));
      tables.push({
        rawHtml: $table.html() || '',
        rawText: $table.text() || '',
        isSupercharge: /supercharge|charge level/i.test($table.text()) && !/skin|pass/i.test($table.text()),
        header: headerRow,
        data: dataRows
      });
    }
  });

  return tables;
}

// Extrae atributos generales de combate desde tablas de 1 fila (DPS, Range, Speed, etc.)
function extractCombatAttributes(tables) {
  const attrs = {
    range: null,
    attack_speed: null,
    movement_speed: null,
    damage_type: null,
    targets: null,
    housing_space: null,
    training_time_seconds: null
  };

  for (const t of tables) {
    if (t.data.length >= 1 && t.data.length <= 3) {
      t.header.forEach((h, idx) => {
        const val = t.data[0]?.[idx];
        if (!val) return;
        const cleanH = h.toLowerCase();
        if (cleanH.includes('range') && attrs.range === null) attrs.range = parseNumericStat(val) || val;
        else if (cleanH.includes('attack speed') && attrs.attack_speed === null) attrs.attack_speed = parseNumericStat(val);
        else if (cleanH.includes('movement speed') && attrs.movement_speed === null) attrs.movement_speed = parseNumericStat(val);
        else if (cleanH.includes('damage type') && attrs.damage_type === null) attrs.damage_type = val;
        else if ((cleanH.includes('target') || cleanH.includes('preferred target')) && attrs.targets === null) attrs.targets = val;
        else if ((cleanH.includes('housing space') || cleanH.includes('spring weight')) && attrs.housing_space === null) attrs.housing_space = parseNumericStat(val);
        else if (cleanH.includes('training time') && attrs.training_time_seconds === null) attrs.training_time_seconds = parseTimeToSeconds(val);
      });
    }
  }

  return attrs;
}

// Mapea las filas de niveles de una tabla a un diccionario estructurado
function mapLevelTable(table, defaultResource = 'Gold') {
  let headerRow = [...table.header];
  let dataRows = [...table.data];

  // Si la primera fila de datos contiene subtítulos (ej: Subcabeceras de atributos)
  if (dataRows.length > 0 && dataRows[0].some(cell => /damage|hitpoint|cost|time|ore|level/i.test(cell))) {
    const sub = dataRows[0];
    headerRow = headerRow.map((h, i) => `${h} ${sub[i] || ''}`.trim());
    dataRows = dataRows.slice(1);
  }

  const colMap = {};
  headerRow.forEach((h, idx) => {
    const cleanH = h.toLowerCase().replace(/\s+/g, ' ');
    if ((cleanH.startsWith('level') || cleanH.includes('th level') || cleanH === 'level') && !cleanH.includes('required') && !cleanH.includes('ability')) colMap[idx] = 'level';
    else if (cleanH.includes('charge level') || cleanH.includes('supercharge')) colMap[idx] = 'supercharge_level';
    else if (cleanH.includes('shiny ore')) colMap[idx] = 'shiny_ore';
    else if (cleanH.includes('glowy ore')) colMap[idx] = 'glowy_ore';
    else if (cleanH.includes('starry ore')) colMap[idx] = 'starry_ore';
    else if (cleanH.includes('projectile damage')) colMap[idx] = 'projectile_damage';
    else if (cleanH.includes('ability damage') || cleanH.includes('ability total damage')) colMap[idx] = 'ability_damage';
    else if (cleanH.includes('counter damage')) colMap[idx] = 'counter_damage';
    else if (cleanH.includes('damage on defeat')) colMap[idx] = 'damage_on_defeat';
    else if (cleanH.includes('damage per shot increase')) colMap[idx] = 'damage_per_shot_increase';
    else if (cleanH.includes('aura damage per second')) colMap[idx] = 'aura_damage_per_second';
    else if (cleanH.includes('aura damage per hit')) colMap[idx] = 'aura_damage_per_hit';
    else if (cleanH.includes('dps increase') || cleanH.includes('damage per second increase') || cleanH.includes('dps boost')) colMap[idx] = 'damage_per_second_boost';
    else if (cleanH.includes('hitpoint increase') || cleanH.includes('hp increase') || cleanH.includes('hp boost')) colMap[idx] = 'hp_increase';
    else if (cleanH.includes('damage increase')) colMap[idx] = 'damage_increase';
    else if (cleanH.includes('building damage %') || cleanH.includes('building damage percent')) colMap[idx] = 'building_damage_percent';
    else if (cleanH.includes('damage %') || cleanH.includes('damage percent')) colMap[idx] = 'damage_percent';
    else if (cleanH.includes('reduction')) colMap[idx] = 'damage_reduction_percent';
    else if (cleanH.includes('heal per hit')) colMap[idx] = 'heal_per_hit';
    else if (cleanH.includes('heal per counter')) colMap[idx] = 'heal_per_counter';
    else if (cleanH.includes('health recovery') || cleanH.includes('hp recovery') || cleanH === 'healing') colMap[idx] = 'health_recovery';
    else if (cleanH.includes('self heal') || cleanH.includes('self healing') || cleanH.includes('healing per second')) colMap[idx] = 'self_heal_per_second';
    else if (cleanH.includes('damage radius') || cleanH.includes('damage area') || cleanH.includes('portal tile radius')) colMap[idx] = 'area_damage_radius';
    else if (cleanH.includes('number of targets')) colMap[idx] = 'number_of_targets';
    else if (cleanH.includes('number of attacks')) colMap[idx] = 'number_of_attacks';
    else if (cleanH.includes('stun duration')) colMap[idx] = 'stun_duration';
    else if (cleanH.includes('slow down duration')) colMap[idx] = 'slow_down_duration';
    else if (cleanH.includes('slow down')) colMap[idx] = 'slow_down_percent';
    else if (cleanH.includes('attack speed increase') || cleanH.includes('attack speed boost')) colMap[idx] = 'attack_speed_boost_percent';
    else if (cleanH.includes('movement speed increase') || (cleanH.includes('speed increase') && !cleanH.includes('attack'))) colMap[idx] = 'movement_speed_boost';
    else if (cleanH.includes('summoned') || cleanH.includes('max summoned')) colMap[idx] = 'summoned_count';
    else if (cleanH.includes('clones') && !cleanH.includes('duration') && !cleanH.includes('dps') && !cleanH.includes('health')) colMap[idx] = 'clones_count';
    else if (cleanH.includes('duration')) colMap[idx] = 'ability_duration';
    else if (cleanH.includes('damage per hit')) colMap[idx] = 'damage_per_hit';
    else if (cleanH.includes('damage per second') || cleanH.includes('dps')) colMap[idx] = 'damage_per_second';
    else if (cleanH.includes('damage per shot') || cleanH.includes('damage per attack') || cleanH.includes('dph')) colMap[idx] = 'damage_per_shot';
    else if (cleanH === 'damage' || cleanH.includes('total damage') || cleanH.includes('damage on death') || cleanH.includes('damage dealt')) colMap[idx] = 'total_damage';
    else if (cleanH.includes('hitpoint') || cleanH.includes('hp')) colMap[idx] = 'hitpoints';
    else if (cleanH.includes('cost')) colMap[idx] = 'upgrade_cost';
    else if (cleanH.includes('time') && !cleanH.includes('training time') && !cleanH.includes('burst')) colMap[idx] = 'upgrade_time_seconds';
    else if (cleanH.includes('training time')) colMap[idx] = 'training_time_seconds';
    else if (cleanH.includes('town hall')) colMap[idx] = 'town_hall_required';
    else if (cleanH.includes('builder hall')) colMap[idx] = 'builder_hall_required';
    else if (cleanH.includes('district hall')) colMap[idx] = 'district_hall_required';
    else if (cleanH.includes('hero hall')) colMap[idx] = 'hero_hall_required';
    else if (cleanH.includes('blacksmith')) colMap[idx] = 'blacksmith_level_required';
    else if (cleanH.includes('laboratory') || cleanH.includes('star lab')) colMap[idx] = 'laboratory_level_required';
    else if (cleanH.includes('pet house')) colMap[idx] = 'pet_house_level_required';
    else if (cleanH.includes('workshop')) colMap[idx] = 'workshop_level_required';
    else if (cleanH.includes('units per') || cleanH.includes('housing space')) colMap[idx] = 'housing_space';
    else if (cleanH.includes('ability level')) colMap[idx] = 'ability_level';
  });

  const parsedLevels = {};
  for (const row of dataRows) {
    if (!row || row.length === 0) continue;
    const entry = {};
    for (let c = 0; c < row.length; c++) {
      const key = colMap[c];
      if (!key) continue;
      const rawVal = row[c];
      if (key.includes('time')) {
        entry[key] = parseTimeToSeconds(rawVal);
      } else {
        entry[key] = parseNumericStat(rawVal);
      }
    }

    const lvl = entry.level ?? entry.supercharge_level;
    if (lvl !== null && lvl !== undefined && !Number.isNaN(lvl) && lvl > 0) {
      if (!parsedLevels[lvl] || (entry.town_hall_required && (!parsedLevels[lvl].town_hall_required || entry.town_hall_required > parsedLevels[lvl].town_hall_required))) {
        parsedLevels[lvl] = {
          level: lvl,
          ...entry,
          resource_type: detectResourceType(table.rawHtml, defaultResource)
        };
      }
    }
  }

  return parsedLevels;
}

// ============================================================================
// BUSCADORES DE IDENTIFICADORES SUPERCELL OFICIALES
// ============================================================================

function findSupercellId(name, villageType = 'home') {
  const slug = toSlug(name);

  // 1. Edificios
  for (const [idStr, data] of Object.entries(SUPERCELL_BUILDINGS)) {
    if (data.slug === slug || toSlug(data.name) === slug || data.id === slug) {
      return { dataId: Number(idStr), category: data.category, spanishName: data.spanishName };
    }
  }

  // 2. Trampas
  for (const [idStr, data] of Object.entries(SUPERCELL_TRAPS)) {
    if (data.slug === slug || toSlug(data.name) === slug || data.id === slug) {
      return { dataId: Number(idStr), category: 'Trampas', spanishName: data.spanishName };
    }
  }

  // 3. Héroes
  for (const [idStr, data] of Object.entries(SUPERCELL_HEROES)) {
    if (data.slug === slug || toSlug(data.name) === slug || data.id === slug) {
      return { dataId: Number(idStr), category: 'Héroes', spanishName: data.spanishName, hero: data.name };
    }
  }

  // 4. Mascotas
  for (const [idStr, data] of Object.entries(SUPERCELL_PETS)) {
    if (data.slug === slug || toSlug(data.name) === slug || data.id === slug) {
      return { dataId: Number(idStr), category: 'Mascotas', spanishName: data.spanishName };
    }
  }

  // 5. Equipamiento
  for (const [idStr, data] of Object.entries(SUPERCELL_EQUIPMENT)) {
    if (data.slug === slug || toSlug(data.name) === slug || data.id === slug) {
      return { dataId: Number(idStr), category: 'Equipamiento', spanishName: data.spanishName, hero: data.hero, rarity: data.rarity };
    }
  }

  // 6. Hechizos
  for (const [idStr, data] of Object.entries(SUPERCELL_SPELLS)) {
    if (data.slug === slug || toSlug(data.name) === slug || data.id === slug) {
      return { dataId: Number(idStr), category: 'Hechizos', spanishName: data.spanishName, isDark: data.isDark };
    }
  }

  // 7. Unidades / Tropas
  for (const [idStr, data] of Object.entries(SUPERCELL_UNITS)) {
    if (data.slug === slug || toSlug(data.name) === slug || data.id === slug) {
      return { dataId: Number(idStr), category: 'Tropas', spanishName: data.spanishName, isDark: data.isDark };
    }
  }

  // 8. Base del Constructor
  for (const [idStr, data] of Object.entries(SUPERCELL_BUILDER_BASE)) {
    if (data.slug === slug || toSlug(data.name) === slug || data.id === slug) {
      return { dataId: Number(idStr), category: data.category, spanishName: data.spanishName };
    }
  }

  return null;
}

// ============================================================================
// PROCESAMIENTO GENERAL DE ENTIDAD
// ============================================================================

async function processEntityPage(pageTitle, defaultCategory, villageType, defaultResource) {
  const cleanName = pageTitle
    .replace(/\/Home Village$|\/Builder Base$|\/Clan Capital$/i, '')
    .trim();
  const slug = toSlug(pageTitle);
  const scInfo = findSupercellId(cleanName, villageType);

  const html = await fetchPageHtml(pageTitle);
  if (!html) return null;

  const tables = extractHtmlTables(html);
  if (tables.length === 0) return null;

  const combatAttrs = extractCombatAttributes(tables);
  const levels = {};
  const supercharges = {};

  for (const t of tables) {
    if (t.isSupercharge) {
      const scLevels = mapLevelTable(t, defaultResource);
      for (const [lvl, data] of Object.entries(scLevels)) {
        supercharges[lvl] = {
          hitpoints: data.hitpoints ?? null,
          damage_per_second: data.damage_per_second ?? null,
          damage_per_shot: data.damage_per_shot ?? null,
          upgrade_cost: data.upgrade_cost ?? null,
          upgrade_time_seconds: data.upgrade_time_seconds ?? null
        };
      }
    } else {
      const mainLevels = mapLevelTable(t, defaultResource);
      // Validar que realmente sea una tabla de niveles
      if (Object.keys(mainLevels).length >= 1) {
        for (const [lvl, data] of Object.entries(mainLevels)) {
          // Filtrar niveles anómalos o de tablas secundarias
          const numLvl = Number(lvl);
          if (numLvl > 0 && numLvl <= 120) {
            const directAbilityDamage =
              data.damage ??
              data.projectile_damage ??
              data.ability_damage ??
              data.damage_per_hit ??
              data.damage_per_shot ??
              data.total_damage ??
              data.counter_damage ??
              data.damage_on_defeat ??
              data.damage_per_shot_increase ??
              null;

            levels[lvl] = {
              level: numLvl,
              hitpoints: data.hitpoints ?? null,
              damage: directAbilityDamage,
              damage_per_second: data.damage_per_second ?? null,
              damage_per_shot: data.damage_per_shot ?? null,
              damage_per_hit: data.damage_per_hit ?? data.damage_per_shot ?? null,
              total_damage: data.total_damage ?? null,
              projectile_damage: data.projectile_damage ?? null,
              ability_damage: data.ability_damage ?? null,
              damage_per_shot_increase: data.damage_per_shot_increase ?? null,
              counter_damage: data.counter_damage ?? null,
              damage_on_defeat: data.damage_on_defeat ?? null,
              aura_damage_per_second: data.aura_damage_per_second ?? null,
              aura_damage_per_hit: data.aura_damage_per_hit ?? null,
              damage_percent: data.damage_percent ?? null,
              building_damage_percent: data.building_damage_percent ?? null,
              health_recovery: data.health_recovery ?? null,
              heal_per_hit: data.heal_per_hit ?? null,
              heal_per_counter: data.heal_per_counter ?? null,
              upgrade_cost: data.upgrade_cost ?? null,
              upgrade_time_seconds: data.upgrade_time_seconds ?? null,
              research_cost: data.upgrade_cost ?? null,
              research_time_seconds: data.upgrade_time_seconds ?? null,
              resource_type: data.resource_type || defaultResource,
              town_hall_required: data.town_hall_required ?? null,
              builder_hall_required: data.builder_hall_required ?? null,
              district_hall_required: data.district_hall_required ?? null,
              laboratory_level_required: data.laboratory_level_required ?? null,
              hero_hall_required: data.hero_hall_required ?? null,
              blacksmith_level_required: data.blacksmith_level_required ?? null,
              pet_house_level_required: data.pet_house_level_required ?? null,
              workshop_level_required: data.workshop_level_required ?? null,
              shiny_ore: data.shiny_ore ?? null,
              glowy_ore: data.glowy_ore ?? null,
              starry_ore: data.starry_ore ?? null,
              ability_duration: data.ability_duration ?? null,
              damage_reduction_percent: data.damage_reduction_percent ?? null,
              damage_per_second_boost: data.damage_per_second_boost ?? null,
              hp_increase: data.hp_increase ?? null,
              damage_increase: data.damage_increase ?? null,
              self_heal_per_second: data.self_heal_per_second ?? null,
              ability_level: data.ability_level ?? null,
              area_damage_radius: data.area_damage_radius ?? null,
              number_of_targets: data.number_of_targets ?? null,
              number_of_attacks: data.number_of_attacks ?? null,
              stun_duration: data.stun_duration ?? null,
              slow_down_percent: data.slow_down_percent ?? null,
              slow_down_duration: data.slow_down_duration ?? null,
              attack_speed_boost_percent: data.attack_speed_boost_percent ?? null,
              movement_speed_boost: data.movement_speed_boost ?? null,
              summoned_count: data.summoned_count ?? null,
              clones_count: data.clones_count ?? null,
              housing_space: data.housing_space ?? combatAttrs.housing_space ?? null,
              range: combatAttrs.range ?? null,
              attack_speed: combatAttrs.attack_speed ?? null,
              supercharges: null
            };
          }
        }
      }
    }
  }

  // Si encontramos supercargas, asignarlas al nivel máximo de la estructura
  if (Object.keys(supercharges).length > 0) {
    const levelNums = Object.keys(levels).map(Number).sort((a, b) => a - b);
    const maxLvl = levelNums[levelNums.length - 1];
    if (maxLvl && levels[maxLvl]) {
      levels[maxLvl].supercharges = supercharges;
    }
  }

  if (Object.keys(levels).length === 0) return null;

  // Metadatos de equipamiento heroico (User / Rarity / Ability Type) desde Table 0
  let equipmentHero = null;
  let equipmentRarity = null;
  let equipmentAbilityType = null;

  if (tables.length > 0 && tables[0].header.some((h) => /user|hero/i.test(h))) {
    const t0 = tables[0];
    t0.header.forEach((h, idx) => {
      const cleanH = h.toLowerCase().trim();
      const val = t0.data[0]?.[idx]?.trim();
      if ((cleanH === 'user' || cleanH === 'hero') && val) equipmentHero = val;
      else if (cleanH.includes('rarity') && val) equipmentRarity = val;
      else if (cleanH.includes('ability type') && val) equipmentAbilityType = val;
    });
  }

  return {
    id: slug,
    data_id: scInfo?.dataId || null,
    name: cleanName,
    spanish_name: scInfo?.spanishName || cleanName,
    category: scInfo?.category || defaultCategory,
    village_type: villageType,
    hero: equipmentHero || scInfo?.hero || null,
    rarity: equipmentRarity || scInfo?.rarity || null,
    ability_type: equipmentAbilityType || null,
    range: combatAttrs.range,
    attack_speed: combatAttrs.attack_speed,
    movement_speed: combatAttrs.movement_speed,
    housing_space: combatAttrs.housing_space,
    training_time_seconds: combatAttrs.training_time_seconds,
    damage_type: combatAttrs.damage_type,
    targets: combatAttrs.targets,
    levels
  };
}

// ============================================================================
// CATÁLOGO MAESTRO DE PÁGINAS A EXTRAER
// ============================================================================

const ENTITY_MANIFEST = {
  home_village: {
    structures: [
      'Cannon/Home Village', 'Archer Tower/Home Village', 'Mortar', 'Air Defense/Home Village',
      'Wizard Tower', 'Air Sweeper', 'Hidden Tesla/Home Village', 'Bomb Tower', 'X-Bow/Home Village',
      'Inferno Tower', 'Eagle Artillery', 'Scattershot', 'Spell Tower', 'Monolith',
      'Multi-Archer Tower', 'Ricochet Cannon', 'Multi-Gear Tower', 'Firespitter', 'Revenge Tower',
      'Super Wizard Tower', 'Wall/Home Village', 'Town Hall', 'Clan Castle', 'Army Camp/Home Village',
      'Gold Mine/Home Village', 'Elixir Collector/Home Village', 'Dark Elixir Drill',
      'Gold Storage/Home Village', 'Elixir Storage/Home Village', 'Dark Elixir Storage',
      'Laboratory', 'Blacksmith', 'Pet House', 'Barracks', 'Dark Barracks', 'Spell Factory',
      'Dark Spell Factory', 'Workshop', 'Hero Hall', 'Builder\'s Hut',
      'Bomb', 'Spring Trap/Home Village', 'Air Bomb', 'Giant Bomb', 'Seeking Air Mine',
      'Skeleton Trap', 'Tornado Trap', 'Giga Bomb'
    ],
    troops: [
      'Barbarian/Home Village', 'Archer', 'Giant', 'Goblin', 'Wall Breaker', 'Balloon',
      'Wizard', 'Healer', 'Dragon', 'P.E.K.K.A', 'Baby Dragon/Home Village', 'Miner',
      'Electro Dragon', 'Yeti', 'Dragon Rider', 'Electro Titan', 'Root Rider', 'Thrower', 'Meteor Golem',
      'Minion', 'Hog Rider', 'Valkyrie', 'Golem', 'Witch', 'Lava Hound', 'Bowler',
      'Ice Golem', 'Headhunter', 'Apprentice Warden', 'Druid', 'Furnace', 'Ruin Witch'
    ],
    super_troops: [
      'Super Barbarian', 'Super Archer', 'Super Giant', 'Sneaky Goblin',
      'Super Wall Breaker', 'Rocket Balloon', 'Super Wizard', 'Super Dragon',
      'Inferno Dragon', 'Super Miner', 'Super Yeti', 'Super Minion', 'Super Hog Rider',
      'Super Valkyrie', 'Super Witch', 'Ice Hound', 'Super Bowler'
    ],
    heroes: [
      'Barbarian King', 'Archer Queen', 'Grand Warden', 'Royal Champion', 'Minion Prince', 'Dragon Duke'
    ],
    hero_equipment: [
      'Barbarian Puppet', 'Rage Vial', 'Earthquake Boots', 'Vampstache', 'Giant Gauntlet', 'Spiky Ball', 'Snake Bracelet',
      'Archer Puppet', 'Invisibility Vial', 'Giant Arrow', 'Healer Puppet', 'Frozen Arrow', 'Magic Mirror', 'Action Figure',
      'Eternal Tome', 'Life Gem', 'Rage Gem', 'Healing Tome', 'Fireball', 'Lavaloon Puppet', 'Heroic Torch',
      'Royal Gem', 'Seeking Shield', 'Hog Rider Puppet', 'Haste Vial', 'Rocket Spear', 'Electro Boots', 'Frost Flake',
      'Henchmen Puppet', 'Dark Orb', 'Metal Pants', 'Noble Iron', 'Dark Crown', 'Meteor Staff', 'Portal Pendant',
      'Fire Heart', 'Flame Blower', 'Stun Blaster', 'Electro Fangs', 'Rocket Backpack', 'Revenge Deck'
    ],
    spells: [
      'Lightning Spell/Home Village', 'Healing Spell/Home Village', 'Rage Spell/Home Village', 'Jump Spell/Home Village',
      'Freeze Spell', 'Clone Spell', 'Invisibility Spell', 'Recall Spell', 'Revive Spell', 'Totem Spell',
      'Poison Spell', 'Earthquake Spell', 'Haste Spell', 'Skeleton Spell', 'Bat Spell', 'Overgrowth Spell', 'Ice Block Spell', 'Angry Spell'
    ],
    siege_machines: [
      'Wall Wrecker', 'Battle Blimp', 'Stone Slammer', 'Siege Barracks', 'Log Launcher',
      'Flame Flinger', 'Battle Drill', 'Troop Launcher', 'Sky Wagon'
    ],
    pets: [
      'L.A.S.S.I', 'Electro Owl', 'Mighty Yak', 'Unicorn', 'Frosty', 'Diggy', 'Poison Lizard',
      'Phoenix', 'Spirit Fox', 'Angry Jelly', 'Sneezy', 'Greedy Raven'
    ]
  },
  builder_base: {
    structures: [
      'Cannon/Builder Base', 'Double Cannon', 'Archer Tower/Builder Base', 'Hidden Tesla/Builder Base',
      'Firecrackers', 'Crusher', 'Guard Post', 'Air Bombs/Builder Base', 'Multi Mortar', 'O.T.T.O\'s Outpost',
      'Roaster', 'Giant Cannon', 'Mega Tesla', 'Lava Launcher', 'X-Bow/Builder Base', 'Walls/Builder Base',
      'Push Trap', 'Spring Trap/Builder Base', 'Mine/Builder Base', 'Mega Mine/Builder Base',
      'Builder Hall', 'Gold Mine/Builder Base', 'Elixir Collector/Builder Base',
      'Gold Storage/Builder Base', 'Elixir Storage/Builder Base', 'Gem Mine', 'B.O.B Control',
      'Builder Barracks', 'Army Camp/Builder Base', 'Star Laboratory', 'Reinforcement Camp', 'Healing Hut',
      'Clock Tower', 'Elixir Cart'
    ],
    troops: [
      'Raged Barbarian', 'Sneaky Archer/Builder Base', 'Boxer Giant', 'Beta Minion', 'Bomber',
      'Baby Dragon/Builder Base', 'Cannon Cart', 'Night Witch', 'Drop Ship',
      'Power P.E.K.K.A/Builder Base', 'Hog Glider', 'Electrofire Wizard'
    ],
    heroes: [
      'Battle Machine', 'Battle Copter'
    ]
  },
  other: {
    clan_capital: {
      structures: [
        'Cannon/Clan Capital', 'Spear Thrower', 'Air Defense/Clan Capital', 'Multi Cannon',
        'Bomb Tower/Clan Capital', 'Multi Mortar/Clan Capital', 'Super Wizard Tower/Clan Capital',
        'Air Bombs/Clan Capital', 'Rapid Rockets', 'Crusher/Clan Capital', 'Hidden Mega Tesla',
        'Giant Cannon/Clan Capital', 'Rocket Artillery', 'Inferno Tower/Clan Capital', 'Blast Bow',
        'Mini-Minion Hive', 'Reflector', 'Goblin Thrower', 'Super Giant Post', 'Raid Cart Post',
        'Super Dragon Post', 'Wall/Clan Capital',
        'Mine/Clan Capital', 'Mega Mine/Clan Capital', 'Log Trap', 'Zap Trap', 'Spear Trap',
        'Capital Hall', 'District Hall', 'Army Camp/Clan Capital', 'Spell Storage'
      ],
      troops: [
        'Super Barbarian/Clan Capital', 'Sneaky Archer/Clan Capital', 'Super Giant/Clan Capital',
        'Battle Ram/Clan Capital', 'Minion Horde', 'Super Wizard/Clan Capital', 'Rocket Balloon/Clan Capital',
        'Skeleton Barrel/Clan Capital', 'Flying Fortress', 'Raid Cart', 'Power P.E.K.K.A/Clan Capital',
        'Hog Raiders', 'Super Dragon/Clan Capital', 'Mountain Golem', 'Inferno Dragon/Clan Capital',
        'Super Miner/Clan Capital', 'Mega Sparky'
      ],
      spells: [
        'Healing Spell/Clan Capital', 'Jump Spell/Clan Capital', 'Lightning Spell/Clan Capital',
        'Frost Spell', 'Rage Spell/Clan Capital', 'Graveyard Spell', 'Endless Haste Spell'
      ]
    }
  }
};

// ============================================================================
// ORQUESTADOR MAESTRO DEL ETL
// ============================================================================

export async function runFullExtractor() {
  console.log('==============================================================================');
  console.log('🚀 CLASH TACTICS - MEDIAWIKI BATCH ETL EXTRACTOR & MASTER DATABASE COMPILER 3.0');
  console.log('==============================================================================\n');

  const database = {
    metadata: {
      extracted_at: new Date().toISOString(),
      source: FANDOM_API_URL,
      schema_version: '3.0.0',
      game_version_compatibility: 'TH18 / Latest Supercell Balance',
      total_entities: 0,
      sections: {
        home_village: {},
        builder_base: {},
        other: { clan_capital: {} }
      }
    },
    // Secciones jerárquicas oficiales
    home_village: {
      structures: {},
      troops: {},
      super_troops: {},
      heroes: {},
      hero_equipment: {},
      spells: {},
      siege_machines: {},
      pets: {}
    },
    builder_base: {
      structures: {},
      troops: {},
      heroes: {}
    },
    other: {
      clan_capital: {
        structures: {},
        troops: {},
        spells: {}
      }
    }
  };

  // Helper de extracción secuencial por categoría
  async function extractCategory(pages, targetObj, defaultCat, village, resType, label) {
    console.log(`\n📦 [${label}] Procesando ${pages.length} páginas...`);
    let count = 0;
    for (const page of pages) {
      process.stdout.write(`  ⏳ ${page.padEnd(35, ' ')}`);
      const entity = await processEntityPage(page, defaultCat, village, resType);
      if (entity) {
        targetObj[entity.id] = entity;
        count++;
        const lvlCount = Object.keys(entity.levels).length;
        console.log(`✅ [${lvlCount} lvls] -> ${entity.name}`);
      } else {
        console.log(`⚠️ (Sin tabla o omitido)`);
      }
    }
    return count;
  }

  // 1. HOME VILLAGE
  await extractCategory(ENTITY_MANIFEST.home_village.structures, database.home_village.structures, 'Defensas', 'home', 'Gold', 'HV - Estructuras');
  await extractCategory(ENTITY_MANIFEST.home_village.troops, database.home_village.troops, 'Tropas', 'home', 'Elixir', 'HV - Tropas Laboratorio');
  await extractCategory(ENTITY_MANIFEST.home_village.super_troops, database.home_village.super_troops, 'Super Tropas', 'home', 'Dark Elixir', 'HV - Super Tropas');
  await extractCategory(ENTITY_MANIFEST.home_village.heroes, database.home_village.heroes, 'Héroes', 'home', 'Dark Elixir', 'HV - Héroes');
  await extractCategory(ENTITY_MANIFEST.home_village.hero_equipment, database.home_village.hero_equipment, 'Equipamiento', 'home', 'Ores', 'HV - Equipamientos Heroicos');
  await extractCategory(ENTITY_MANIFEST.home_village.spells, database.home_village.spells, 'Hechizos', 'home', 'Elixir', 'HV - Hechizos');
  await extractCategory(ENTITY_MANIFEST.home_village.siege_machines, database.home_village.siege_machines, 'Máquinas de Asedio', 'home', 'Elixir', 'HV - Asedios');
  await extractCategory(ENTITY_MANIFEST.home_village.pets, database.home_village.pets, 'Mascotas', 'home', 'Dark Elixir', 'HV - Mascotas');

  // 2. BUILDER BASE
  await extractCategory(ENTITY_MANIFEST.builder_base.structures, database.builder_base.structures, 'Defensas', 'builder_base', 'Builder Gold', 'BB - Estructuras');
  await extractCategory(ENTITY_MANIFEST.builder_base.troops, database.builder_base.troops, 'Tropas', 'builder_base', 'Builder Elixir', 'BB - Tropas');
  await extractCategory(ENTITY_MANIFEST.builder_base.heroes, database.builder_base.heroes, 'Héroes', 'builder_base', 'Builder Elixir', 'BB - Héroes');

  // 3. OTHER (CLAN CAPITAL)
  await extractCategory(ENTITY_MANIFEST.other.clan_capital.structures, database.other.clan_capital.structures, 'Defensas', 'clan_capital', 'Capital Gold', 'CC - Estructuras');
  await extractCategory(ENTITY_MANIFEST.other.clan_capital.troops, database.other.clan_capital.troops, 'Tropas', 'clan_capital', 'Capital Gold', 'CC - Tropas');
  await extractCategory(ENTITY_MANIFEST.other.clan_capital.spells, database.other.clan_capital.spells, 'Hechizos', 'clan_capital', 'Capital Gold', 'CC - Hechizos');


  // ACTUALIZACIÓN DE METADATOS
  database.metadata.sections.home_village = {
    structures: Object.keys(database.home_village.structures).length,
    troops: Object.keys(database.home_village.troops).length,
    super_troops: Object.keys(database.home_village.super_troops).length,
    heroes: Object.keys(database.home_village.heroes).length,
    hero_equipment: Object.keys(database.home_village.hero_equipment).length,
    spells: Object.keys(database.home_village.spells).length,
    siege_machines: Object.keys(database.home_village.siege_machines).length,
    pets: Object.keys(database.home_village.pets).length
  };

  database.metadata.sections.builder_base = {
    structures: Object.keys(database.builder_base.structures).length,
    troops: Object.keys(database.builder_base.troops).length,
    heroes: Object.keys(database.builder_base.heroes).length
  };

  database.metadata.sections.other.clan_capital = {
    structures: Object.keys(database.other.clan_capital.structures).length,
    troops: Object.keys(database.other.clan_capital.troops).length,
    spells: Object.keys(database.other.clan_capital.spells).length
  };

  const total =
    Object.values(database.metadata.sections.home_village).reduce((a, b) => a + b, 0) +
    Object.values(database.metadata.sections.builder_base).reduce((a, b) => a + b, 0) +
    Object.values(database.metadata.sections.other.clan_capital).reduce((a, b) => a + b, 0);

  database.metadata.total_entities = total;

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(database, null, 2), 'utf-8');

  console.log('\n==============================================================================');
  console.log(`🎉 EXTRACCIÓN MAESTRA COMPLETADA CON ÉXITO Y GUARDADA EN:`);
  console.log(`   ${OUTPUT_PATH}`);
  console.log(`   Total de Entidades Extraídas: ${total}`);
  console.log(`   - Home Village: ${Object.values(database.metadata.sections.home_village).reduce((a, b) => a + b, 0)} entidades`);
  console.log(`   - Builder Base: ${Object.values(database.metadata.sections.builder_base).reduce((a, b) => a + b, 0)} entidades`);
  console.log(`   - Other (Clan Capital): ${Object.values(database.metadata.sections.other.clan_capital).reduce((a, b) => a + b, 0)} entidades`);
  console.log('==============================================================================\n');

  return database;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runFullExtractor().catch((err) => {
    console.error('❌ Error fatal en el extractor masivo:', err);
    process.exit(1);
  });
}

