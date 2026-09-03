/* ═══════════════════════════════════════════════════════════════════════════
   KÉPVIZSGÁLAT — a fájl tényleg az, aminek mondja magát?
   ─────────────────────────────────────────────────────────────────────────
   A szokásos „nézzük meg az első pár bájtot” ellenőrzés kevés. A klasszikus
   trükk a POLYGLOT fájl: `GIF89a<script>alert(1)</script>` — az első hat
   bájt szabályos GIF-aláírás, a többi HTML. Aláírás-ellenőrzésen átmegy,
   böngészőben viszont HTML-ként is értelmezhető.

   Ezért itt nem az aláírást nézzük, hanem a SZERKEZETET: kiolvassuk a kép
   méreteit onnan, ahol a formátum szabálya szerint lenniük kell. Ha a
   szélesség és a magasság értelmes szám, a fájl valódi képfejlécet hordoz —
   a polyglot ezen bukik el, mert a mérethez tartozó bájtok nála szöveg.

   Ráadásként a méret jó nekünk is: a `<img width height>` attribútumokkal a
   böngésző már a kép letöltése előtt kihagyja neki a helyet, így nem ugrál
   az elrendezés betöltés közben.

   SVG szándékosan hiányzik a listáról: az XML, futtathat `<script>`-et, és
   nincs értelmes „fejléce”, amiből ellenőrizni lehetne. Termékfotóhoz nem
   is kell.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

/* Reális határok. A 20 000 px fölötti „képek” jellemzően nem fotók, hanem
   a dekódolót akarják kifárasztani (dekompressziós bomba). */
const MIN_SIDE = 8;
const MAX_SIDE = 20000;
const MAX_PIXELS = 60 * 1000 * 1000;

function plausible(w, h) {
  return Number.isInteger(w) && Number.isInteger(h)
    && w >= MIN_SIDE && h >= MIN_SIDE
    && w <= MAX_SIDE && h <= MAX_SIDE
    && w * h <= MAX_PIXELS;
}

/* ── PNG ──────────────────────────────────────────────────────────────────
   8 bájt aláírás, majd AZONNAL az IHDR darab: 4 bájt hossz (mindig 13),
   4 bájt típus („IHDR”), majd a szélesség és a magasság 32 bites,
   big-endian egészként. Ha ez a sorrend nem stimmel, nem PNG. */
function probePng(b) {
  if (b.length < 24) return null;
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let i = 0; i < 8; i += 1) if (b[i] !== sig[i]) return null;

  if (b.readUInt32BE(8) !== 13) return null;
  if (b.toString('latin1', 12, 16) !== 'IHDR') return null;

  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (!plausible(w, h)) return null;

  /* A bitmélység és a színtípus is szabályozott érték. */
  const depth = b[24];
  const colour = b[25];
  if (![1, 2, 4, 8, 16].includes(depth)) return null;
  if (![0, 2, 3, 4, 6].includes(colour)) return null;

  return { ext: '.png', mime: 'image/png', width: w, height: h };
}

/* ── JPEG ─────────────────────────────────────────────────────────────────
   Jelölők (marker) láncolata: 0xFF, típus, majd kétbájtos hossz. Végigmegyünk
   a láncon a keretfejlécig (SOF), ahol a méret áll. Ha a lánc bárhol
   megtörik — márpedig egy odabiggyesztett HTML-nél megtörik —, elutasítjuk. */
const SOF_MARKERS = new Set([
  0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
  0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF
]);

