/* ═══════════════════════════════════════════════════════════════════════════
   MANULA-OPTIC MED. — helyi kiszolgáló
   ─────────────────────────────────────────────────────────────────────────
   • kiszolgálja a statikus oldalt (választó, masszázs, optika, jogi aloldalak)
   • GET  /api/products      — a nyilvános terméklista (az optika oldalhoz)
   • GET  /api/prices        — a masszázs árlistája
   • /api/booking/*          — szabad időpontok és foglalás (mindkét oldal)
   • /admins                 — admin felület (termékek, árak, naptár)
   • /api/admin/*            — védett admin végpontok
   • nincs külső csomag: minden a Node beépített moduljaiból

   Indítás:  node server/server.js
   Beállítás: server/config.json  (a config.example.json másolata)
              vagy környezeti változók: SMTP_USER, SMTP_PASS, MAIL_TO,
              ADMIN_USER, ADMIN_PASSWORD, TRUST_PROXY
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { sendMail, buildMessage } = require('./smtp');
const { customerMail, ownerMail } = require('./mail-templates');
const booking = require('./lib/booking');
const { Api } = require('./lib/api');

const ROOT = path.resolve(__dirname, '..');
/* A száraz futás levelei. A DATA_DIR-hez hasonlóan teszthez átirányítható. */
const OUTBOX = process.env.OUTBOX_DIR
  ? path.resolve(process.env.OUTBOX_DIR)
  : path.join(__dirname, 'outbox');

/* ── Beállítások ──────────────────────────────────────────────────────────── */
function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (err) { /* nincs config.json — a környezeti változók döntenek */ }

  const cfg = {
    port: Number(process.env.PORT || file.port || 8000),
    host: process.env.HOST || file.host || '127.0.0.1',
    smtp: {
      host: process.env.SMTP_HOST || (file.smtp && file.smtp.host) || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || (file.smtp && file.smtp.port) || 587),
      user: process.env.SMTP_USER || (file.smtp && file.smtp.user) || '',
      pass: process.env.SMTP_PASS || (file.smtp && file.smtp.pass) || '',
      clientName: 'salviamasszazs.hu'
    },
    fromName: process.env.MAIL_FROM_NAME || file.fromName || 'Salvia Gyógymasszázs',
    /* Ide érkezik a masszőr értesítése. NEM jelenik meg a weboldalon. */
    to: process.env.MAIL_TO || file.to || '',
    phoneRaw: file.phoneRaw || '+36205017453',
    timeZone: file.timeZone || 'Europe/Budapest',

    /* Fordított proxy (nginx, Caddy, Render…) mögött igaz legyen: ilyenkor
       hisszük el az X-Forwarded-For / X-Forwarded-Proto fejlécet. KÖZVETLEN
       kiszolgálásnál hagyja hamisnak — különben bárki hamis IP-vel kerülné
       meg a sebességkorlátot. */
    trustProxy: envBool(process.env.TRUST_PROXY, file.trustProxy === true),

    /* Az admin fiók CSAK az első indításkor jön létre ezekből az értékekből;
       utána a `server/data/admin.json`-ben él, hashelve. */
    adminUser: process.env.ADMIN_USER || file.adminUser || 'kinga',
    adminPassword: process.env.ADMIN_PASSWORD || file.adminPassword || 'admin'
  };

  cfg.from = process.env.MAIL_FROM || file.from || cfg.smtp.user;
  /* Hitelesítő adatok nélkül nem küldünk, hanem fájlba írjuk a leveleket */
  cfg.dryRun = !(cfg.smtp.user && cfg.smtp.pass && cfg.to);
  return cfg;
}

function envBool(value, fallback) {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|igen)$/i.test(String(value));
}

const config = loadConfig();

const api = new Api({
  root: ROOT,
  trustProxy: config.trustProxy,
  defaultAdmin: { username: config.adminUser, password: config.adminPassword },
  log: (line) => console.log(line),
  /* Az API menti a foglalást, a levelezés viszont itt él (itt van a
     beállítás és az SMTP). A visszatérési érték csak annyit mond, sikerült-e
     — a foglalás sorsát nem befolyásolja. */
  notify: (saved) => deliver(saved)
});

