/* ═══════════════════════════════════════════════════════════════════════════
   ÁRAK — a Salvia Gyógymasszázs árlistája
   ─────────────────────────────────────────────────────────────────────────
   A `masszazs/index.html` árlistája eddig kézzel írt HTML-tábla volt. Most
   adat, amit az admin szerkeszthet.

   AZ ÖSSZEG EGÉSZ SZÁM, nem szöveg. Ez szándékos, és három dolgot ad:
   • egységes megjelenítés (mindenhol „8 900 Ft”, nem hol „8900Ft”, hol
     „8.900 ft”),
   • ellenőrizhetőség (a 0 és a mínusz kiszűrhető),
   • az elérhetőség egyértelmű jelölése: `null` = az adott kezelés ilyen
     hosszban nem kérhető, ez a táblázatban a „—”.

   Az árlista egyben a foglalási űrlap forrása is: ami itt `null`, az ott meg
   sem jelenik választható időtartamként. Enélkül a látogató olyan hosszt
   választhatna, aminek nincs ára — a két helyen külön karbantartott lista
   pedig előbb-utóbb elcsúszik egymástól.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { DATA_DIR, text, saveJson, readJsonSync } = require('./jsonfile');

const PRICES_FILE = path.join(DATA_DIR, 'prices.json');

const LIMITS = {
  durations: 10,
  treatments: 30,
  notes: 10,
  name: 80,
  note: 320,
  key: 40,
  minDuration: 5,
  maxDuration: 300,
  maxAmount: 10000000
};

/* Kulcs és horgony: csak ékezet nélküli kisbetű, szám és kötőjel. A horgony
   a weboldal `#gyogymasszazs` jellegű ugrópontjaira mutat, ezért nem lehet
   benne semmi, ami az URL-ben mást jelentene. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

function slug(value) {
  const s = text(value, LIMITS.key).toLowerCase();
  return SLUG.test(s) ? s : '';
}

function duration(value) {
  const n = Number(value);
  return (Number.isInteger(n) && n >= LIMITS.minDuration && n <= LIMITS.maxDuration) ? n : null;
}

/** Összeg: egész forint, vagy `null` (= nem elérhető). */
function amount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded <= 0 || rounded > LIMITS.maxAmount) return null;
  return rounded;
}

/**
 * A beérkező árlistát engedélyezett mezőkből újraépíti.
 * Nem javítgat: amit nem ismer fel, azt kihagyja.
 * @returns {{ok: true, data: object} | {ok: false, error: string}}
 */
function normalise(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Hibás árlista.' };
  }

  /* ── Időtartamok: egyediek, növekvő sorrendben ── */
  const seen = new Set();
  const durations = [];
  for (const raw of (Array.isArray(input.durations) ? input.durations : [])) {
    const d = duration(raw);
    if (d === null || seen.has(d)) continue;
    seen.add(d);
    durations.push(d);
    if (durations.length >= LIMITS.durations) break;
  }
  durations.sort((a, b) => a - b);
  if (!durations.length) return { ok: false, error: 'Legalább egy időtartam kell.' };

  /* ── Kezelések ── */
  const usedKeys = new Set();
  const treatments = [];
  for (const raw of (Array.isArray(input.treatments) ? input.treatments : [])) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;

    const name = text(raw.name, LIMITS.name);
    if (name.length < 2) continue;

    /* Kulcs nélkül (vagy ütközésnél) generálunk egyet: a kulcs köti össze a
       sort a foglalási űrlap kezelésválasztójával. */
    let key = slug(raw.key);
    if (!key || usedKeys.has(key)) key = 'k_' + crypto.randomBytes(5).toString('hex');
    usedKeys.add(key);

    const prices = {};
    const rawPrices = (raw.prices && typeof raw.prices === 'object' && !Array.isArray(raw.prices))
      ? raw.prices : {};
    for (const d of durations) {
      prices[d] = amount(rawPrices[d]);
    }

    treatments.push({
      key,
      name,
      /* A horgony a weboldalon lévő szakaszra mutat; ha nincs, a név nem lesz
         hivatkozás, csak szöveg. */
      anchor: slug(raw.anchor),
      footnote: raw.footnote === true,
      prices
    });

    if (treatments.length >= LIMITS.treatments) break;
  }
  if (!treatments.length) return { ok: false, error: 'Legalább egy kezelés kell.' };

  /* ── Megjegyzések a táblázat alatt ── */
  const notes = [];
  for (const raw of (Array.isArray(input.notes) ? input.notes : [])) {
    const body = (raw && typeof raw === 'object' && !Array.isArray(raw))
      ? text(raw.text, LIMITS.note)
      : text(raw, LIMITS.note);
    if (!body) continue;
    notes.push({ mark: !!(raw && typeof raw === 'object' && raw.mark === true), text: body });
    if (notes.length >= LIMITS.notes) break;
  }

  return {
    ok: true,
    data: { version: 1, durations, treatments, notes, updatedAt: new Date().toISOString() }
  };
}

