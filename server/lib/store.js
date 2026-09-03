/* ═══════════════════════════════════════════════════════════════════════════
   ADATTÁR — termékek és admin hozzáférés
   ─────────────────────────────────────────────────────────────────────────
   Két JSON-fájl a `server/data/` mappában. Ez a mappa a `server/` alatt van,
   amit a statikus kiszolgálás KIZÁR — így a termékadatok és főleg a
   jelszó-hash soha nem kérhető le böngészőből.

   Két dolgot csinál gondosan:

   • ÍRÁS — mindig ideiglenes fájlba, majd `rename`. A `rename` a fájlrendszer
     szintjén atomi: vagy a régi, vagy az új tartalom látszik, félig írt
     fájl soha. Egy írási sor (mutex) sorosítja a párhuzamos kéréseket,
     különben két egyszerre érkező mentés felülírhatná egymást.
   • ELLENŐRZÉS — a beérkező adatot NEM javítgatjuk, hanem újraépítjük:
     mezőnként, engedélyezett listából, hosszkorláttal. Amit nem ismerünk
     fel, az kimarad. Így sem váratlan mező, sem `__proto__`-szerű kulcs nem
     jut be az adatbázisba.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { hashPassword } = require('./security');
const { DATA_DIR, text, pick, saveJson, readJsonSync } = require('./jsonfile');

const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');

/* ── Korlátok ─────────────────────────────────────────────────────────────
   Minden szöveges mezőnek van felső határa. Nem esztétika: korlát nélkül
   egyetlen kérés több megabájtnyi szöveget írhatna a lemezre, amit aztán
   minden látogató letöltene. */
const LIMITS = {
  products: 200,
  brand: 60,
  title: 90,
  shortDesc: 320,
  price: 40,
  badge: 28,
  images: 8,
  alt: 160,
  intro: 2400,
  outro: 1200,
  features: 14,
  feature: 240,
  specs: 14,
  specLabel: 44,
  specValue: 140
};

const CATEGORIES = ['frames', 'sunglasses', 'lenses', 'accessories'];
const BADGE_TONES = ['none', 'premium', 'new', 'sale'];

/* Képútvonal: csak a saját `optika/assets/` fánkon belülről, csak valódi
   képkiterjesztéssel, `..` és rejtett mappa nélkül. A feltöltött fájlok
   neve gépi, de a kezdeti négy termék a meglévő fotókra mutat — ezért nem
   csak a feltöltési mappát engedjük. */
const IMAGE_PATH = /^\/optika\/assets\/(?!.*(?:\/\.|\.\.))[A-Za-z0-9][A-Za-z0-9._/-]{0,120}\.(?:webp|jpg|jpeg|png|gif|avif)$/;

/* A szövegtisztítás és az engedélyezett-érték választás a `jsonfile.js`-ben
   él: ugyanaz a szabály vonatkozik a termékekre és az árakra. */

/* Képméret: csak értelmes egész szám, különben nulla (= nem tudjuk). */
function dimension(value) {
  const n = Number(value);
  return (Number.isInteger(n) && n > 0 && n <= 20000) ? n : 0;
}

function imagePath(value) {
  const s = text(value, 200);
  return IMAGE_PATH.test(s) ? s : null;
}

function newId() {
  return 'p_' + crypto.randomBytes(9).toString('hex');
}

/**
 * A kliensről érkező terméket engedélyezett mezőkből újraépíti.
 * @param {object} input a nyers, még nem ellenőrzött adat
 * @param {object|null} existing a meglévő termék (azonosító és létrehozási idő innen)
 * @param {boolean} [keepUpdatedAt] igaz betöltéskor: ne frissüljön a módosítás ideje
 * @returns {{ok: true, product: object} | {ok: false, error: string}}
 */
