import axios from 'axios';
import * as cheerio from 'cheerio';
import {
  parseTimeToSeconds,
  parseNumber,
  extractHtmlTables
} from './test_table_parser.js';

const FANDOM_API_URL = 'https://clashofclans.fandom.com/api.php';
const USER_AGENT = 'ClashTacticsDataExtractor/2.0';

const client = axios.create({
  baseURL: FANDOM_API_URL,
  timeout: 15000,
  headers: { 'User-Agent': USER_AGENT }
});

function detectResourceType(costText, rawHtml) {
  const text = (costText + ' ' + (rawHtml || '')).toLowerCase();
  if (text.includes('dark elixir') || text.includes('dark_elixir')) return 'Dark Elixir';
  if (text.includes('builder gold') || text.includes('builder_gold')) return 'Builder Gold';
  if (text.includes('builder elixir') || text.includes('builder_elixir')) return 'Builder Elixir';
  if (text.includes('capital gold') || text.includes('capital_gold')) return 'Capital Gold';
  if (text.includes('elixir')) return 'Elixir';
  if (text.includes('gold')) return 'Gold';
  return null;
}

export function mapTableRows(table, defaultResource = 'Gold') {
  // If the first data row is also headers (subheaders), merge them
  let headerRow = [...table.header];
  let dataRows = [...table.data];

  if (dataRows.length > 0 && dataRows[0].some(cell => /damage|hitpoint|cost|time|ore|level/i.test(cell))) {
    const sub = dataRows[0];
    headerRow = headerRow.map((h, i) => `${h} ${sub[i] || ''}`.trim());
    dataRows = dataRows.slice(1);
  }

  // Map header index to standard property name
  const colMap = {};
  headerRow.forEach((h, idx) => {
    const cleanH = h.toLowerCase().replace(/\s+/g, ' ');
    if (cleanH.startsWith('level') && !cleanH.includes('required') && !cleanH.includes('ability')) colMap[idx] = 'level';
    else if (cleanH.includes('supercharge level') || cleanH === 'supercharge') colMap[idx] = 'supercharge_level';
    else if (cleanH.includes('shiny ore')) colMap[idx] = 'shiny_ore';
    else if (cleanH.includes('glowy ore')) colMap[idx] = 'glowy_ore';
    else if (cleanH.includes('starry ore')) colMap[idx] = 'starry_ore';
    else if (cleanH.includes('self heal')) colMap[idx] = 'self_heal_per_second';
    else if (cleanH.includes('reduction')) colMap[idx] = 'damage_reduction_percent';
    else if (cleanH.includes('duration')) colMap[idx] = 'ability_duration';
    else if (cleanH.includes('dps increase') || cleanH.includes('damage per second increase') || cleanH.includes('dps boost')) colMap[idx] = 'damage_per_second_boost';
    else if (cleanH.includes('hitpoint increase') || cleanH.includes('hp increase') || cleanH.includes('hp boost')) colMap[idx] = 'hp_increase';
    else if (cleanH.includes('damage increase')) colMap[idx] = 'damage_increase';
    else if (cleanH.includes('health recovery')) colMap[idx] = 'health_recovery';
    else if (cleanH.includes('damage per second') || cleanH.includes('dps')) colMap[idx] = 'damage_per_second';
    else if (cleanH.includes('damage per hit') || cleanH.includes('damage per shot') || cleanH.includes('damage per attack') || cleanH.includes('dph')) colMap[idx] = 'damage_per_shot';
    else if (cleanH.includes('total damage') || cleanH.includes('damage on death') || cleanH.includes('damage dealt')) colMap[idx] = 'total_damage';
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
    if (row.length === 0) continue;
    const entry = {};
    for (let c = 0; c < row.length; c++) {
      const key = colMap[c];
      if (!key) continue;
      const rawVal = row[c];
      if (key.includes('time')) {
        entry[key] = parseTimeToSeconds(rawVal);
      } else {
        entry[key] = parseNumber(rawVal);
      }
    }

    const lvl = entry.level ?? entry.supercharge_level;
    if (lvl !== null && lvl !== undefined && !Number.isNaN(lvl) && lvl > 0) {
      // If there are multiple entries for the same level (e.g. Barbarian King scaling at lvl 1), keep the highest TH requirement or merge
      if (!parsedLevels[lvl] || (entry.town_hall_required && (!parsedLevels[lvl].town_hall_required || entry.town_hall_required > parsedLevels[lvl].town_hall_required))) {
        parsedLevels[lvl] = {
          ...entry,
          resource_type: detectResourceType(table.rawHtml, table.rawHtml) || defaultResource
        };
      }
    }
  }

  return { colMap, parsedLevels };
}

async function testPage(page, defaultRes) {
  console.log(`\n========================================\nPAGE: ${page}\n========================================`);
  const res = await client.get('', {
    params: { action: 'parse', page, prop: 'text', format: 'json' }
  });
  const html = res.data?.parse?.text?.['*'];
  if (!html) return;

  const tables = extractHtmlTables(html);
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const { colMap, parsedLevels } = mapTableRows(t, defaultRes);
    const lvls = Object.keys(parsedLevels);
    if (lvls.length > 0) {
      console.log(`Table ${i} (${t.isSupercharge ? 'SUPERCHARGE' : 'MAIN/LEVELS'}) found ${lvls.length} levels:`, lvls.slice(0, 5).join(', '), '...', lvls[lvls.length - 1]);
      console.log('  Sample lvl 1:', parsedLevels[lvls[0]]);
      console.log(`  Sample max lvl (${lvls[lvls.length - 1]}):`, parsedLevels[lvls[lvls.length - 1]]);
    }
  }
}

(async () => {
  const tests = [
    ['Cannon/Home Village', 'Gold'],
    ['Air Defense/Home Village', 'Gold'],
    ['Barbarian King', 'Dark Elixir'],
    ['Giant Gauntlet', 'Ores'],
    ['Lightning Spell/Home Village', 'Elixir'],
    ['L.A.S.S.I', 'Dark Elixir'],
    ['Wall Wrecker', 'Elixir'],
    ['Raged Barbarian', 'Builder Elixir'],
    ['Double Cannon/Builder Base', 'Builder Gold'],
    ['Battle Machine', 'Builder Elixir']
  ];

  for (const [p, res] of tests) {
    await testPage(p, res);
  }
})();

