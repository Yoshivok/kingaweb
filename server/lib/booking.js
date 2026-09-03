/* ═══════════════════════════════════════════════════════════════════════════
   FOGLALÁS — időpontok, nyitvatartás, szünetek, szabadnapok
   ─────────────────────────────────────────────────────────────────────────
   Ez a modul dönti el, MIKOR lehet foglalni, és ez tárolja a leadott
   foglalásokat. Két weboldalt szolgál ki (`masszazs`, `optika`), egymástól
   független naptárral: a két helyszín külön nyitvatartással, külön
   szünetekkel és külön foglalásokkal dolgozik.

   ── A SZABÁLY, AMI AZ EGÉSZET ÖSSZETARTJA ──────────────────────────────
   Egy foglalás nem a kezelés hosszáig foglalja a naptárt, hanem
   ANNÁL 20 PERCCEL TOVÁBB. A masszázs és a látásvizsgálat is megterhelő,
   a következő vendég előtt pihenni kell — ezért minden foglalás egy
   „elfoglalt sávot” képez:

       elfoglalt sáv = [kezdés,  kezdés + hossz + pihenő)

   Két foglalás akkor és csak akkor fér el egymás mellett, ha az elfoglalt
   sávjaik NEM fedik át egymást. Ez az egyetlen szabály, és ez adja meg
   mindkét irányt magától:

   • ELŐRE:  9:00-kor egy 45 perces kezelés sávja 9:00–10:05. A következő
             vendég legkorábban 10:05-re jöhet.
   • VISSZA: ha 10:00-ra már van egy foglalás, elé 45 percet nem lehet
             tenni 9:00-ra (a sávja 10:05-ig érne, belelógna a 10:00-ásba),
             30 percet viszont igen (a sávja 9:50-kor véget ér).

   A pihenő a NAP VÉGÉN nem kell hogy beleférjen a nyitvatartásba: a
   kezelésnek kell zárásig befejeződnie, a pihenő már a zárás után is
   lefuthat. Ugyanígy a szünetekkel: a szünet maga a pihenés, ezért elé és
   mögé nem kérünk még egy pihenőt — csak a KEZELÉS nem lóghat bele.

   ── HONNAN JÖNNEK A FELKÍNÁLT ÓRÁK ─────────────────────────────────────
   Nem fix órarácsból. A jelöltek három forrásból állnak össze:
     1. a nyitás, majd onnan lépésköznyi (alapból 30 perc) rács,
     2. minden meglévő foglalás elfoglalt sávjának a VÉGE  — így jelenik
        meg a 10:05-höz hasonló, „közvetlenül az előző után” kezdés,
     3. minden szünet vége.
   Ezután mindegyik jelölt átmegy a fenti szabályon. Ami átmegy, azt
   kínáljuk fel; ami nem, arról a vendég nem is tud.

   ── AMI NEM ITT DÖNTŐDIK EL ────────────────────────────────────────────
   A hosszak és az árak a `prices.js`-ből jönnek (masszázs), illetve a
   nyitvatartás mellett tárolt hosszakból (optika). Így a foglalható
   időtartam soha nem tud elcsúszni az árlistától.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const {
  DATA_DIR, text, saveJson, readJsonSync, serialise, writeJsonAtomic
} = require('./jsonfile');
const prices = require('./prices');

const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');

/* A kiszolgáló futhat UTC-ben; a nyitvatartás viszont helyi idő. Minden
   „ma” és „most” EBBEN az időzónában értendő. */
const TIME_ZONE = process.env.TIME_ZONE || 'Europe/Budapest';

const SITES = ['masszazs', 'optika'];

const LIMITS = {
  bookings: 6000,          /* ennél többet nem tartunk a fájlban */
  keepDays: 550,           /* a régi foglalások mentéskor kihullanak */
  name: 120,
  phone: 40,
  email: 160,
  message: 2000,
  label: 60,
  breaks: 16,
  closures: 80,
  buffer: 180,
  step: 120,
  minDuration: 5,
  maxDuration: 300,
  horizonDays: 365,
  perDay: 40               /* egy napra legfeljebb ennyi foglalás */
};