/* ── Statikus kiszolgálás ─────────────────────────────────────────────────
   ENGEDÉLYEZŐ lista, nem tiltólista. Csak az itt felsorolt kiterjesztések
   mennek ki; minden más 404. Így egy véletlenül a gyökérbe kerülő
   `.env`, `.bak`, `.md` vagy `.sql` fájl nem tölthető le akkor sem, ha
   senki nem gondolt rá külön. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

/* Mappák, amelyekhez a böngésző soha nem férhet hozzá.
   `server/`        — itt van a config.json és a jelszó-hash
   `admin/`         — csak a /admins útvonalon keresztül, egy ajtón át
   `_eredeti_kepek/`— a WebP-re váltás előtti, 17 MB-nyi eredeti fotó
   `node_modules/`  — ha valaha bekerülne */
const BLOCKED_DIRS = ['server', 'admin', '_eredeti_kepek', 'node_modules'];

/* Nevesített fájlok, amelyek a gyökérben landolnának, de senkire nem
   tartoznak: a projekt függőségeit és szkriptjeit írják le. Nem titok, de
   nem is kell kiadni — a felderítés első lépése mindig ez a néhány név. */
const BLOCKED_FILES = new Set([
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json',
  'yarn.lock', 'pnpm-lock.yaml', 'composer.json', 'dockerfile', 'docker-compose.yml'
]);

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.json', '.txt', '.xml', '.webmanifest']);
const LONG_LIVED = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif', '.woff2', '.woff', '.ico']);
const MIN_COMPRESS_BYTES = 1024;

function cacheControlFor(ext) {
  if (LONG_LIVED.has(ext)) return 'public, max-age=86400';
  return 'no-cache';
}

/* ── Biztonsági fejlécek ──────────────────────────────────────────────────
   Minden válasz megkapja őket, a 404-es és 405-ös is.

   A CSP a legfontosabb: megmondja a böngészőnek, HONNAN futtathat kódot.
   `script-src 'self'` mellett egy beszúrt `<script>` vagy `onerror=` nem
   fut le — ezért kellett minden inline szkriptet külön fájlba tenni.
   `base-uri 'none'` megakadályozza, hogy egy beszúrt `<base>` átirányítsa
   az összes relatív hivatkozást, `object-src 'none'` pedig a régi
   beágyazási felületeket zárja ki.

   A `frame-ancestors` a választóoldal miatt `'self'`: a keret a saját
   `masszazs/` és `optika/` lapjait ágyazza be. Idegen oldal viszont nem
   teheti iframe-be az oldalt (kattintás-eltérítés elleni védelem). */
const CSP_PUBLIC = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'self' https://www.google.com",
  "manifest-src 'self'"
].join('; ');

/* Az admin szigorúbb: semmilyen keretbe nem ágyazható, és térképet sem tölt. */
const CSP_ADMIN = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'none'"
].join('; ');

/* ── A strukturált adat (JSON-LD) beengedése hash-sel ──────────────────────
   A választóoldal és a masszázs oldal `<script type="application/ld+json">`
   blokkot hordoz: ez mondja meg a keresőknek, hogy helyi vállalkozásról van
   szó, hol van, mikor tart nyitva. A böngésző ezt nem futtatja — de a CSP
   akkor is `<script>` elemnek látja, és `script-src 'self'` mellett kizárná.

   Nem lazítunk a szabályon egy `'unsafe-inline'`-nal (az minden beszúrt
   szkriptet is beengedne). Helyette KISZÁMOLJUK a blokkok SHA-256 lenyomatát
   indításkor, és pontosan azokat engedjük át. Egyetlen karakter változása a
   blokkban új lenyomatot ad — vagyis egy beszúrt szkript nem tud átcsúszni
   egy meglévő engedélyen.

   Indításkor számoljuk, nem kézzel írjuk be: így a hash nem tud elavulni,
   ha valaki átírja a nyitvatartást a JSON-LD-ben. */