function normaliseProduct(input, existing, keepUpdatedAt) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Hibás termékadat.' };
  }

  const title = text(input.title, LIMITS.title);
  if (title.length < 2) return { ok: false, error: 'A termék neve legalább 2 karakter legyen.' };

  const rawImages = Array.isArray(input.images) ? input.images.slice(0, LIMITS.images) : [];
  const images = [];
  for (const img of rawImages) {
    if (!img || typeof img !== 'object') continue;
    const full = imagePath(img.full);
    if (!full) continue;
    images.push({
      full,
      thumb: imagePath(img.thumb) || full,
      alt: text(img.alt, LIMITS.alt) || title,
      /* A képarány a feltöltéskor mért méretből. A `<img width height>`
         attribútumokkal a böngésző még a letöltés előtt kihagyja a helyet,
         így nem ugrik meg az elrendezés, amikor a kép beérkezik. */
      w: dimension(img.w),
      h: dimension(img.h)
    });
  }

  const rawDetail = (input.detail && typeof input.detail === 'object' && !Array.isArray(input.detail))
    ? input.detail : {};

  const features = (Array.isArray(rawDetail.features) ? rawDetail.features : [])
    .slice(0, LIMITS.features)
    .map((f) => text(f, LIMITS.feature))
    .filter(Boolean);

  const specs = (Array.isArray(rawDetail.specs) ? rawDetail.specs : [])
    .slice(0, LIMITS.specs)
    .map((s) => (s && typeof s === 'object' && !Array.isArray(s))
      ? { label: text(s.label, LIMITS.specLabel), value: text(s.value, LIMITS.specValue) }
      : null)
    .filter((s) => s && s.label && s.value);

  const badge = text(input.badge, LIMITS.badge);

  return {
    ok: true,
    product: {
      id: (existing && typeof existing.id === 'string') ? existing.id : newId(),
      category: pick(text(input.category, 20), CATEGORIES, 'frames'),
      brand: text(input.brand, LIMITS.brand),
      title,
      shortDesc: text(input.shortDesc, LIMITS.shortDesc),
      price: text(input.price, LIMITS.price),
      badge,
      badgeTone: badge ? pick(text(input.badgeTone, 12), BADGE_TONES, 'premium') : 'none',
      published: input.published !== false,
      images,
      detail: {
        intro: text(rawDetail.intro, LIMITS.intro, { multiline: true }),
        features,
        specs,
        outro: text(rawDetail.outro, LIMITS.outro, { multiline: true })
      },
      createdAt: (existing && typeof existing.createdAt === 'string') ? existing.createdAt : new Date().toISOString(),
      /* Betöltéskor (`keepUpdatedAt`) a meglévő időbélyeg marad. Enélkül minden
         kiszolgáló-újraindítás „most módosítottnak” jelölné az összes terméket. */
      updatedAt: (keepUpdatedAt && existing && typeof existing.updatedAt === 'string')
        ? existing.updatedAt
        : new Date().toISOString()
    }
  };
}

/* ── Termékek ─────────────────────────────────────────────────────────────── */
let cache = null;      /* { version, products: [] } */
let publicEtag = '';   /* a nyilvános válasz ETag-je — csak mentéskor változik */

function computeEtag(products) {
  const json = JSON.stringify(products);
  return '"' + crypto.createHash('sha1').update(json).digest('base64url').slice(0, 22) + '"';
}

const ID_SHAPE = /^p_[a-f0-9]{18}$/;

function load() {
  if (cache) return cache;
  const raw = readJsonSync(PRODUCTS_FILE, null);

  if (raw && Array.isArray(raw.products)) {
    /* A lemezről jövő adatot is átengedjük az ellenőrzésen: ha valaki kézzel
       írta át a fájlt, attól még nem kerülhet hibás mező a válaszba. */
    cache = {
      version: 1,
      products: raw.products
        .map((p) => {
          const keep = (p && typeof p.id === 'string' && ID_SHAPE.test(p.id)) ? p : null;
          const r = normaliseProduct(p, keep, true);
          return r.ok ? r.product : null;
        })
        .filter(Boolean)
        .slice(0, LIMITS.products)
    };
  } else {
    cache = { version: 1, products: seedProducts() };
    /* Első indulás: a beépített négy termék kiírása, hogy szerkeszthető legyen. */
    saveJson(PRODUCTS_FILE, cache).catch(() => {});
  }
  publicEtag = computeEtag(cache.products);
  return cache;
}

function allProducts() { return load().products; }

function publishedProducts() {
  return load().products.filter((p) => p.published);
}

function etag() { load(); return publicEtag; }

async function saveAll(products) {
  const next = { version: 1, products: products.slice(0, LIMITS.products) };
  await saveJson(PRODUCTS_FILE, next);
  cache = next;
  publicEtag = computeEtag(cache.products);
  return cache;
}

async function createProduct(input) {
  const list = allProducts();
  if (list.length >= LIMITS.products) {
    return { ok: false, error: `Legfeljebb ${LIMITS.products} termék tárolható.` };
  }
  const r = normaliseProduct(input, null);
  if (!r.ok) return r;
  await saveAll([r.product, ...list]);
  return { ok: true, product: r.product };
}