/* Az optika vizsgálatai. A NEVEK és a KULCSOK itt élnek, mert az `optika/
   index.html` rádiógombjainak értéke ugyanez — a hosszuk viszont a
   nyitvatartás mellett, szerkeszthetően (lásd `serviceDurations`). */
const OPTIKA_SERVICES = [
  { key: 'general-exam', name: 'Komplett látásvizsgálat' },
  { key: 'contact-lens', name: 'Kontaktlencse-illesztés' },
  { key: 'glasses-fitting', name: 'Szemüvegkészítés, tanácsadás' },
  { key: 'glasses-repair', name: 'Szemüvegjavítás' }
];

/* A masszázs árlistájában nem szereplő, mégis kérhető tétel: aki nem tudja,
   melyik kezelés kell neki, rövid állapotfelmérésre jön. */
const MASSZAZS_CONSULT = { key: 'tanacs', name: 'Tanácsadás, állapotfelmérés', durations: [30] };

/* ══════════════════════════════════════════════════════════════════════════
   1. IDŐKEZELÉS
   ══════════════════════════════════════════════════════════════════════ */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/** Valódi naptári nap-e a szöveg? A `2026-02-31` alakilag jó, mégsem az. */
function isDay(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** '09:30' → 570. Hibás alakra `null`. */
function toMinutes(value) {
  if (typeof value !== 'string' || !CLOCK_RE.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/** 570 → '09:30'. A 24:00 fölé nyúló érték (pihenő zárás után) is olvasható. */
function toClock(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const p = (n) => (n < 10 ? '0' : '') + n;
  return p(Math.floor(m / 60)) + ':' + p(m % 60);
}

/** A hét napja: 0 = vasárnap … 6 = szombat. UTC-ben számoljuk, hogy a
    kiszolgáló időzónája ne tolhassa el a naptárt egy nappal. */
function weekdayOf(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(day, count) {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + count));
  const p = (n) => (n < 10 ? '0' : '') + n;
  return dt.getUTCFullYear() + '-' + p(dt.getUTCMonth() + 1) + '-' + p(dt.getUTCDate());
}

/** Hány nap telik el `from`-tól `to`-ig (előjelesen)? */
function daysBetween(from, to) {
  const utc = (day) => {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86400000);
}

/** A mostani nap és percérték a nyitvatartás időzónájában. */
function nowParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());

  const p = {};
  for (const part of parts) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: (Number(p.hour) % 24) * 60 + Number(p.minute)
  };
}

function today() { return nowParts().date; }

/** Két félig nyílt intervallum átfedése. */
function overlaps(aFrom, aTo, bFrom, bTo) {
  return aFrom < bTo && bFrom < aTo;
}

/* ══════════════════════════════════════════════════════════════════════════
   2. NYITVATARTÁS, SZÜNETEK, SZABADNAPOK
   ══════════════════════════════════════════════════════════════════════ */

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

function intOr(value, min, max, fallback) {
  const n = Number(value);
  return (Number.isInteger(n) && n >= min && n <= max) ? n : fallback;
}

/** Egy nap nyitvatartása: `{from, to}` percben, vagy `null` (zárva). */
function normaliseHours(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const from = toMinutes(raw.from);
  const to = toMinutes(raw.to);
  if (from === null || to === null || to <= from) return null;
  return { from: toClock(from), to: toClock(to) };
}

/** Napok listája a hétből: 0–6, egyediek, növekvő sorrendben. */
function normaliseDays(raw) {
  const seen = new Set();
  for (const value of (Array.isArray(raw) ? raw : [])) {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 0 && n <= 6) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

function normaliseBreaks(raw) {
  const list = [];
  for (const item of (Array.isArray(raw) ? raw : [])) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const from = toMinutes(item.from);
    const to = toMinutes(item.to);
    if (from === null || to === null || to <= from) continue;

    const days = normaliseDays(item.days);
    if (!days.length) continue;

    list.push({
      id: /^brk_[a-f0-9]{16}$/.test(item.id) ? item.id : newId('brk'),
      label: text(item.label, LIMITS.label) || 'Szünet',
      days,
      from: toClock(from),
      to: toClock(to)
    });
    if (list.length >= LIMITS.breaks) break;
  }
  return list;
}

