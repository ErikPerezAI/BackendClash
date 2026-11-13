import axios from 'axios';
import * as cheerio from 'cheerio';

const FANDOM_API_URL = 'https://clashofclans.fandom.com/api.php';
const USER_AGENT = 'ClashTacticsDataExtractor/2.0 (academic research; contact@clashtactics.com)';

const client = axios.create({
  baseURL: FANDOM_API_URL,
  timeout: 15000,
  headers: { 'User-Agent': USER_AGENT }
});

export function parseTimeToSeconds(text) {
  if (!text) return null;
  const str = String(text).trim().toLowerCase();
  if (['none', '-', 'n/a', ''].includes(str)) return null;
  if (str === 'instant' || str === '0') return 0;

  let total = 0;
  let matched = false;
  const d = str.match(/(\d+(?:\.\d+)?)\s*d/);
  const h = str.match(/(\d+(?:\.\d+)?)\s*h/);
  const m = str.match(/(\d+(?:\.\d+)?)\s*m(?:in)?(?![a-z])/);
  const s = str.match(/(\d+(?:\.\d+)?)\s*s(?:ec)?/);

  if (d) { total += parseFloat(d[1]) * 86400; matched = true; }
  if (h) { total += parseFloat(h[1]) * 3600; matched = true; }
  if (m) { total += parseFloat(m[1]) * 60; matched = true; }
  if (s) { total += parseFloat(s[1]); matched = true; }

  return matched ? Math.round(total) : null;
}

export function parseNumber(text) {
  if (text === null || text === undefined) return null;
  const str = String(text).trim().replace(/,/g, '');
  if (['none', '-', 'n/a', ''].includes(str.toLowerCase())) return null;
  const match = str.match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

export function extractHtmlTables(html) {
  const $ = cheerio.load(html);
  const tables = [];

  $('table.wikitable').each((_, table) => {
    const $table = $(table);
    // Ignore history/patch notes tables
    if ($table.hasClass('mw-collapsible') || $table.text().includes('Patch') || $table.text().includes('Release Notes')) {
      const headerText = $table.find('tr').first().text();
      if (/Date|Patch|Version/i.test(headerText)) return;
    }

    // Determine grid matrix with rowspan / colspan
    const grid = [];
    const rows = $table.find('tr');

    rows.each((rowIndex, row) => {
      const $row = $(row);
      const cells = $row.find('th, td');
      if (cells.length === 0) return;

      if (!grid[rowIndex]) grid[rowIndex] = [];
      let colIndex = 0;

      cells.each((_, cell) => {
        // Skip already filled slots (by rowspan above)
        while (grid[rowIndex][colIndex] !== undefined) {
          colIndex++;
        }

        const $cell = $(cell);
        const rowspan = parseInt($cell.attr('rowspan') || '1', 10);
        const colspan = parseInt($cell.attr('colspan') || '1', 10);
        const isHeader = cell.tagName === 'th';
        
        // Remove style tags or annotations
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
      // Find header row(s) and data rows
      const headerRow = grid[0]?.map(cell => cell?.text || '') || [];
      const dataRows = grid.slice(1).map(row => (row || []).map(cell => cell?.text || ''));
      tables.push({
        rawHtml: $table.html(),
        isSupercharge: /supercharge/i.test($table.text()),
        header: headerRow,
        data: dataRows
      });
    }
  });

  return tables;
}

async function testPage(pageTitle) {
  console.log(`\n========================================\nTesting page: ${pageTitle}\n========================================`);
  const res = await client.get('', {
    params: { action: 'parse', page: pageTitle, prop: 'text', format: 'json' }
  });
  const html = res.data?.parse?.text?.['*'];
  if (!html) {
    console.log('No HTML returned!');
    return;
  }
  const tables = extractHtmlTables(html);
  console.log(`Found ${tables.length} valid wikitables.`);
  tables.forEach((t, i) => {
    console.log(`\nTable ${i} (isSupercharge: ${t.isSupercharge}):`);
    console.log('  Headers:', t.header.slice(0, 8));
    console.log('  Row count:', t.data.length);
    if (t.data.length > 0) {
      console.log('  Row 1:', t.data[0].slice(0, 8));
      if (t.data.length > 1) {
        console.log(`  Row ${t.data.length}:`, t.data[t.data.length - 1].slice(0, 8));
      }
    }
  });
}

(async () => {
  try {
    await testPage('Cannon/Home Village');
    await testPage('Barbarian King');
    await testPage('Giant Gauntlet');
    await testPage('Raged Barbarian');
    await testPage('Battle Machine');
  } catch (err) {
    console.error('Error:', err.message);
  }
})();

