/* ═══════════════════════════════════════════════════════════════════════════
   KÉPFELTÖLTÉS — tartalomalapú ellenőrzéssel
   ─────────────────────────────────────────────────────────────────────────
   A feltöltés a weboldal legérzékenyebb pontja: itt kerül idegen tartalom a
   kiszolgáló fájlrendszerére. Ezért NEM hiszünk el semmit, amit a kliens
   állít magáról.

   • A fájl NEVÉT a kliens meg sem adhatja — mi generáljuk, véletlenszerűen.
     Így nincs `../`, nincs `.htaccess`, nincs `kep.php`, nincs ütközés, és a
     név nem árul el semmit a feltöltőről.
   • A TÍPUST nem a kiterjesztésből és nem a `Content-Type` fejlécből
     olvassuk, hanem a fájl SZERKEZETÉBŐL: kiolvassuk a képméretet onnan,
     ahol a formátum szabálya szerint lennie kell (`image-probe.js`). Így a
     `GIF89a<script>…` típusú vegyes fájl is fennakad, nem csak a nyilvánvaló
     álcázás.
   • SVG-t nem fogadunk el. Az SVG XML, futtathat `<script>`-et, és a
     böngésző képként betöltve is végrehajtja, ha közvetlenül nyitják meg.
   • MÉRET — a beolvasás közben, folyamatosan mérve. A kapcsolatot azonnal
     bontjuk, ha túllépi a korlátot; nem várjuk meg a végét.
   • KVÓTA — a mappa össztartalmára is van felső határ, hogy egy elszabadult
     ciklus se tudja megtölteni a lemezt.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { probeImage } = require('./image-probe');

const MAX_BYTES = 6 * 1024 * 1024;      /* egy kép */
const MAX_FILES = 600;                  /* a mappa fájlszáma */
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;

/* A képek szerkezeti ellenőrzése külön modulban él (`image-probe.js`):
   ott derül ki, hogy a fájl VALÓDI kép-e, vagy csak képnek álcázott
   szöveg. Innen csak a végeredmény kell: formátum, kiterjesztés, méret. */

/* A generált fájlnév alakja. A takarítás CSAK ilyen nevű fájlhoz nyúl —
   így egy kézzel odamásolt kép sem tűnhet el véletlenül. */
const GENERATED_NAME = /^[a-f0-9]{24}\.(?:webp|png|jpg)$/;

class Uploads {
  /**
   * @param {string} dir a feltöltési mappa abszolút útvonala
   * @param {string} urlPrefix a hozzá tartozó nyilvános útvonal (pl. `/optika/assets/products/`)
   */
  constructor(dir, urlPrefix) {
    this.dir = dir;
    this.urlPrefix = urlPrefix.endsWith('/') ? urlPrefix : urlPrefix + '/';
  }

  async ensureDir() {
    await fsp.mkdir(this.dir, { recursive: true, mode: 0o755 });
  }

  /**
   * A kérés törzsének beolvasása bájtkorláttal. Túllépéskor a kapcsolatot
   * bontjuk — a maradék adat le sem töltődik.
   */
  readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let done = false;

      /* Nem `req.destroy()`: az válasz nélkül, hálózati hibaként érne véget a
         feltöltő oldalán. Csak megállítjuk az olvasást; a hívó kiküldi a
         413-as választ `Connection: close`-zal, és a kapcsolat rendben zárul. */
      const fail = (message) => {
        if (done) return;
        done = true;
        req.pause();
        reject(new Error(message));
      };

      req.on('data', (chunk) => {
        if (done) return;
        size += chunk.length;
        if (size > MAX_BYTES) { fail('A kép túl nagy.'); return; }
        chunks.push(chunk);
      });
      req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
      req.on('error', () => fail('A feltöltés megszakadt.'));
      req.on('aborted', () => fail('A feltöltés megszakadt.'));
    });
  }

  /** A mappa jelenlegi fájlszáma és mérete — a kvótához. */
  async usage() {
    let files = 0, bytes = 0;
    let entries = [];
    try { entries = await fsp.readdir(this.dir, { withFileTypes: true }); } catch { return { files, bytes }; }
    for (const e of entries) {
      if (!e.isFile()) continue;
      files += 1;
      try { bytes += (await fsp.stat(path.join(this.dir, e.name))).size; } catch { /* közben törölték */ }
    }
    return { files, bytes };
  }

  /**
   * Kép mentése. A hívó már ellenőrizte a jogosultságot.
   * @returns {{ok: true, url: string, bytes: number, type: string} | {ok: false, error: string}}
   */
  async save(buffer) {
    if (!buffer || buffer.length < 16) {
      return { ok: false, error: 'Üres vagy hibás kép.' };
    }
    if (buffer.length > MAX_BYTES) {
      return { ok: false, error: `A kép legfeljebb ${Math.round(MAX_BYTES / 1024 / 1024)} MB lehet.` };
    }

    /* Nem az aláírást nézzük, hanem a szerkezetet — lásd `image-probe.js`. */
    const image = probeImage(buffer);
    if (!image) {
      return { ok: false, error: 'Csak valódi WebP, PNG vagy JPEG kép tölthető fel.' };
    }

    await this.ensureDir();
    const use = await this.usage();
    if (use.files >= MAX_FILES || use.bytes + buffer.length > MAX_TOTAL_BYTES) {
      return { ok: false, error: 'A képtár megtelt. Töröljön néhány régi terméket.' };
    }

    const name = crypto.randomBytes(12).toString('hex') + image.ext;
    const target = path.join(this.dir, name);

    /* `wx`: ha a név mégis foglalt lenne, inkább hibázzon, mint felülírjon. */
    await fsp.writeFile(target, buffer, { flag: 'wx', mode: 0o644 });

    return {
      ok: true,
      url: this.urlPrefix + name,
      bytes: buffer.length,
      type: image.mime,
      width: image.width,
      height: image.height
    };
  }

  /**
   * Már nem hivatkozott képek törlése.
   * Csak a saját generált nevű fájlokat érinti, és csak azokat, amelyek
   * legalább egy órája készültek — így a még el nem mentett termékhez épp
   * feltöltött kép nem tűnik el a szerkesztés közben.
   */
  async collectGarbage(referenced) {
    let entries = [];
    try { entries = await fsp.readdir(this.dir, { withFileTypes: true }); } catch { return 0; }

    const cutoff = Date.now() - 60 * 60 * 1000;
    let removed = 0;

    for (const e of entries) {
      if (!e.isFile() || !GENERATED_NAME.test(e.name)) continue;
      const url = this.urlPrefix + e.name;
      if (referenced.has(url)) continue;

      const full = path.join(this.dir, e.name);
      try {
        const stat = await fsp.stat(full);
        if (stat.mtimeMs > cutoff) continue;
        await fsp.unlink(full);
        removed += 1;
      } catch { /* közben eltűnt — rendben */ }
    }
    return removed;
  }
}

module.exports = { Uploads, MAX_BYTES, MAX_FILES, MAX_TOTAL_BYTES };