function normaliseClosures(raw) {
  const list = [];
  for (const item of (Array.isArray(raw) ? raw : [])) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const from = isDay(item.from) ? item.from : null;
    if (!from) continue;
    const to = (isDay(item.to) && item.to >= from) ? item.to : from;

    /* Ésszerűtlenül hosszú „szabadság” a naptárat tenné használhatatlanná. */
    if (daysBetween(from, to) > 366) continue;

    list.push({
      id: /^cls_[a-f0-9]{16}$/.test(item.id) ? item.id : newId('cls'),
      label: text(item.label, LIMITS.label) || 'Szabadnap',
      from,
      to
    });
    if (list.length >= LIMITS.closures) break;
  }
  list.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return list;
}

/** Az optika vizsgálati hosszai — kulcsonként egy percérték. */
function normaliseServiceDurations(raw, fallback) {
  const out = {};
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  for (const service of OPTIKA_SERVICES) {
    out[service.key] = intOr(source[service.key], LIMITS.minDuration, LIMITS.maxDuration,
      (fallback && fallback[service.key]) || 30);
  }
  return out;
}

function normaliseSite(raw, site, defaults) {
  const base = defaults || defaultSite(site);
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};

  const hours = [];
  const rawHours = Array.isArray(input.hours) ? input.hours : [];
  for (let day = 0; day < 7; day++) {
    hours.push(rawHours.length ? normaliseHours(rawHours[day]) : base.hours[day]);
  }

  const out = {
    buffer: intOr(input.buffer, 0, LIMITS.buffer, base.buffer),
    step: intOr(input.step, 5, LIMITS.step, base.step),
    leadMinutes: intOr(input.leadMinutes, 0, 30 * 24 * 60, base.leadMinutes),
    horizonDays: intOr(input.horizonDays, 1, LIMITS.horizonDays, base.horizonDays),
    hours,
    breaks: normaliseBreaks(input.breaks),
    closures: normaliseClosures(input.closures)
  };

  if (site === 'optika') {
    out.serviceDurations = normaliseServiceDurations(input.serviceDurations, base.serviceDurations);
  }
  return out;
}

/* ── Alapértelmezett nyitvatartás ─────────────────────────────────────────
   Ugyanaz, ami eddig a két weboldal szövegében szerepelt:
   masszázs H–P 8–19, Szo 9–13; optika H–P 9–19, Szo 10–15. Vasárnap zárva. */
function defaultSite(site) {
  const weekday = site === 'optika' ? { from: '09:00', to: '19:00' } : { from: '08:00', to: '19:00' };
  const saturday = site === 'optika' ? { from: '10:00', to: '15:00' } : { from: '09:00', to: '13:00' };

  const base = {
    /* Két időpont között MINDIG 20 perc pihenő. Ez a kérés lényege. */
    buffer: 20,
    /* A felkínált órák rácsa. A foglalások utáni kezdéseket ettől
       függetlenül is felkínáljuk (pl. 10:05). */
    step: 30,
    /* Ennyivel előbb kell foglalni: 2 óra. Aki most akar jönni, telefonáljon. */
    leadMinutes: 120,
    horizonDays: 120,
    hours: [null, weekday, weekday, weekday, weekday, weekday, saturday],
    breaks: [
      { id: newId('brk'), label: 'Ebédszünet', days: [1, 2, 3, 4, 5], from: '12:00', to: '12:30' }
    ],
    closures: []
  };

  if (site === 'optika') {
    /* „Egyelőre minden vizsgálat 30 perc.” Az admin bármikor átírhatja. */
    base.serviceDurations = {};
    for (const service of OPTIKA_SERVICES) base.serviceDurations[service.key] = 30;
  }
  return base;
}

function defaultSchedule() {
  const sites = {};
  for (const site of SITES) sites[site] = defaultSite(site);
  return { version: 1, sites, updatedAt: new Date().toISOString() };
}

function normaliseSchedule(raw, defaults) {
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const source = (input.sites && typeof input.sites === 'object') ? input.sites : {};
  const sites = {};
  for (const site of SITES) {
    sites[site] = normaliseSite(source[site], site, defaults && defaults.sites[site]);
  }
  return { version: 1, sites, updatedAt: new Date().toISOString() };
}