async function updateProduct(id, input) {
  const list = allProducts();
  const index = list.findIndex((p) => p.id === id);
  if (index === -1) return { ok: false, error: 'A termék nem található.' };

  const r = normaliseProduct(input, list[index]);
  if (!r.ok) return r;

  const next = list.slice();
  next[index] = r.product;
  await saveAll(next);
  return { ok: true, product: r.product };
}

async function deleteProduct(id) {
  const list = allProducts();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return { ok: false, error: 'A termék nem található.' };
  await saveAll(next);
  return { ok: true };
}

/** Sorrend átrendezése: csak a meglévő azonosítók számítanak. */
async function reorderProducts(ids) {
  if (!Array.isArray(ids)) return { ok: false, error: 'Hibás sorrend.' };
  const list = allProducts();
  const byId = new Map(list.map((p) => [p.id, p]));
  const next = [];
  const used = new Set();
  for (const id of ids.slice(0, LIMITS.products)) {
    if (typeof id !== 'string' || used.has(id)) continue;
    const p = byId.get(id);
    if (p) { next.push(p); used.add(id); }
  }
  for (const p of list) if (!used.has(p.id)) next.push(p);
  await saveAll(next);
  return { ok: true };
}

/** Minden termék által hivatkozott képútvonal — a takarításhoz kell. */
function referencedImages() {
  const set = new Set();
  for (const p of allProducts()) {
    for (const img of p.images) { set.add(img.full); set.add(img.thumb); }
  }
  return set;
}

/* ── Admin hozzáférés ─────────────────────────────────────────────────────── */
let adminCache = null;

/**
 * Az admin fiók betöltése; első indításkor létrehozza az alapértelmezettet.
 * A jelszó SOHA nem kerül nyílt szövegként a fájlba.
 */
async function loadAdmin(defaults) {
  if (adminCache) return adminCache;
  const raw = readJsonSync(ADMIN_FILE, null);

  if (raw && typeof raw.username === 'string' && typeof raw.passwordHash === 'string') {
    adminCache = {
      username: raw.username,
      passwordHash: raw.passwordHash,
      isDefault: raw.isDefault === true,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null
    };
    return adminCache;
  }

  adminCache = {
    username: defaults.username,
    passwordHash: await hashPassword(defaults.password),
    isDefault: true,
    updatedAt: new Date().toISOString()
  };
  await saveJson(ADMIN_FILE, adminCache, 0o600);
  return adminCache;
}

async function setAdminPassword(newPassword, newUsername) {
  const current = adminCache;
  if (!current) throw new Error('Az admin fiók még nincs betöltve.');
  const next = {
    username: (typeof newUsername === 'string' && newUsername) ? newUsername : current.username,
    passwordHash: await hashPassword(newPassword),
    isDefault: false,
    updatedAt: new Date().toISOString()
  };
  await saveJson(ADMIN_FILE, next, 0o600);
  adminCache = next;
  return next;
}

/* ── A kezdeti négy termék ────────────────────────────────────────────────
   Ugyanaz, ami eddig kézzel volt beírva az `optika/index.html`-be, csak most
   szerkeszthető adatként. Az admin bármelyiket átírhatja vagy törölheti. */