/* ── Betöltés és mentés ─────────────────────────────────────────────────── */
let cache = null;
let etagValue = '';

function computeEtag(data) {
  const json = JSON.stringify({ d: data.durations, t: data.treatments, n: data.notes });
  return '"' + crypto.createHash('sha1').update(json).digest('base64url').slice(0, 22) + '"';
}

function load() {
  if (cache) return cache;
  const raw = readJsonSync(PRICES_FILE, null);
  const result = normalise(raw || seed());

  /* A lemezen lévő adat is átmegy az ellenőrzésen. Ha valaki kézzel elrontja
     a fájlt, a beépített árlista lép a helyébe — üres táblázat helyett. */
  cache = result.ok ? result.data : normalise(seed()).data;

  if (!raw) saveJson(PRICES_FILE, cache).catch(() => {});
  etagValue = computeEtag(cache);
  return cache;
}

function get() { return load(); }
function etag() { load(); return etagValue; }

async function save(input) {
  const result = normalise(input);
  if (!result.ok) return result;

  await saveJson(PRICES_FILE, result.data);
  cache = result.data;
  etagValue = computeEtag(cache);
  return { ok: true, data: cache };
}

/* ── A kezdeti árlista ────────────────────────────────────────────────────
   Ugyanaz, ami eddig kézzel volt beírva a `masszazs/index.html`-be. Az admin
   bármelyik összeget átírhatja; a „—” cellák itt `null`-ok. */
function seed() {
  const row = (key, name, anchor, footnote, values) => ({
    key, name, anchor, footnote,
    prices: { 20: values[0], 30: values[1], 40: values[2], 45: values[3], 60: values[4], 90: values[5] }
  });

  return {
    version: 1,
    durations: [20, 30, 40, 45, 60, 90],
    treatments: [
      row('gyogymasszazs', 'Gyógymasszázs', 'gyogymasszazs', false,
        [null, 9000, null, 13000, 16000, 23000]),
      row('svedmasszazs', 'Svédmasszázs', 'svedmasszazs', false,
        [null, 7500, null, 9000, 13000, 16000]),
      row('nyirokmasszazs', 'Nyirokmasszázs, drenázs', 'nyirokmasszazs', false,
        [null, 10000, null, 15000, 17000, null]),
      row('cellulitmasszazs', 'Cellulitmasszázs, zsírtörés', 'cellulitmasszazs', true,
        [null, 10000, null, 15000, 17000, null]),
      row('szegmentmasszazs', 'Szegmentmasszázs', 'szegmentmasszazs', false,
        [null, null, null, null, 17000, null]),
      row('kotoszoveti', 'Kötőszöveti masszázs', 'kotoszoveti-masszazs', false,
        [null, null, null, null, 17000, null]),
      row('szekmasszazs', 'Székmasszázs', 'szekmasszazs', false,
        [6000, 7000, null, 9000, null, null]),
      row('arcmasszazs', 'Arcmasszázs', 'arcmasszazs', false,
        [5000, 7000, null, null, null, null]),
      row('talpmasszazs', 'Talpmasszázs', 'talpmasszazs', false,
        [5500, 7500, 9500, null, null, null])
    ],
    notes: [
      {
        mark: true,
        text: 'A cellulitkezelés ára tartalmazza a felhasznált hatóanyagokat, a köpölyözést és a tekercselést.'
      },
      {
        mark: false,
        text: 'A „—” jelölés azt jelenti, hogy az adott kezelés ilyen hosszban szakmailag nem indokolt, ezért nem kérhető.'
      },
      {
        mark: false,
        text: 'Az első alkalom rövid állapotfelméréssel indul, amely nem csökkenti a kezelési időt.'
      }
    ]
  };
}

module.exports = { LIMITS, get, etag, save, seed };