const LD_JSON = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function collectInlineScriptHashes() {
  const hashes = new Set();
  const crypto = require('node:crypto');

  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || BLOCKED_DIRS.includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, depth + 1); continue; }
      if (!entry.name.endsWith('.html')) continue;

      let html = '';
      try { html = fs.readFileSync(full, 'utf8'); } catch { continue; }
      LD_JSON.lastIndex = 0;
      let match;
      while ((match = LD_JSON.exec(html)) !== null) {
        const digest = crypto.createHash('sha256').update(match[1], 'utf8').digest('base64');
        hashes.add(`'sha256-${digest}'`);
      }
    }
  };

  walk(ROOT, 0);
  return [...hashes];
}

const LD_HASHES = collectInlineScriptHashes();

const CSP_PUBLIC_FINAL = LD_HASHES.length
  ? CSP_PUBLIC.replace("script-src 'self'", "script-src 'self' " + LD_HASHES.join(' '))
  : CSP_PUBLIC;

function securityHeaders(res, { admin = false, secure = false } = {}) {
  res.setHeader('Content-Security-Policy', admin ? CSP_ADMIN : CSP_PUBLIC_FINAL);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', admin ? 'DENY' : 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', admin ? 'same-origin' : 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (admin) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }
  /* HSTS csak HTTPS-en. HTTP-n kiküldve értelmetlen, és fejlesztés közben
     a böngésző beragadna a https-re a localhoston. */
  if (secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

/* ── Tömörítés és gyorsítótár ──────────────────────────────────────────────
   Szöveges válaszokat (HTML/CSS/JS/SVG/JSON) érdemes tömöríteni: a
   masszazs/index.html 124 kB, az optika/index.js 124 kB, a stíluslapok 70–94 kB
   — gzip-pel ezek a töredékükre esnek, és a böngésző hamarabb kezdhet
   elemezni-festeni. A képek (WebP/JPEG/PNG) már tömörítettek, azokat újra
   összenyomni csak CPU-t éget, ezért kimaradnak.

   A gyorsítótárazás korábbi hibája NEM az volt, hogy `no-cache` szerepelt
   mindenhol, hanem hogy a válasz nem hozott MIVEL ellenőrizni: sem
   `Last-Modified`, sem `ETag`. `no-cache` = „használat előtt kérdezz rá”,
   de ha nincs mire hivatkozni, a böngésző nem kérdezni tud, csak újra
   letölteni — így minden egyes oldalbetöltésnél lejött az összes kép és
   szkript elölről. A `Last-Modified` + 304 ezt önmagában megszünteti: a
   válasz fejlécből áll, törzs nélkül, a böngésző a saját másolatát
   használja.

   Ezért:
   • HTML/CSS/JS → `no-cache`. Mindig rákérdez, de a 304 miatt nem tölt le
     újra semmit. Szerkesztés után azonnal a friss fájl megy ki — kézzel
     karbantartott oldalnál ez fontosabb, mint a megspórolt kérés.
   • Kép/betűtípus → egy nap. Ezek ritkán változnak és ezek a nagyok
     (~2,9 MB), így a napon belüli visszatérés teljesen hálózat nélkül megy. */

/* Melyik tömörítést kéri a böngésző? A Brotli tömörebb, de csak akkor
   használjuk, ha a kliens jelezte, hogy érti. */
function pickEncoding(req) {
  const accept = String(req.headers['accept-encoding'] || '').toLowerCase();
  if (/\bbr\b/.test(accept)) return 'br';
  if (/\bgzip\b/.test(accept)) return 'gzip';
  return null;
}

function compress(data, encoding) {
  if (encoding === 'br') {
    return zlib.brotliCompressSync(data, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 5,   /* 5: jó arány, gyors */
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length
      }
    });
  }
  return zlib.gzipSync(data, { level: 6 });
}

/* A tömörített változatokat eltesszük: ugyanaz a fájl sokszor lemegy, és a
   Brotli/gzip futtatása kérésenként fölösleges CPU. A fájl módosítási ideje
   és mérete a kulcs, így szerkesztés után magától frissül. */
const compressCache = new Map();

