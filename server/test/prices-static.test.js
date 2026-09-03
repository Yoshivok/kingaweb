/* ═══════════════════════════════════════════════════════════════════════════
   A TARTALÉKTÁBLA ÉS A BEÉPÍTETT ÁRLISTA EGYEZÉSE
   ─────────────────────────────────────────────────────────────────────────
   A `masszazs/index.html` táblázata azt szolgálja ki, akinél nem fut a
   JavaScript — a `server/lib/prices.js` `seed()`-je pedig az induló adat.
   A kettő a REPÓ két fele ugyanarról: együtt kell módosulniuk.

   Ha ez a teszt elhasal, valaki az egyiket átírta, a másikat nem — és a
   JavaScript nélküli látogató más árat lát, mint a többiek.

   FIGYELEM: ez NEM az éles árat ellenőrzi. Az admin felületen mentett árak a
   `server/data/prices.json`-ben élnek, és jogosan térnek el a beépítettől.
   Arra a `npm run arak` diagnosztika való.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { readStaticTable } = require('../tools/static-table');
const { seed } = require('../lib/prices');

describe('A statikus tartaléktábla és a beépített árlista', () => {
  const table = readStaticTable();
  const built = seed();

  it('ugyanazokat az oszlopokat használja', () => {
    assert.deepEqual(table.durations, built.durations,
      'a táblázat fejléce és a beépített időtartamok eltérnek');
  });

  it('ugyanannyi kezelést sorol fel', () => {
    assert.equal(table.rows.length, built.treatments.length,
      'statikus sorok: ' + table.rows.map((r) => r.name).join(', ')
      + ' | beépített: ' + built.treatments.map((t) => t.name).join(', '));
  });

  it('soronként ugyanazt a nevet és árat mutatja', () => {
    table.rows.forEach((row, i) => {
      const t = built.treatments[i];
      assert.ok(t, `a(z) ${i + 1}. statikus sorhoz („${row.name}”) nincs beépített kezelés`);

      assert.equal(row.name, t.name, `${i + 1}. sor neve eltér`);
      assert.equal(row.footnote, t.footnote, `„${row.name}” csillagozása eltér`);

      for (const d of built.durations) {
        assert.equal(row.prices[d], t.prices[d] ?? null,
          `„${row.name}” ${d} perces ára eltér — `
          + `statikus: ${row.prices[d]}, beépített: ${t.prices[d] ?? null}`);
      }
    });
  });

  it('a horgonyok a beépített horgonyokkal egyeznek', () => {
    /* A horgony viszi a látogatót a kezelés leírásához. Elgépelve némán
       nem történik semmi kattintásra. */
    table.rows.forEach((row, i) => {
      assert.equal(row.anchor, built.treatments[i].anchor, `„${row.name}” horgonya eltér`);
    });
  });
});
