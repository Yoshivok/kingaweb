/* ═══════════════════════════════════════════════════════════════════════════
   ÁRAK ÖSSZEVETÉSE — mit lát valójában a látogató?
   ─────────────────────────────────────────────────────────────────────────
   Az árlista három helyen él (lásd `static-table.js`), és élesben mindig a
   `server/data/prices.json` győz. Ez a szkript egymás mellé teszi a hármat,
   és megmondja, hol csúsztak el.

   Miért kell: ha valaki a `seed()`-et írja át, az a MENTETT árlistán nem
   változtat semmit — a fájl már létezik, a seed csak akkor futna le, ha nem.
   Ilyenkor a látogató a régi árat látja, és semmi nem szól érte.

   Futtatás:  npm run arak
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { readStaticTable } = require('./static-table');
const { seed } = require('../lib/prices');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const LIVE_FILE = path.join(DATA_DIR, 'prices.json');

const ft = (v) => (v == null ? '—' : String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ft');

function readLive() {
  try {
    return JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const table = readStaticTable();
  const built = seed();
  const live = readLive();

  console.log('\n  ÁRLISTA — a három forrás összevetése');
  console.log('  ' + '─'.repeat(64));
  console.log(`  éles adat:   ${LIVE_FILE}`);
  console.log(`  tartalék:    masszazs/index.html táblázata`);
  console.log(`  beépített:   server/lib/prices.js → seed()\n`);

  if (!live) {
    console.log('  Az éles adatfájl még nem létezik.');
    console.log('  A kiszolgáló első indításakor a beépített árlistából jön létre.\n');
    return 0;
  }

  const liveRows = live.treatments || [];
  const problems = [];

  /* ── Kezelések: ami csak az egyik oldalon van ── */
  const liveNames = liveRows.map((t) => t.name);
  const staticNames = table.rows.map((r) => r.name);

  for (const name of liveNames) {
    if (!staticNames.includes(name)) {
      problems.push(`Az élesben szerepel, de a tartaléktáblából hiányzik: „${name}”`);
    }
  }
  for (const name of staticNames) {
    if (!liveNames.includes(name)) {
      problems.push(`A tartaléktáblában szerepel, de élesben nincs: „${name}”`);
    }
  }

  /* ── Árak soronként ── */
  const durations = live.durations || [];
  for (const row of table.rows) {
    const t = liveRows.find((x) => x.name === row.name);
    if (!t) continue;

    for (const d of durations) {
      const liveValue = t.prices[d] ?? null;
      const staticValue = row.prices[d] ?? null;
      if (liveValue !== staticValue) {
        problems.push(
          `„${row.name}” ${d} perc — éles: ${ft(liveValue)}, tartalék: ${ft(staticValue)}`
        );
      }
    }
  }

  /* ── Az éles adat táblázata ── */
  const width = Math.max(...liveRows.map((t) => t.name.length), 10);
  console.log('  ÉLES ÁRAK (ezt látja a látogató):\n');
  console.log('  ' + 'Kezelés'.padEnd(width) + '  ' + durations.map((d) => String(d + " p").padStart(11)).join(''));
  for (const t of liveRows) {
    console.log('  ' + t.name.padEnd(width) + '  '
      + durations.map((d) => ft(t.prices[d] ?? null).padStart(11)).join(''));
  }
  console.log('');

  if (live.updatedAt) console.log(`  Utoljára mentve: ${live.updatedAt}\n`);

  /* ── A beépített árlista eltérése: csak tájékoztatás ── */
  const seedDiffers = JSON.stringify(built.treatments.map((t) => [t.name, t.prices]))
    !== JSON.stringify(liveRows.map((t) => [t.name, t.prices]));
  if (seedDiffers) {
    console.log('  ℹ A beépített (seed) árlista eltér az élestől.');
    console.log('    Ez ÖNMAGÁBAN rendben van: az admin felületen mentett árak felülírják.');
    console.log('    De ha a seedbe most írtál új árakat, azok NEM jutnak ki maguktól —');
    console.log('    mentsd őket az admin felületen, vagy töröld a prices.json-t és');
    console.log('    indítsd újra a kiszolgálót.\n');
  }

  if (problems.length) {
    console.log('  ⚠ ELTÉRÉS az éles adat és a tartaléktábla között:\n');
    for (const p of problems) console.log('    • ' + p);
    console.log('\n    Akinél nem fut a JavaScript, a tartaléktáblát látja — vagyis');
    console.log('    más árat, mint a többiek. Írd át a masszazs/index.html táblázatát');
    console.log('    az éles árakra.\n');
    return 1;
  }

  console.log('  ✓ Az éles adat és a tartaléktábla egyezik.\n');
  return 0;
}

process.exitCode = main();
