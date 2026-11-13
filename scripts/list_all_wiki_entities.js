import axios from 'axios';
import * as cheerio from 'cheerio';

const FANDOM_API_URL = 'https://clashofclans.fandom.com/api.php';
const USER_AGENT = 'ClashTacticsDataExtractor/2.0 (research; contact@clashtactics.com)';

const client = axios.create({
  baseURL: FANDOM_API_URL,
  timeout: 15000,
  headers: { 'User-Agent': USER_AGENT }
});

async function getWikitext(title) {
  try {
    const res = await client.get('', {
      params: { action: 'parse', page: title, prop: 'wikitext', format: 'json' }
    });
    return res.data?.parse?.wikitext?.['*'] || '';
  } catch (err) {
    console.error(`Failed to get ${title}: ${err.message}`);
    return '';
  }
}

function parseLinksFromWikitext(wt) {
  const links = new Set();
  // Match [[PageName]] or [[PageName|Text]] or {{H|PageName}} or {{B|PageName}} or {{C|PageName}}
  const wikilinks = wt.match(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g) || [];
  for (const l of wikilinks) {
    const m = l.match(/\[\[([^\]|#]+)/);
    if (m && m[1]) {
      const target = m[1].trim();
      if (!target.startsWith('File:') && !target.startsWith('Category:') && !target.startsWith('http')) {
        links.add(target);
      }
    }
  }

  const hMatches = wt.match(/\{\{H\|([^}|]+)/g) || [];
  for (const h of hMatches) {
    const m = h.match(/\{\{H\|([^}|]+)/);
    if (m && m[1]) links.add(`${m[1].trim()}/Home Village`);
  }

  const bMatches = wt.match(/\{\{B\|([^}|]+)/g) || [];
  for (const b of bMatches) {
    const m = b.match(/\{\{B\|([^}|]+)/);
    if (m && m[1]) links.add(`${m[1].trim()}/Builder Base`);
  }

  const cMatches = wt.match(/\{\{C\|([^}|]+)/g) || [];
  for (const c of cMatches) {
    const m = c.match(/\{\{C\|([^}|]+)/);
    if (m && m[1]) links.add(`${m[1].trim()}/Clan Capital`);
  }

  return Array.from(links);
}

async function listAll() {
  const templates = [
    'Template:BuildingsMenuHV',
    'Template:TroopsMenuHV',
    'Template:BuildingsMenuBB',
    'Template:TroopsMenuBB',
    'Template:BuildingsMenuCC',
    'Template:TroopsMenuCC'
  ];

  const inventory = {
    home_village: { buildings: [], army: [] },
    builder_base: { buildings: [], army: [] },
    clan_capital: { buildings: [], army: [] }
  };

  for (const t of templates) {
    const wt = await getWikitext(t);
    const links = parseLinksFromWikitext(wt);
    if (t.includes('HV')) {
      if (t.includes('Buildings')) inventory.home_village.buildings.push(...links);
      else inventory.home_village.army.push(...links);
    } else if (t.includes('BB')) {
      if (t.includes('Buildings')) inventory.builder_base.buildings.push(...links);
      else inventory.builder_base.army.push(...links);
    } else if (t.includes('CC')) {
      if (t.includes('Buildings')) inventory.clan_capital.buildings.push(...links);
      else inventory.clan_capital.army.push(...links);
    }
  }

  console.log('--- RESUMEN DE ENTIDADES ENCONTRADAS ---');
  console.log('Home Village Buildings:', inventory.home_village.buildings.length);
  console.log('Home Village Army:', inventory.home_village.army.length);
  console.log('Builder Base Buildings:', inventory.builder_base.buildings.length);
  console.log('Builder Base Army:', inventory.builder_base.army.length);
  console.log('Clan Capital Buildings:', inventory.clan_capital.buildings.length);
  console.log('Clan Capital Army:', inventory.clan_capital.army.length);

  console.log('\nHome Village Army Sample:', inventory.home_village.army.slice(0, 25));
  console.log('\nBuilder Base Army:', inventory.builder_base.army);
  console.log('\nClan Capital Army:', inventory.clan_capital.army);
}

listAll();