function compressedBody(filePath, data, stat, encoding) {
  const key = filePath + '|' + encoding + '|' + stat.mtimeMs + '|' + stat.size;
  let hit = compressCache.get(key);
  if (!hit) {
    hit = compress(data, encoding);
    if (compressCache.size > 100) compressCache.clear();
    compressCache.set(key, hit);
  }
  return hit;
}

/* ── Útvonal feloldása ────────────────────────────────────────────────────
   Ez a függvény dönti el, melyik fájl kérhető le. Sorrendben:

   1. A `%`-kódolás feloldása. Hibás kódolásnál (`%zz`) nincs találgatás.
   2. Nullbájt tiltása. A `kep.webp%00.php` trükk régi C-alapú rétegeknél a
      névnek csak az első felét látta — a Node nem érintett, de a bejáratnál
      olcsóbb kizárni, mint minden rétegben végiggondolni.
   3. `path.posix.normalize` — a `..` és `.` szakaszok kiejtése. Az URL
      útvonala mindig `/`-jel tagolt, akkor is, ha a kiszolgáló Windowson
      fut; ezért a `posix` változat, nem a platformfüggő.
   4. Feloldás a gyökérhez képest, majd ELLENŐRZÉS, hogy tényleg a gyökér
      alatt maradtunk. Ez a valódi zár: a fenti lépések elrontása esetén is
      itt akad fenn a kilépés.
   5. Rejtett fájlok és tiltott mappák kizárása.
   6. Végül a fájlrendszeri VALÓDI útvonal (`realpath`) újraellenőrzése:
      egy kifelé mutató szimbolikus link így sem visz ki a gyökérből. */
function resolvePath(urlPathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  if (!decoded.startsWith('/')) return null;

  let rel = path.posix.normalize(decoded);
  if (rel.endsWith('/')) rel += 'index.html';

  const segments = rel.split('/').filter(Boolean);
  if (segments.some((s) => s === '..' || s.startsWith('.'))) return null;
  if (segments.length && BLOCKED_DIRS.includes(segments[0])) return null;
  if (segments.length && BLOCKED_FILES.has(segments[segments.length - 1].toLowerCase())) return null;

  const filePath = path.resolve(ROOT, ...segments);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return null;

  return filePath;
}

/** A szimbolikus linkek feloldása után is a gyökér alatt vagyunk? */
async function insideRoot(filePath) {
  try {
    const real = await fsp.realpath(filePath);
    return real === ROOT || real.startsWith(ROOT + path.sep);
  } catch {
    return false;
  }
}

async function sendFile(req, res, filePath, { admin = false } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext];
  if (!mime) { notFound(req, res); return; }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    notFound(req, res);
    return;
  }
  if (!stat.isFile()) { notFound(req, res); return; }
  if (!await insideRoot(filePath)) { notFound(req, res); return; }

  const headers = {
    'Content-Type': mime,
    'Cache-Control': admin ? 'no-store' : cacheControlFor(ext),
    'Last-Modified': stat.mtime.toUTCString()
  };

  /* Nem módosult a fájl a látogató legutóbbi kérése óta → 304, nulla bájt.
     Az admin lapjai kimaradnak: ott a friss kód fontosabb. */
  const since = req.headers['if-modified-since'];
  if (!admin && since) {
    const sinceSec = Math.floor(Date.parse(since) / 1000);
    if (Number.isFinite(sinceSec) && Math.floor(stat.mtimeMs / 1000) <= sinceSec) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
  }

  let body;
  try {
    body = await fsp.readFile(filePath);
  } catch {
    notFound(req, res);
    return;
  }

  const encoding = COMPRESSIBLE.has(ext) && body.length >= MIN_COMPRESS_BYTES
    ? pickEncoding(req)
    : null;

  if (encoding) {
    body = compressedBody(filePath, body, stat, encoding);
    headers['Content-Encoding'] = encoding;
    headers['Vary'] = 'Accept-Encoding';
  }

  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end(); else res.end(body);
}