/* ── Betöltés és mentés ─────────────────────────────────────────────────── */
let scheduleCache = null;

function loadSchedule() {
  if (scheduleCache) return scheduleCache;
  const raw = readJsonSync(SCHEDULE_FILE, null);
  scheduleCache = normaliseSchedule(raw || defaultSchedule(), defaultSchedule());
  if (!raw) saveJson(SCHEDULE_FILE, scheduleCache).catch(() => {});
  return scheduleCache;
}

function schedule(site) {
  return loadSchedule().sites[site] || null;
}

async function saveSchedule(site, input) {
  if (!SITES.includes(site)) return { ok: false, error: 'Ismeretlen terület.' };

  const current = loadSchedule();
  const next = {
    version: 1,
    sites: Object.assign({}, current.sites),
    updatedAt: new Date().toISOString()
  };
  next.sites[site] = normaliseSite(input, site, defaultSite(site));

  /* Nyitvatartás nélküli hét = soha nincs szabad időpont. Ez majdnem
     biztosan elgépelés, ezért inkább szólunk, mint hogy némán elfogadjuk. */
  if (!next.sites[site].hours.some(Boolean)) {
    return { ok: false, error: 'Legalább egy napon meg kell adni a nyitvatartást.' };
  }

  await saveJson(SCHEDULE_FILE, next);
  scheduleCache = next;
  return { ok: true, schedule: next.sites[site] };
}

/* ══════════════════════════════════════════════════════════════════════════
   3. FOGLALÁSOK TÁRA
   ══════════════════════════════════════════════════════════════════════ */

let bookingCache = null;

function normaliseBooking(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!SITES.includes(raw.site)) return null;
  if (!isDay(raw.date)) return null;

  const start = toMinutes(raw.start);
  if (start === null) return null;

  const duration = intOr(raw.duration, LIMITS.minDuration, LIMITS.maxDuration, null);
  if (duration === null) return null;

  return {
    id: /^bk_[a-f0-9]{16}$/.test(raw.id) ? raw.id : newId('bk'),
    site: raw.site,
    date: raw.date,
    start: toClock(start),
    duration,
    buffer: intOr(raw.buffer, 0, LIMITS.buffer, 20),
    serviceKey: text(raw.serviceKey, 48),
    serviceName: text(raw.serviceName, 90),
    name: text(raw.name, LIMITS.name),
    phone: text(raw.phone, LIMITS.phone),
    email: text(raw.email, LIMITS.email),
    message: text(raw.message, LIMITS.message, { multiline: true }),
    source: raw.source === 'admin' ? 'admin' : 'web',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt.slice(0, 40) : new Date().toISOString()
  };
}

function loadBookings() {
  if (bookingCache) return bookingCache;
  const raw = readJsonSync(BOOKINGS_FILE, null);
  const list = [];
  for (const item of (raw && Array.isArray(raw.bookings) ? raw.bookings : [])) {
    const booking = normaliseBooking(item);
    if (booking) list.push(booking);
    if (list.length >= LIMITS.bookings) break;
  }
  bookingCache = { version: 1, bookings: list };
  return bookingCache;
}

/** A régi foglalások kihullatása: a naptár nem nő a végtelenségig. */
function prune(list) {
  const cutoff = addDays(today(), -LIMITS.keepDays);
  const kept = list.filter((b) => b.date >= cutoff);
  return kept.length > LIMITS.bookings ? kept.slice(-LIMITS.bookings) : kept;
}