function seedProducts() {
  const make = (o) => normaliseProduct(o, null).product;

  return [
    make({
      category: 'frames',
      brand: 'AURA DESIGN',
      title: 'Titanium Light',
      shortDesc: 'Ultrakönnyű, japán titánötvözetből készült minimalista keret, egész napos kényelem.',
      price: '68 000 Ft',
      badge: 'Prémium',
      badgeTone: 'premium',
      images: [
        { full: '/optika/assets/frame-1200.webp', thumb: '/optika/assets/frame-600.webp', alt: 'Aura Titanium Light szemüvegkeret elölnézetben', w: 1200, h: 1200 }
      ],
      detail: {
        intro: 'A Titanium Light annak készült, aki reggeltől estig szemüveget visel, és estére már nem szeretné érezni. A keret japán béta-titánból készül: ez az ötvözet a rozsdamentes acélnál lényegesen könnyebb, mégis rugalmasabb — enged ott, ahol a merev keret elpattanna.\n\nA teljes szerelvény 14 gramm, nagyjából két A4-es papírlap súlya. Az orrnyeregre és a fül mögé így alig jut terhelés, a nap végén nem marad nyomás okozta piros folt.',
        features: [
          'Japán béta-titán keret, 14 g teljes tömeg lencsével együtt.',
          'Rugalmas, csavar nélküli zsanér — nem lazul ki, nem esik szét.',
          'Nikkelmentes felület: érzékeny bőrre és allergiásoknak is viselhető.',
          'Állítható szilikon orrtámasz, egyénileg hangolható illeszkedés.',
          'Hipoallergén, IP-bevonatos felület, karcálló kivitelben.',
          'Öt méret és négy színárnyalat közül választható.'
        ],
        specs: [
          { label: 'Anyag', value: 'Japán béta-titán' },
          { label: 'Tömeg', value: '14 g' },
          { label: 'Lencseszélesség', value: '52 mm' },
          { label: 'Hídméret', value: '18 mm' },
          { label: 'Szárhossz', value: '145 mm' },
          { label: 'Garancia', value: '24 hónap' }
        ],
        outro: 'A keret ára a lencsét nem tartalmazza. Szalonunkban felpróbálható, és a dioptriás lencsét személyre szabott méréssel illesztjük hozzá — a pupillatávolságot és a beállítási magasságot digitálisan mérjük.'
      }
    }),
    make({
      category: 'sunglasses',
      brand: 'SOLARI',
      title: 'Classic Gold Polarized',
      shortDesc: 'Kézzel készített acetát keret aranyozott részletekkel és polarizált UV-védő lencsékkel.',
      price: '85 000 Ft',
      badge: 'Új kollekció',
      badgeTone: 'new',
      images: [
        { full: '/optika/assets/sunglasses-1200.webp', thumb: '/optika/assets/sunglasses-600.webp', alt: 'Solari Classic Gold Polarized napszemüveg', w: 1200, h: 1200 }
      ],
      detail: {
        intro: 'A polarizált lencse nem egyszerűen sötétebb: kiszűri a vízszintes felületekről — nedves útburkolatról, autó motorháztetejéről, víztükörről — visszaverődő, azonos síkban rezgő fényt. Ettől a kép nem tompul, hanem tisztul: a színek telítettebbek, a kontrasztok élesebbek lesznek.\n\nA keret olasz acetátból, kézi csiszolással készül. Az acetát a hagyományos műanyagnál melegebb tapintású, idővel felveszi a viselő arcformáját, és a színe a teljes anyagban fut — kopáskor sem villan ki alóla más árnyalat.',
        features: [
          'Polarizált lencse: a zavaró tükröződés 99%-a kiszűrve.',
          'Teljes UV400 védelem — az UVA és UVB sugárzás egészét megállítja.',
          'Kézzel csiszolt olasz acetát keret, aranyozott fémbetétekkel.',
          'Rugós zsanér: a szárak megadják magukat, nem feszülnek szét.',
          'Kategória 3 lencsesötétség, erős nyári napsütéshez.',
          'Dioptriás kivitelben is kérhető, egyfókuszú vagy progresszív lencsével.'
        ],
        specs: [
          { label: 'Lencse', value: 'Polarizált, UV400, CAT-3' },
          { label: 'Keretanyag', value: 'Olasz acetát' },
          { label: 'Lencseszélesség', value: '54 mm' },
          { label: 'Hídméret', value: '20 mm' },
          { label: 'Szárhossz', value: '145 mm' },
          { label: 'Tartozék', value: 'Merev tok, törlőkendő' }
        ],
        outro: 'Vezetéshez külön ajánljuk: a nedves aszfaltról és a szembejövő autók fényezéséről visszaverődő csillogást ez a lencse veszi el a leglátványosabban. Dioptriás változat rendelésére 5–8 munkanap.'
      }
    }),
    make({
      category: 'lenses',
      brand: 'LUMINA TECH',
      title: 'HD Focus Pro',
      shortDesc: 'Egyedi csiszolású progresszív lencse kékfény-szűrővel és tükröződésmentes bevonattal.',
      price: '42 000 Ft / db',
      badge: '',
      badgeTone: 'none',
      images: [
        { full: '/optika/assets/lenses-1200.webp', thumb: '/optika/assets/lenses-600.webp', alt: 'Lumina HD Focus Pro progresszív dioptriás lencse', w: 1200, h: 1200 }
      ],
      detail: {
        intro: 'A progresszív lencse egyetlen felületen viszi végig a távoli, a köztes és a közeli látótávolságot, éles határvonal nélkül. Ennek ára hagyományosan az oldalsó torzítás — a HD Focus Pro ezen a ponton lép tovább: a lencsefelületet nem katalógusból választjuk, hanem az Ön mért adataiból számoljuk.\n\nA számításba bemegy a keret dőlésszöge, a szem és a lencse távolsága, valamint a keret íve. Ugyanaz a dioptria más keretben más felületet kíván; ezért mérjük külön minden szemüvegnél.',
        features: [
          'Egyedi, szabadformájú (freeform) csiszolás a saját mért adatai alapján.',
          'Széles, torzításmentes köztes sáv — képernyőhöz és műszerfalhoz.',
          'Kékfény-szűrő bevonat a hosszú, monitor előtt töltött napokhoz.',
          'Kilencrétegű tükröződésmentes bevonat, éjszakai vezetéshez is.',
          'Karcálló keményréteg és víztaszító, ujjlenyomat-tűrő felület.',
          'Vékonyított kivitel 1.60 / 1.67 / 1.74 törésmutatóval.'
        ],
        specs: [
          { label: 'Típus', value: 'Progresszív, freeform' },
          { label: 'Törésmutató', value: '1.50 – 1.74' },
          { label: 'Bevonat', value: 'AR + kékfényszűrő + karcálló' },
          { label: 'Beszokási idő', value: 'Jellemzően 3–10 nap' },
          { label: 'Készülési idő', value: '5–8 munkanap' },
          { label: 'Garancia', value: '24 hónap a bevonatra' }
        ],
        outro: 'Az ár lencsénként értendő, és a személyre szabott mérést is tartalmazza. Ha az első két hétben nem sikerül megszoknia a progresszív lencsét, díjmentesen újramérjük és — ha kell — más felülettel készítjük el.'
      }
    }),
    make({
      category: 'accessories',
      brand: 'LUMINA LEATHER',
      title: 'Classic Case & Cleaner Kit',
      shortDesc: 'Valódi bőrből készült védőtok mikroszálas tisztítókendővel és prémium lencsespray-vel.',
      price: '18 500 Ft',
      badge: '',
      badgeTone: 'none',
      images: [
        { full: '/optika/assets/case-1200.webp', thumb: '/optika/assets/case-600.webp', alt: 'Lumina Leather bőr szemüvegtok tisztítókészlettel', w: 1200, h: 1200 }
      ],
      detail: {
        intro: 'A szemüveget nem a viselés koptatja el, hanem a két viselés közti idő: a táska aljára ejtett keret, a szárával lefelé letett lencse, a pólóval végigtörölt bevonat. Ez a készlet ezt a három szokást hivatott felváltani.\n\nA tok kérgesített marhabőrből készül, merev belső vázzal — nem lapul be a táskában. A belseje puha, szálmentes béléssel van kirakva, ami a bevonatos lencsét sem karcolja.',
        features: [
          'Valódi, növényi cserzésű marhabőr, merev belső vázzal.',
          'Szálmentes bélés — bevonatos lencséhez is biztonságos.',
          'Mágneszáras fedél, csendes és egykezes nyitás.',
          'Két mikroszálas kendő: egy a tokba, egy a táskába.',
          'Alkoholmentes lencsespray, 30 ml, bevonatkímélő összetétellel.',
          'Négy szín: fekete, konyak, sötétbarna és homok.'
        ],
        specs: [
          { label: 'Anyag', value: 'Növényi cserzésű marhabőr' },
          { label: 'Külső méret', value: '160 × 65 × 45 mm' },
          { label: 'Tömeg', value: '95 g' },
          { label: 'Tartalom', value: 'Tok, 2 kendő, 30 ml spray' },
          { label: 'Zárás', value: 'Mágneses' }
        ],
        outro: 'A lencsespray utántölthető, a kendők géppel moshatók — öblítő nélkül, mert az a mikroszálakat betapasztja. Nálunk vásárolt szemüveghez a készlet kedvezményesen kérhető.'
      }
    })
  ];
}

module.exports = {
  LIMITS, CATEGORIES, BADGE_TONES,
  allProducts, publishedProducts, etag,
  createProduct, updateProduct, deleteProduct, reorderProducts,
  referencedImages,
  loadAdmin, setAdminPassword,
  DATA_DIR
};