function notFound(req, res) {
  const body = Buffer.from(
    '<!doctype html><html lang="hu"><meta charset="utf-8">' +
    '<title>404 — nincs ilyen oldal</title>' +
    '<h1>404</h1><p><a href="/">Vissza a főoldalra</a></p>',
    'utf8'
  );
  res.writeHead(404, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  if (req.method === 'HEAD') res.end(); else res.end(body);
}

async function serveStatic(req, res, url) {
  const filePath = resolvePath(url.pathname);
  if (!filePath) { notFound(req, res); return; }
  await sendFile(req, res, filePath);
}

/* ── Az admin felület kiszolgálása ────────────────────────────────────────
   Az `admin/` mappa a statikus kiszolgálásból ki van zárva; egyedül ez a
   néhány, névvel felsorolt útvonal vezet hozzá. Így nincs „elfelejtett”
   fájl a mappában, ami véletlenül letölthető lenne. */
const ADMIN_ROUTES = new Map([
  ['/admins', 'index.html'],
  ['/admins/', 'index.html'],
  ['/admins/app.css', 'app.css'],
  ['/admins/app.js', 'app.js'],
  ['/admins/products.js', 'products.js'],
  ['/admins/prices.js', 'prices.js'],
  ['/admins/booking.js', 'booking.js']
]);

async function serveAdmin(req, res, name) {
  await sendFile(req, res, path.join(ROOT, 'admin', name), { admin: true });
}

/* ── Levélküldés a foglalásról (vagy száraz futás fájlba) ─────────────────
   A foglalás EKKOR MÁR EL VAN MENTVE. Ez a lépés csak értesít: visszaigazolás
   a vendégnek, jelzés a szolgáltatónak. Ha nincs SMTP-beállítás, a levelek a
   `server/outbox/` mappába íródnak — így fejlesztés közben is látszik, mi
   ment volna ki, és a foglalás akkor sem vész el.

   Hitelesítő adatok nélkül a `dryRun` igaz; ilyenkor a válasz `mailed: false`,
   és a weboldal ennek megfelelően fogalmaz. */
async function deliver(saved) {
  const startMin = booking.toMinutes(saved.start);
  const data = {
    id: saved.id,
    site: saved.site,
    name: saved.name,
    phone: saved.phone,
    email: saved.email,
    serviceName: saved.serviceName,
    duration: saved.duration,
    date: saved.date,
    start: saved.start,
    end: booking.toClock(startMin + saved.duration),
    restEnd: booking.toClock(startMin + saved.duration + saved.buffer),
    message: saved.message
  };

  const forCustomer = customerMail(data, config);
  const forOwner = ownerMail(data, config);
  const brand = require('./mail-templates').brandOf(saved.site);

  if (config.dryRun) {
    await fsp.mkdir(OUTBOX, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp.writeFile(path.join(OUTBOX, `${stamp}-${saved.site}-vendeg.html`), forCustomer.html);
    await fsp.writeFile(path.join(OUTBOX, `${stamp}-${saved.site}-szolgaltato.html`), forOwner.html);
    console.log(`  ✎ száraz futás — a levelek a server/outbox/ mappába kerültek (${stamp})`);
    return false;
  }

  const messages = [];

  /* E-mail cím nélküli (telefonon felvett) foglalásnál nincs kinek írni. */
  if (data.email) {
    messages.push({
      label: 'vendeg',
      msg: buildMessage({
        from: { address: config.from, name: brand.fullName },
        to: [{ address: data.email, name: data.name }],
        replyTo: { address: config.to || config.from, name: brand.fullName },
        subject: forCustomer.subject,
        html: forCustomer.html,
        text: forCustomer.text
      })
    });
  }

  messages.push({
    label: 'szolgaltato',
    msg: buildMessage({
      from: { address: config.from, name: brand.fullName },
      to: [{ address: config.to || config.from, name: brand.fullName + ' — foglalások' }],
      /* válaszra egyből a vendégnek megy */
      replyTo: data.email
        ? { address: data.email, name: data.name }
        : { address: config.to || config.from, name: brand.fullName },
      subject: forOwner.subject,
      html: forOwner.html,
      text: forOwner.text
    })
  });

  for (const item of messages) {
    await sendMail(config.smtp, item.msg);
    console.log(`  ✓ elküldve (${item.label}) → ${item.msg.envelopeTo.join(', ')}`);
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400).end('400');
    return;
  }

  const adminFile = ADMIN_ROUTES.get(url.pathname);
  const isAdminArea = !!adminFile || url.pathname.startsWith('/api/admin/');
  const secure = !!(req.socket && req.socket.encrypted)
    || (config.trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');

  securityHeaders(res, { admin: isAdminArea, secure });

  try {
    /* 1. Az admin felület lapjai */
    if (adminFile) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end('405'); return; }
      await serveAdmin(req, res, adminFile);
      return;
    }

    /* 2. Az API (nyilvános terméklista + admin végpontok) */
    if (await api.handle(req, res, url)) return;

    /* 3. Statikus fájlok */
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('405');
      return;
    }
    await serveStatic(req, res, url);
  } catch (err) {
    /* A hiba részletei a naplóba mennek, a látogatóhoz nem: a veremkiírás
       fájlneveket és könyvtárszerkezetet árulna el. */
    console.error('  ✗ kiszolgálási hiba:', err && err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500');
    } else {
      res.end();
    }
  }
});