/** Egy nap foglalásai, kezdés szerint rendezve. */
function bookingsOn(site, date) {
  return loadBookings().bookings
    .filter((b) => b.site === site && b.date === date)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/* ══════════════════════════════════════════════════════════════════════════
   4. SZOLGÁLTATÁSOK ÉS HOSSZAK
   ══════════════════════════════════════════════════════════════════════ */

/**
 * A területen foglalható szolgáltatások és a hozzájuk tartozó hosszak.
 * Masszázs: az árlistából — amihez nincs ár, az nem is foglalható.
 * Optika: rögzített lista, a hosszak a nyitvatartás mellől.
 * @returns {Array<{key: string, name: string, durations: number[], prices?: object}>}
 */
function services(site) {
  if (site === 'optika') {
    const cfg = schedule('optika');
    return OPTIKA_SERVICES.map((service) => ({
      key: service.key,
      name: service.name,
      durations: [cfg.serviceDurations[service.key]]
    }));
  }

  const data = prices.get();
  const list = data.treatments.map((treatment) => ({
    key: treatment.key,
    name: treatment.name,
    durations: data.durations.filter((min) => treatment.prices[min] != null),
    prices: treatment.prices
  })).filter((service) => service.durations.length);

  if (!list.some((service) => service.key === MASSZAZS_CONSULT.key)) {
    list.push({
      key: MASSZAZS_CONSULT.key,
      name: MASSZAZS_CONSULT.name,
      durations: MASSZAZS_CONSULT.durations.slice()
    });
  }
  return list;
}

function findService(site, key) {
  return services(site).find((service) => service.key === key) || null;
}

/* ══════════════════════════════════════════════════════════════════════════
   5. SZABAD IDŐPONTOK
   ══════════════════════════════════════════════════════════════════════ */

/** A napra érvényes szünetek (percben), a hét napja szerint szűrve. */
function breaksOn(cfg, date) {
  const day = weekdayOf(date);
  return cfg.breaks
    .filter((item) => item.days.includes(day))
    .map((item) => ({ from: toMinutes(item.from), to: toMinutes(item.to), label: item.label }))
    .sort((a, b) => a.from - b.from);
}

/** A napra eső szabadnap, vagy `null`. */
function closureOn(cfg, date) {
  return cfg.closures.find((item) => date >= item.from && date <= item.to) || null;
}

/**
 * Egy nap teljes képe: nyitvatartás, szünetek, zárás, foglalások.
 * Ez az EGYETLEN hely, ahol a nap szabályai összeállnak — a szabad órák és
 * az admin napi nézete is ebből dolgozik.
 */
function dayPlan(site, date) {
  const cfg = schedule(site);
  const hours = cfg.hours[weekdayOf(date)];
  const closure = closureOn(cfg, date);

  return {
    date,
    weekday: weekdayOf(date),
    open: hours ? { from: toMinutes(hours.from), to: toMinutes(hours.to) } : null,
    closure,
    /* Szabadnapon nincs mit szünetelni: a nap egésze zárva. */
    breaks: (hours && !closure) ? breaksOn(cfg, date) : [],
    bookings: bookingsOn(site, date),
    buffer: cfg.buffer,
    step: cfg.step
  };
}

/**
 * A `duration` perces kezelés lehetséges kezdései a megadott napon.
 *
 * @param {string} site
 * @param {string} date  ÉÉÉÉ-HH-NN
 * @param {number} duration percben
 * @param {{ignoreId?: string, ignoreLead?: boolean}} [options]
 * @returns {{ok: boolean, closed?: boolean, reason?: string, slots: string[], open?: object}}
 */
function slotsFor(site, date, duration, options = {}) {
  const cfg = schedule(site);
  const plan = dayPlan(site, date);
  const now = nowParts();

  if (date < now.date) {
    return { closed: true, reason: 'Ez a nap már elmúlt.', slots: [] };
  }
  if (daysBetween(now.date, date) > cfg.horizonDays) {
    return {
      closed: true,
      reason: `Ilyen messzire még nem lehet foglalni (legfeljebb ${cfg.horizonDays} nap).`,
      slots: []
    };
  }
  if (plan.closure) {
    return { closed: true, reason: plan.closure.label || 'Ezen a napon zárva tartunk.', slots: [] };
  }
  if (!plan.open) {
    return { closed: true, reason: 'Ezen a napon zárva tartunk.', slots: [] };
  }
  if (plan.bookings.length >= LIMITS.perDay) {
    return { closed: false, reason: 'Erre a napra már minden időpont elkelt.', slots: [], open: plan.open };
  }

  /* A már foglalt sávok: a kezelés MELLETT a pihenő is bennük van. */
  const occupied = plan.bookings
    .filter((b) => b.id !== options.ignoreId)
    .map((b) => {
      const from = toMinutes(b.start);
      return { from, to: from + b.duration + b.buffer };
    });

  /* A legkorábbi kezdés: mai napon a mostani idő + előfoglalási idő,
     felkerekítve 5 percre, hogy ne 10:37-es időpontot kínáljunk. */
  let earliest = plan.open.from;
  if (!options.ignoreLead && date === now.date) {
    earliest = Math.max(earliest, Math.ceil((now.minutes + cfg.leadMinutes) / 5) * 5);
  }

  /* ── Jelöltek ──
     A rács a nyitástól indul, és minden foglalás- és szünetvég külön
     jelöltként is bekerül: így jelenik meg a „közvetlenül az előző vendég
     után” kezdés (pl. 10:05), ami a rácsra sosem esne rá. */
  const candidates = new Set();
  for (let t = plan.open.from; t + duration <= plan.open.to; t += cfg.step) candidates.add(t);
  for (const slot of occupied) candidates.add(slot.to);
  for (const pause of plan.breaks) candidates.add(pause.to);
  candidates.add(plan.open.from);

  const slots = [];
  for (const start of [...candidates].sort((a, b) => a - b)) {
    if (start < earliest) continue;
    if (start < plan.open.from) continue;
    if (start + duration > plan.open.to) continue;

    /* A KEZELÉS nem lóghat bele a szünetbe. A pihenő beleérhet: a szünet
       maga is pihenés, nem kell elé-mögé még egy. */
    if (plan.breaks.some((p) => overlaps(start, start + duration, p.from, p.to))) continue;

    /* A kezelés ÉS a mögötte járó pihenő nem érhet hozzá más foglaláshoz. */
    const blockedTo = start + duration + cfg.buffer;
    if (occupied.some((s) => overlaps(start, blockedTo, s.from, s.to))) continue;

    slots.push(toClock(start));
  }

  return {
    closed: false,
    reason: slots.length ? '' : 'Erre a napra ilyen hosszban már nincs szabad időpont.',
    slots,
    open: plan.open
  };
}

/**
 * Egy hónap napjainak állapota a naptárhoz.
 * @param {string} month ÉÉÉÉ-HH
 */
function monthOverview(site, month, duration) {
  const [year, mon] = month.split('-').map(Number);
  const dayCount = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const days = {};

  for (let day = 1; day <= dayCount; day++) {
    const date = `${month}-${day < 10 ? '0' : ''}${day}`;
    const result = slotsFor(site, date, duration);
    days[date] = {
      state: result.closed ? 'closed' : (result.slots.length ? 'free' : 'full'),
      free: result.slots.length
    };
  }
  return days;
}

/* ══════════════════════════════════════════════════════════════════════════
   6. FOGLALÁS LÉTREHOZÁSA
   ══════════════════════════════════════════════════════════════════════ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

/**
 * Új foglalás. Az ellenőrzés és az írás EGY sorosított lépésben fut, ezért
 * két egyszerre érkező kérés nem foglalhatja le ugyanazt a sávot: a második
 * már a frissített listát látja, és „elkelt” hibát kap.
 *
 * @param {object} input a kliens nyers adata
 * @param {{admin?: boolean}} [options] adminként a nyitvatartás és az
 *        előfoglalási idő nem korlátoz — az ütközés viszont igen
 */
async function create(input, options = {}) {
  const admin = options.admin === true;
  const raw = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};

  const site = SITES.includes(raw.site) ? raw.site : null;
  if (!site) return { ok: false, error: 'Ismeretlen terület.' };

  const service = findService(site, text(raw.serviceKey, 48));
  if (!service) return { ok: false, error: 'Ezt a szolgáltatást nem tudjuk foglalni.' };

  const duration = Number(raw.duration);
  if (!service.durations.includes(duration)) {
    return { ok: false, error: 'Ez a hossz ehhez a szolgáltatáshoz nem választható.' };
  }

  const date = isDay(raw.date) ? raw.date : null;
  if (!date) return { ok: false, error: 'Hiányzó vagy hibás dátum.' };

  const start = toMinutes(raw.start);
  if (start === null) return { ok: false, error: 'Hiányzó vagy hibás időpont.' };

  const name = text(raw.name, LIMITS.name);
  const phone = text(raw.phone, LIMITS.phone);
  const email = text(raw.email, LIMITS.email);
  const message = text(raw.message, LIMITS.message, { multiline: true });

  const problems = [];
  if (name.length < 2) problems.push('név');
  if (phone.replace(/\D/g, '').length < 7) problems.push('telefonszám');
  /* Az admin telefonon felvett foglalásnál e-mail nélkül is dolgozhat. */
  if (email ? !EMAIL_RE.test(email) : !admin) problems.push('e-mail cím');
  if (problems.length) {
    return { ok: false, error: 'Hiányzó vagy hibás adat: ' + problems.join(', ') + '.' };
  }

  const cfg = schedule(site);

  /* A tényleges foglalás — az ellenőrzés is ide, az írási sorba kerül. */
  return serialise(async () => {
    if (admin) {
      /* Adminnál csak az ütközést nézzük: a saját naptárába a nyitvatartáson
         kívül is felvehet valakit, két vendéget viszont nem tehet egymásra. */
      const blockedTo = start + duration + cfg.buffer;
      const clash = bookingsOn(site, date).some((b) => {
        const from = toMinutes(b.start);
        return overlaps(start, blockedTo, from, from + b.duration + b.buffer);
      });
      if (clash) return { ok: false, error: 'Ez az idősáv ütközik egy másik foglalással.' };
    } else {
      const available = slotsFor(site, date, duration);
      if (available.closed) return { ok: false, error: available.reason };
      if (!available.slots.includes(toClock(start))) {
        return { ok: false, error: 'Ezt az időpontot időközben lefoglalták. Kérjük, válasszon másikat.' };
      }
    }

    const booking = {
      id: newId('bk'),
      site,
      date,
      start: toClock(start),
      duration,
      buffer: cfg.buffer,
      serviceKey: service.key,
      serviceName: service.name,
      name,
      phone,
      email,
      message,
      source: admin ? 'admin' : 'web',
      createdAt: new Date().toISOString()
    };

    const store = loadBookings();
    const next = prune(store.bookings.concat([booking]));
    await writeJsonAtomic(BOOKINGS_FILE, { version: 1, bookings: next });
    bookingCache = { version: 1, bookings: next };

    return { ok: true, booking };
  });
}

