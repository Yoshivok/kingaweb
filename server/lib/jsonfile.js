/* ═══════════════════════════════════════════════════════════════════════════
   JSON-ADATTÁR — közös alap a termékeknek és az áraknak
   ─────────────────────────────────────────────────────────────────────────
   Két dolgot old meg, amit minden lemezre író adattárnak meg kell oldania,
   és amit külön-külön megírva előbb-utóbb elrontanánk valamelyikben:

   • ATOMI ÍRÁS — mindig ideiglenes fájlba, majd `rename`. A `rename` a
     fájlrendszer szintjén oszthatatlan: vagy a régi, vagy az új tartalom
     látszik, félig írt fájl soha. Áramszünet vagy `kill` közben sem lehet
     csonka a products.json.

   • SOROSÍTÁS — egyetlen írási sor az ÖSSZES adattárnak. Két egyszerre
     érkező mentés így nem tud egymásba lógni, és a lemez sem kap egyszerre
     több párhuzamos írást.

   Ezen felül itt él a szövegtisztítás (`text`), mert a szabály mindkét
   adattárnál ugyanaz: vezérlőkarakterek ki, whitespace normalizálva, hossz
   vágva. HTML-escape NINCS — a megjelenítés `textContent`-tel megy, ami
   elvből nem értelmez jelölőnyelvet.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/* Alapesetben a `server/data`. Teszteléshez a DATA_DIR környezeti változóval
   máshová irányítható — így a próbafutás nem nyúl az éles adatokhoz. Éles
   indításkor a változó nincs beállítva, tehát minden marad a régiben. */
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

/* Vezérlőkarakterek: sortörés nélkül (egysoros mező) és sortöréssel együtt
   (többsoros mező). A tabulátor is kiesik — a megjelenítést csak zavarná. */
const CTRL_ALL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g;
const CTRL_KEEP_LF = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g;

/**
 * Beérkező szöveg megtisztítása és hosszra vágása.
 * @param {*} value bármi; ami nem szöveg, azzá alakul
 * @param {number} max legfeljebb ennyi karakter marad
 * @param {{multiline?: boolean}} [options] többsorosnál a sortörés megmarad
 */
function text(value, max, { multiline = false } = {}) {
  let s = typeof value === 'string' ? value : (value == null ? '' : String(value));
  s = s.normalize('NFC');

  if (multiline) {
    s = s.replace(/\r\n?/g, '\n').replace(CTRL_KEEP_LF, '');
    s = s.replace(/[^\S\n]+/g, ' ').replace(/ +\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  } else {
    s = s.replace(CTRL_ALL, ' ').replace(/\s+/g, ' ').trim();
  }
  return s.slice(0, max);
}

/** Engedélyezett értékek közül választ, különben a tartalékot adja. */
function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

async function ensureDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
}

/* Egyetlen írási sor minden adattárnak. Egy hibás mentés nem szakíthatja meg:
   a lánc folytatása mindkét ágon (`then(task, task)`) ugyanaz. */
let writeChain = Promise.resolve();

function serialise(task) {
  const next = writeChain.then(task, task);
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

/** Atomi írás: ideiglenes fájl, majd átnevezés. */
async function writeJsonAtomic(file, value, mode = 0o600) {
  await ensureDir();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode });
  await fsp.rename(tmp, file);
}

/** Ugyanaz, sorba állítva a többi írás mögé. */
function saveJson(file, value, mode) {
  return serialise(() => writeJsonAtomic(file, value, mode));
}

/**
 * JSON beolvasása. Hiányzó vagy hibás fájlra a tartalékot adja — nem dob,
 * mert egy elrontott adatfájl miatt ne álljon meg az egész kiszolgáló.
 *
 * A reviver a `__proto__` és `constructor` kulcsot eldobja: a `JSON.parse`
 * önmagában nem tenné őket a prototípusra, de ha az adat később bárhol
 * összefésülődne, ezzel az sem tud prototípus-szennyezéssé válni.
 */
function readJsonSync(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw, (key, value) =>
      (key === '__proto__' || key === 'constructor') ? undefined : value);
  } catch {
    return fallback;
  }
}

module.exports = {
  DATA_DIR,
  text, pick,
  ensureDir, serialise, writeJsonAtomic, saveJson, readJsonSync
};