/* Lassú-kapcsolat (slowloris) elleni időkorlátok. Alapértelmezés szerint a
   Node fejlécekre 60 mp-et vár; a nyitva tartott, félbehagyott kérés
   kapcsolatot foglal. */
server.headersTimeout = 20000;
server.requestTimeout = 60000;
server.keepAliveTimeout = 10000;

server.listen(config.port, config.host, () => {
  console.log('\n  Manula-Optic Med. — helyi kiszolgáló');
  console.log(`  http://${config.host}:${config.port}\n`);
  if (config.dryRun) {
    console.log('  ⚠ SZÁRAZ FUTÁS: nincs SMTP-hitelesítés vagy címzett megadva.');
    console.log('    A levelek nem mennek ki, hanem a server/outbox/ mappába íródnak.');
    console.log('    Küldéshez: másolja a server/config.example.json fájlt config.json néven,');
    console.log('    és töltse ki (Gmail app-jelszó).\n');
  } else {
    console.log(`  Küldés: ${config.smtp.host}:${config.smtp.port} · feladó: ${config.from}`);
    console.log(`  Masszőr értesítése ide megy: ${config.to}\n`);
  }

  console.log(`  Admin felület:  http://${config.host}:${config.port}/admins`);

  /* Árva képek takarítása: a szerkesztés közben feltöltött, végül el nem
     mentett fotók így nem gyűlnek a lemezen. Indításkor egyszer, utána
     óránként. A takarítás csak a gépi nevű, egy óránál régebbi és egyetlen
     termék által sem hivatkozott fájlokat érinti — a kézzel odamásolt
     képekhez nem nyúl. Lásd `server/lib/uploads.js`. */
  const sweepUploads = () => {
    api.uploads
      .collectGarbage(require('./lib/store').referencedImages())
      .then((removed) => { if (removed) console.log(`  ⌫ ${removed} nem használt kép törölve`); })
      .catch(() => { /* a takarítás elmaradása nem hiba */ });
  };
  setTimeout(sweepUploads, 5000).unref();
  setInterval(sweepUploads, 60 * 60 * 1000).unref();

  /* Az alapértelmezett jelszóra minden indításkor figyelmeztetünk — ez a
     leggyakoribb valós biztonsági rés, nem a kifinomult támadás. */
  require('./lib/store')
    .loadAdmin({ username: config.adminUser, password: config.adminPassword })
    .then((admin) => {
      if (admin.isDefault) {
        console.log('\n  ⚠ AZ ADMIN MÉG AZ ALAPÉRTELMEZETT JELSZÓT HASZNÁLJA.');
        console.log(`    Felhasználó: ${admin.username}`);
        console.log('    Élesítés előtt cserélje le az admin felület „Jelszó” fülén.');
      }
      if (!config.trustProxy) {
        console.log('\n  ℹ trustProxy = false — közvetlen kiszolgálás.');
        console.log('    Fordított proxy (nginx, Caddy, Render) mögött állítsa igazra,');
        console.log('    különben a sebességkorlát mindenkit egy IP-nek lát.');
      }
      console.log('');
    })
    .catch((err) => console.error('  ✗ az admin fiók betöltése nem sikerült:', err.message));
});
