/* ═══════════════════════════════════════════════════════════════════════════
   SALVIA GYÓGYMASSZÁZS — helyi kiszolgáló + időpontkérés e-mailben
   ─────────────────────────────────────────────────────────────────────────
   • kiszolgálja a statikus oldalt (index.html, assets, jogi aloldalak)
   • POST /api/idopont — két levelet küld:
       1. visszaigazolás a vendégnek
       2. értesítés a masszőrnek
   • nincs külső csomag: minden a Node beépített moduljaiból

   Indítás:  node server/server.js
   Beállítás: server/config.json  (a config.example.json másolata)
              vagy környezeti változók: SMTP_USER, SMTP_PASS, MAIL_TO
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { sendMail, buildMessage } = require('./smtp');
const { customerMail, ownerMail } = require('./mail-templates');

const ROOT = path.resolve(__dirname, '..');
const OUTBOX = path.join(__dirname, 'outbox');

/* ── Beállítások ──────────────────────────────────────────────────────────── */
function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (err) { /* nincs config.json — a környezeti változók döntenek */ }

  const cfg = {
    port: Number(process.env.PORT || file.port || 8000),
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
    timeZone: file.timeZone || 'Europe/Budapest'
  };

  cfg.from = process.env.MAIL_FROM || file.from || cfg.smtp.user;
  /* Hitelesítő adatok nélkül nem küldünk, hanem fájlba írjuk a leveleket */
  cfg.dryRun = !(cfg.smtp.user && cfg.smtp.pass && cfg.to);
  return cfg;
}

const config = loadConfig();

/* ── Statikus kiszolgálás ─────────────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon'
};

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
     (~2,9 MB), így a napon belüli visszatérés teljesen hálózat nélkül megy.
     Képcserénél egy nap alatt magától kigördül; ha sürgős, elég átnevezni. */
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.json', '.txt', '.xml']);
const LONG_LIVED = new Set(['.webp', '.png', '.jpg', '.jpeg', '.woff2', '.ico']);
const MIN_COMPRESS_BYTES = 1024;

function cacheControlFor(ext) {
  if (LONG_LIVED.has(ext)) return 'public, max-age=86400';
  return 'no-cache';
}

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

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';

  const filePath = path.join(ROOT, rel);
  /* könyvtárból kilépés tiltása */
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    res.writeHead(403).end('403 — tiltott útvonal');
    return;
  }
  /* a szerver saját mappája (benne a config.json!) nem kiszolgálható */
  if (filePath.startsWith(path.join(ROOT, 'server'))) {
    res.writeHead(404).end('404');
    return;
  }

  try {
    const data = await fsp.readFile(filePath);
    const stat = await fsp.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();

    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControlFor(ext),
      'Last-Modified': stat.mtime.toUTCString(),
      'X-Content-Type-Options': 'nosniff'
    };

    /* Nem módosult a fájl a látogató legutóbbi kérése óta → 304, nulla bájt */
    const since = req.headers['if-modified-since'];
    if (since && Math.floor(stat.mtimeMs / 1000) <= Math.floor(Date.parse(since) / 1000)) {
      res.writeHead(304, headers).end();
      return;
    }

    let body = data;
    const encoding = COMPRESSIBLE.has(ext) && data.length >= MIN_COMPRESS_BYTES
      ? pickEncoding(req)
      : null;

    if (encoding) {
      body = compressedBody(filePath, data, stat, encoding);
      headers['Content-Encoding'] = encoding;
      headers['Vary'] = 'Accept-Encoding';
    }

    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end(); else res.end(body);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1><p><a href="/">Vissza a főoldalra</a></p>');
  }
}

/* ── Egyszerű sebességkorlát: IP-nként 5 kérés / óra ──────────────────────── */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 5;
}

/* ── Az űrlap adatainak ellenőrzése ───────────────────────────────────────── */
function validate(data) {
  const problems = [];
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  if (str(data.name).length < 2) problems.push('név');
  if (str(data.phone).replace(/\D/g, '').length < 9) problems.push('telefonszám');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(data.email))) problems.push('e-mail cím');
  if (!str(data.treatment)) problems.push('kezelés');

  /* Fejlécinjektálás elleni védelem: sortörés nem kerülhet fejlécbe */
  for (const key of ['name', 'email', 'phone']) {
    if (/[\r\n]/.test(str(data[key]))) problems.push(key);
  }
  if (str(data.message).length > 4000) problems.push('megjegyzés (túl hosszú)');

  return problems;
}