function probeJpeg(b) {
  if (b.length < 16) return null;
  if (b[0] !== 0xFF || b[1] !== 0xD8) return null;

  let i = 2;
  let guard = 0;
  while (i + 3 < b.length && guard < 2000) {
    guard += 1;
    if (b[i] !== 0xFF) return null;              /* a láncnak jelölővel kell folytatódnia */

    let marker = b[i + 1];
    /* Kitöltő 0xFF bájtok megengedettek a jelölő előtt. */
    let j = i + 1;
    while (marker === 0xFF && j + 1 < b.length) { j += 1; marker = b[j]; }

    /* Önálló, hossz nélküli jelölők. */
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      i = j + 1;
      continue;
    }
    if (marker === 0xD9) return null;            /* vége a méret előtt */

    if (j + 3 >= b.length) return null;
    const length = b.readUInt16BE(j + 1);
    if (length < 2) return null;

    if (SOF_MARKERS.has(marker)) {
      if (j + 8 >= b.length) return null;
      const h = b.readUInt16BE(j + 4);
      const w = b.readUInt16BE(j + 6);
      if (!plausible(w, h)) return null;
      return { ext: '.jpg', mime: 'image/jpeg', width: w, height: h };
    }

    if (marker === 0xDA) return null;            /* képadat a keretfejléc előtt */
    i = j + 1 + length;
  }
  return null;
}

/* ── WebP ─────────────────────────────────────────────────────────────────
   RIFF-tároló: „RIFF”, négybájtos méret, „WEBP”, majd az alformátum darabja.
   A RIFF méretmezőnek egyeznie kell a tényleges fájlmérettel — ez önmagában
   kizárja a fájl végére ragasztott idegen tartalmat. Három alformátum van:
   VP8 (veszteséges), VP8L (veszteségmentes), VP8X (kiterjesztett). */
function probeWebp(b) {
  if (b.length < 30) return null;
  if (b.toString('latin1', 0, 4) !== 'RIFF') return null;
  if (b.toString('latin1', 8, 12) !== 'WEBP') return null;

  const riffSize = b.readUInt32LE(4);
  /* A méret a 8. bájttól számít; a páratlan darabokat egy bájt igazítja ki. */
  if (riffSize + 8 !== b.length && riffSize + 9 !== b.length) return null;

  const kind = b.toString('latin1', 12, 16);

  if (kind === 'VP8 ') {
    /* A tömörítetlen adatrész a 20. bájtnál kezdődik, a 0x9D 0x01 0x2A
       kezdőkóddal, utána 14-14 bit méret. */
    if (b[23] !== 0x9D || b[24] !== 0x01 || b[25] !== 0x2A) return null;
    const w = b.readUInt16LE(26) & 0x3FFF;
    const h = b.readUInt16LE(28) & 0x3FFF;
    if (!plausible(w, h)) return null;
    return { ext: '.webp', mime: 'image/webp', width: w, height: h };
  }

  if (kind === 'VP8L') {
    if (b[20] !== 0x2F) return null;             /* a VP8L saját aláírása */
    const bits = b.readUInt32LE(21);
    const w = (bits & 0x3FFF) + 1;
    const h = ((bits >> 14) & 0x3FFF) + 1;
    if (!plausible(w, h)) return null;
    return { ext: '.webp', mime: 'image/webp', width: w, height: h };
  }

  if (kind === 'VP8X') {
    /* Kiterjesztett fejléc: 24 bites, kisvégű méret, mindkettő eggyel
       csökkentve tárolva. */
    const w = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
    const h = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
    if (!plausible(w, h)) return null;
    return { ext: '.webp', mime: 'image/webp', width: w, height: h };
  }

  return null;
}

/* ── Utolsó szűrő ─────────────────────────────────────────────────────────
   Ha a fenti szerkezeti ellenőrzés valamiért mégis átengedne egy vegyes
   fájlt, ez a pásztázás elkapja: a fájl elején keresünk olyan jeleket,
   amelyek értelmezhető jelölőnyelvre vagy szerveroldali kódra utalnak.
   Valódi képben ezek nem fordulnak elő az első kilobájtban. */
const MARKUP = /<\s*(?:!doctype|html|head|body|script|svg|iframe|object|embed|meta|\?php|\?xml|%)/i;

function looksLikeMarkup(b) {
  return MARKUP.test(b.toString('latin1', 0, Math.min(b.length, 2048)));
}

/**
 * A puffer valódi kép?
 * @returns {{ext: string, mime: string, width: number, height: number} | null}
 */
function probeImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) return null;
  if (looksLikeMarkup(buffer)) return null;

  return probeWebp(buffer) || probePng(buffer) || probeJpeg(buffer);
}

module.exports = { probeImage, MAX_SIDE, MAX_PIXELS };