/** Foglalás törlése (lemondás). */
async function remove(id) {
  return serialise(async () => {
    const store = loadBookings();
    const booking = store.bookings.find((b) => b.id === id);
    if (!booking) return { ok: false, error: 'Ez a foglalás már nincs meg.' };

    const next = store.bookings.filter((b) => b.id !== id);
    await writeJsonAtomic(BOOKINGS_FILE, { version: 1, bookings: next });
    bookingCache = { version: 1, bookings: next };
    return { ok: true, booking };
  });
}

/** Foglalások egy időszakra, dátum és kezdés szerint rendezve. */
function list({ site, from, to }) {
  const start = isDay(from) ? from : today();
  const end = isDay(to) ? to : addDays(start, 30);

  return loadBookings().bookings
    .filter((b) => (!site || b.site === site) && b.date >= start && b.date <= end)
    .sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : 1));
}

/** A nap menetrendje az adminnak: foglalások, szünetek, zárás egy listában. */
function agenda(site, date) {
  const plan = dayPlan(site, date);
  const items = [];

  for (const pause of plan.breaks) {
    items.push({
      kind: 'break',
      from: toClock(pause.from),
      to: toClock(pause.to),
      label: pause.label
    });
  }

  for (const booking of plan.bookings) {
    const from = toMinutes(booking.start);
    items.push({
      kind: 'booking',
      from: booking.start,
      to: toClock(from + booking.duration),
      restTo: toClock(from + booking.duration + booking.buffer),
      booking
    });
  }

  items.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  return {
    date,
    weekday: plan.weekday,
    open: plan.open ? { from: toClock(plan.open.from), to: toClock(plan.open.to) } : null,
    closure: plan.closure,
    items
  };
}

module.exports = {
  SITES, LIMITS, OPTIKA_SERVICES, TIME_ZONE,
  isDay, toMinutes, toClock, weekdayOf, addDays, daysBetween, today, nowParts,
  schedule, saveSchedule, defaultSite,
  services, findService,
  slotsFor, monthOverview, dayPlan, agenda,
  create, remove, list,
  MONTH_RE
};