function clean(data) {
  const take = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  return {
    name: take(data.name, 120),
    phone: take(data.phone, 40),
    email: take(data.email, 160),
    treatment: take(data.treatment, 80),
    treatmentKey: take(data.treatmentKey, 40),
    duration: take(data.duration, 40),
    date: take(data.date, 60),
    dateRaw: take(data.dateRaw, 20),
    time: take(data.time, 20),
    message: take(data.message, 4000)
  };
}

/* ── Levélküldés (vagy száraz futás fájlba) ───────────────────────────────── */
async function deliver(data) {
  const forCustomer = customerMail(data, config);
  const forOwner = ownerMail(data, config);

  const messages = [
    {
      label: 'vendeg',
      msg: buildMessage({
        from: { address: config.from, name: config.fromName },
        to: [{ address: data.email, name: data.name }],
        replyTo: { address: config.to || config.from, name: config.fromName },
        subject: forCustomer.subject,
        html: forCustomer.html,
        text: forCustomer.text
      })
    },
    {
      label: 'masszor',
      msg: buildMessage({
        from: { address: config.from, name: config.fromName },
        to: [{ address: config.to || config.from, name: 'Salvia — időpontkérések' }],
        /* válaszra egyből a vendégnek megy */
        replyTo: { address: data.email, name: data.name },
        subject: forOwner.subject,
        html: forOwner.html,
        text: forOwner.text
      })
    }
  ];

  if (config.dryRun) {
    await fsp.mkdir(OUTBOX, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fsp.writeFile(path.join(OUTBOX, `${stamp}-vendeg.html`), forCustomer.html);
    await fsp.writeFile(path.join(OUTBOX, `${stamp}-masszor.html`), forOwner.html);
    console.log(`  ✎ száraz futás — a levelek a server/outbox/ mappába kerültek (${stamp})`);
    return { sent: false, dryRun: true };
  }

  for (const item of messages) {
    await sendMail(config.smtp, item.msg);
    console.log(`  ✓ elküldve (${item.label}) → ${item.msg.envelopeTo.join(', ')}`);
  }
  return { sent: true, dryRun: false };
}

/* ── Kérések ──────────────────────────────────────────────────────────────── */
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('túl nagy kérés')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/idopont') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'csak POST' }));
      return;
    }

    const ip = req.socket.remoteAddress || 'ismeretlen';
    if (rateLimited(ip)) {
      console.warn(`  ! sebességkorlát: ${ip}`);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Túl sok kérés. Kérjük, próbálja később.' }));
      return;
    }

    try {
      const raw = await readBody(req);
      const data = clean(JSON.parse(raw));
      const problems = validate(data);

      if (problems.length) {
        console.warn('  ! hiányos űrlap:', problems.join(', '));
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Hiányos vagy hibás adat: ' + problems.join(', ') }));
        return;
      }

      console.log(`\n→ időpontkérés: ${data.name} · ${data.treatment} · ${data.duration}`);
      const result = await deliver(data);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, dryRun: result.dryRun }));
    } catch (err) {
      console.error('  ✗ hiba:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'A levelet nem sikerült elküldeni.' }));
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('405');
    return;
  }
  await serveStatic(req, res);
});

server.listen(config.port, '127.0.0.1', () => {
  console.log('\n  Salvia Gyógymasszázs — helyi kiszolgáló');
  console.log(`  http://localhost:${config.port}\n`);
  if (config.dryRun) {
    console.log('  ⚠ SZÁRAZ FUTÁS: nincs SMTP-hitelesítés vagy címzett megadva.');
    console.log('    A levelek nem mennek ki, hanem a server/outbox/ mappába íródnak.');
    console.log('    Küldéshez: másolja a server/config.example.json fájlt config.json néven,');
    console.log('    és töltse ki (Gmail app-jelszó).\n');
  } else {
    console.log(`  Küldés: ${config.smtp.host}:${config.smtp.port} · feladó: ${config.from}`);
    console.log(`  Masszőr értesítése ide megy: ${config.to}\n`);
  }
});
