/* ═══════════════════════════════════════════════════════════════════════════
   A STATIKUS ÁRTÁBLA KIOLVASÁSA a masszazs/index.html-ből
   ─────────────────────────────────────────────────────────────────────────
   A weboldalon HÁROM helyen van árlista, és könnyű elfelejteni valamelyiket:

     1. `server/data/prices.json` — az ÉLES adat. Ezt írja az admin, ezt adja
        a `/api/prices`, és a látogató végül ezt látja.
     2. `server/lib/prices.js` → `seed()` — a beépített kiindulás. CSAK akkor
        fut le, ha a prices.json még nem létezik.
     3. `masszazs/index.html` táblázata — TARTALÉK annak, akinél nem fut a
        JavaScript, és az marad a képernyőn, ha a kiszolgáló nem válaszol.

   Ez a modul a 3. pontot olvassa ki gépi formában, hogy össze lehessen vetni
   a másik kettővel. Nem HTML-elemző: pontosan azt az egy táblázatot ismeri,
   amit mi írtunk — ha a szerkezet változik, inkább hangosan elhasal, mint
   hogy csendben rossz eredményt adjon.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'masszazs', 'index.html');

/** „9&nbsp;000 Ft” → 9000; „—” → null */
function parseAmount(cell) {
  const clean = cell.replace(/&nbsp;/g, '').replace(/\s/g, '').replace(/Ft$/, '');
  if (!clean || clean === '—' || clean === '-') return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

/**
 * A tartaléktábla kiolvasása.
 * @returns {{durations: number[], rows: {name: string, anchor: string, footnote: boolean, prices: object}[]}}
 */
function readStaticTable(file = PAGE) {
  const html = fs.readFileSync(file, 'utf8');

  const start = html.indexOf('<table class="price-table"');
  if (start === -1) throw new Error('Nem találom a price-table táblázatot: ' + file);
  const table = html.slice(start, html.indexOf('</table>', start));

  /* ── Oszlopfejlécek: „30 perc” → 30 ── */
  const head = table.slice(table.indexOf('<thead>'), table.indexOf('</thead>'));
  const durations = [...head.matchAll(/<th[^>]*>\s*(\d+)\s*perc\s*<\/th>/g)].map((m) => Number(m[1]));
  if (!durations.length) throw new Error('A táblázat fejlécében nincs egyetlen időtartam sem.');

  /* ── Sorok ── */
  const body = table.slice(table.indexOf('<tbody>'), table.indexOf('</tbody>'));
  const rows = [];

  for (const chunk of body.split('<tr>').slice(1)) {
    const nameMatch = chunk.match(/<th scope="row">\s*(?:<a[^>]*href="#([^"]*)"[^>]*>)?([\s\S]*?)<\/(?:a|th)>/);
    if (!nameMatch) continue;

    const anchor = nameMatch[1] || '';
    /* A lábjegyzet-csillag a JELÖLÉS, nem a név része — külön mezőben tartjuk. */
    const name = nameMatch[2]
      .replace(/<span[^>]*price-table__mark[^>]*>[\s\S]*?<\/span>/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const footnote = /price-table__mark/.test(chunk);

    const cells = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => parseAmount(m[1]));
    if (cells.length !== durations.length) {
      throw new Error(`A(z) „${name}” sorban ${cells.length} cella van, de ${durations.length} oszlop.`);
    }

    const prices = {};
    durations.forEach((d, i) => { prices[d] = cells[i]; });
    rows.push({ name, anchor, footnote, prices });
  }

  if (!rows.length) throw new Error('A táblázat törzsében nincs egyetlen sor sem.');
  return { durations, rows };
}

module.exports = { readStaticTable, parseAmount, PAGE, ROOT };
