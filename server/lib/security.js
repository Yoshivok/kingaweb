/* ═══════════════════════════════════════════════════════════════════════════
   BIZTONSÁGI RÉTEG — jelszókezelés, munkamenet, CSRF, sebességkorlát
   ─────────────────────────────────────────────────────────────────────────
   Nincs külső csomag: minden a Node beépített `crypto` moduljából.

   Amit ez a fájl megold, és MIÉRT úgy:

   • JELSZÓ — soha nem tárolunk nyílt szöveget. `scrypt` (memóriaigényes
     kulcslevezetés) véletlen sóval; az összehasonlítás időfüggetlen
     (`timingSafeEqual`), különben a válaszidőből karakterenként ki lehetne
     találni a hasht.
   • MUNKAMENET — a süti értéke 256 bit véletlen, és CSAK egy azonosító:
     a jogosultság a szerver memóriájában él. Így a süti önmagában nem
     hamisítható (nem aláírt adat, hanem kulcs egy szerveroldali táblához).
     HttpOnly (JavaScript nem olvashatja → XSS nem tudja ellopni),
     SameSite=Strict (más oldalról indított kérés nem viszi magával),
     Secure + `__Host-` előtag HTTPS-en (a süti nem állítható be aldomainről).
   • CSRF — a munkamenethez kötött token, amit egyedi fejlécben kell
     visszaküldeni. Más eredetű oldal nem tud egyedi fejlécet küldeni
     preflight nélkül, a preflightot pedig nem engedjük át. Ehhez jön az
     `Origin` fejléc ellenőrzése — két, egymástól független zár.
   • SEBESSÉGKORLÁT — a bejelentkezés próbálgatása IP-nként ÉS felhasználónként
     is korlátos; a jelszó ellenőrzése szándékosan lassú (~100 ms), így a
     találgatás gyakorlatilag kivitelezhetetlen.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const crypto = require('node:crypto');

/* ── 1. Jelszó: scrypt + só ───────────────────────────────────────────────
   N=2^15 → kb. 100 ms és 32 MB memória egyetlen próbához. Ez a támadó
   oldalán a fájdalmas szám: egy grafikus kártyán is memóriakorlátos marad.
   A `maxmem` kézzel emelve, mert a Node alapértelmezett 32 MB-ja épp
   ennyinél fordulna hibába. */
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT.keylen, SCRYPT, (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
}

/** Tárolható jelszó-hash: `scrypt$N$r$p$só$hash` (mindkettő base64). */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(Buffer.from(String(password), 'utf8'), salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Jelszó ellenőrzése. Mindig időfüggetlenül hasonlít, és hibás formátumnál
 * sem lép ki korábban, mint helyesnél — a válaszidő nem árulkodhat.
 */
async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') { await burnTime(); return false; }

  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)
      || N < 1024 || N > 1048576 || r < 1 || r > 32 || p < 1 || p > 16) {
    await burnTime(); return false;
  }

  let salt, expected;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch { await burnTime(); return false; }
  if (salt.length < 8 || expected.length < 16) { await burnTime(); return false; }

  const actual = await new Promise((resolve, reject) => {
    crypto.scrypt(Buffer.from(String(password), 'utf8'), salt, expected.length,
      { N, r, p, maxmem: SCRYPT.maxmem }, (err, key) => err ? reject(err) : resolve(key));
  }).catch(() => null);

  if (!actual || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/* Nem létező felhasználónál is elégetjük ugyanazt az időt, különben a gyors
   „nincs ilyen felhasználó” válasz elárulná, mely nevek léteznek. */
const DUMMY_HASH_PROMISE = hashPassword(crypto.randomBytes(24).toString('hex'));
async function burnTime() {
  const dummy = await DUMMY_HASH_PROMISE;
  await verifyPasswordRaw(crypto.randomBytes(16).toString('hex'), dummy);
}
async function verifyPasswordRaw(password, stored) {
  const parts = stored.split('$');
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  await new Promise((resolve) => {
    crypto.scrypt(Buffer.from(password, 'utf8'), salt, expected.length,
      { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), maxmem: SCRYPT.maxmem },
      () => resolve());
  });
}

/* ── 2. Munkamenetek ──────────────────────────────────────────────────────
   Memóriában élnek: a kiszolgáló újraindítása kijelentkeztet. Ez szándékos —
   nincs lemezre írt munkamenet-fájl, amit el lehetne lopni vagy elfelejteni
   törölni. Két külön lejárat van:
     • tétlenségi (30 perc) — a nyitva felejtett lap magától lezárul,
     • abszolút (8 óra)     — az ellopott süti sem él örökké. */
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const SESSION_MAX = 50;

const sessions = new Map();

function newToken() { return crypto.randomBytes(32).toString('base64url'); }

/* A böngésző-ujjlenyomat rövid hasha. Ha az ellopott sütit másik böngészőből
   használnák, a munkamenet nem fogad el. Az IP szándékosan NEM része:
   mobilhálózaton menet közben változik, és folyton kiléptetne. */
function agentFingerprint(req) {
  return crypto.createHash('sha256')
    .update(String(req.headers['user-agent'] || ''))
    .digest('base64url').slice(0, 22);
}

function createSession(username, req) {
  sweepSessions();
  /* Felső korlát: enélkül egy hibás ciklus végtelenül gyűjtene munkameneteket. */
  if (sessions.size >= SESSION_MAX) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
  const sid = newToken();
  const now = Date.now();
  sessions.set(sid, {
    user: username,
    csrf: newToken(),
    createdAt: now,
    lastSeen: now,
    agent: agentFingerprint(req)
  });
  return sid;
}

function getSession(sid, req) {
  if (!sid || typeof sid !== 'string') return null;
  const s = sessions.get(sid);
  if (!s) return null;

  const now = Date.now();
  if (now - s.lastSeen > SESSION_IDLE_MS || now - s.createdAt > SESSION_ABSOLUTE_MS) {
    sessions.delete(sid);
    return null;
  }
  if (s.agent !== agentFingerprint(req)) {
    /* Másik böngésző ugyanazzal a sütivel → a munkamenetet eldobjuk. */
    sessions.delete(sid);
    return null;
  }
  s.lastSeen = now;
  return s;
}

function destroySession(sid) { if (sid) sessions.delete(sid); }
function destroyAllSessions() { sessions.clear(); }

function sweepSessions() {
  const now = Date.now();
  for (const [sid, s] of sessions) {
    if (now - s.lastSeen > SESSION_IDLE_MS || now - s.createdAt > SESSION_ABSOLUTE_MS) {
      sessions.delete(sid);
    }
  }
}
setInterval(sweepSessions, 5 * 60 * 1000).unref();

/* ── 3. Sütik ─────────────────────────────────────────────────────────────
   HTTPS mögött a `__Host-` előtagot használjuk: a böngésző ilyen nevű sütit
   csak akkor fogad el, ha Secure, Path=/ és NINCS Domain attribútuma. Ezzel
   egy feltört aldomain sem tud munkamenet-sütit tolni az oldalunkra. */
const COOKIE_SECURE = '__Host-mom_admin';
const COOKIE_PLAIN = 'mom_admin';

function cookieName(secure) { return secure ? COOKIE_SECURE : COOKIE_PLAIN; }

/** Süti-fejléc értelmezése. Csak a keresett nevet adja vissza. */
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header || typeof header !== 'string' || header.length > 4096) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    /* Csak a saját, base64url ábécéből álló tokenjeinket fogadjuk el. */
    return /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null;
  }
  return null;
}

function setSessionCookie(res, sid, secure) {
  const bits = [
    `${cookieName(secure)}=${sid}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_ABSOLUTE_MS / 1000)}`
  ];
  if (secure) bits.push('Secure');
  appendHeader(res, 'Set-Cookie', bits.join('; '));
}

function clearSessionCookie(res, secure) {
  const bits = [`${cookieName(secure)}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) bits.push('Secure');
  appendHeader(res, 'Set-Cookie', bits.join('; '));
  /* A másik változatot is töröljük, ha a protokoll közben váltott. */
  const other = secure ? COOKIE_PLAIN : COOKIE_SECURE;
  if (!secure) appendHeader(res, 'Set-Cookie', `${other}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`);
  else appendHeader(res, 'Set-Cookie', `${other}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function appendHeader(res, name, value) {
  const prev = res.getHeader(name);
  if (!prev) res.setHeader(name, value);
  else res.setHeader(name, Array.isArray(prev) ? prev.concat(value) : [prev, value]);
}

/* ── 4. Eredet (Origin) ellenőrzése ───────────────────────────────────────
   A CSRF második zárja. A böngésző az `Origin` fejlécet maga tölti ki, a
   lap JavaScriptje nem tudja hamisítani — így megbízható jelzés arról,
   HONNAN indult a kérés. */
function isSecureRequest(req, trustProxy) {
  if (req.socket && req.socket.encrypted) return true;
  if (trustProxy) {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    if (proto === 'https') return true;
  }
  return false;
}

function sameOrigin(req, trustProxy) {
  const host = String(req.headers.host || '');
  if (!host) return false;

  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    let parsed;
    try { parsed = new URL(origin); } catch { return false; }
    return parsed.host === host;
  }

  /* Origin nélkül a Referer a tartalék (régebbi böngészők, egyes proxyk). */
  const referer = req.headers.referer;
  if (referer) {
    let parsed;
    try { parsed = new URL(referer); } catch { return false; }
    return parsed.host === host;
  }

  /* Sem Origin, sem Referer → módosító kérésnél nem engedjük tovább. */
  return false;
}

/* ── 5. Sebességkorlát ────────────────────────────────────────────────────
   Csúszóablak kulcsonként (IP vagy felhasználónév). Túllépéskor zárolás,
   ami minden további próbálkozásra kitolódik — a türelmetlen találgató
   magát zárja ki. */
function createLimiter({ windowMs, max, blockMs, name }) {
  const entries = new Map();

  function sweep() {
    const now = Date.now();
    for (const [key, e] of entries) {
      if (now > e.blockedUntil && (!e.stamps.length || now - e.stamps[e.stamps.length - 1] > windowMs)) {
        entries.delete(key);
      }
    }
  }
  setInterval(sweep, Math.max(60000, windowMs)).unref();

  return {
    name,
    /** @returns {{ok: true} | {ok: false, retryAfter: number}} */
    check(key) {
      const now = Date.now();
      let e = entries.get(key);
      if (!e) { e = { stamps: [], blockedUntil: 0 }; entries.set(key, e); }

      if (now < e.blockedUntil) {
        return { ok: false, retryAfter: Math.ceil((e.blockedUntil - now) / 1000) };
      }
      e.stamps = e.stamps.filter((t) => now - t < windowMs);
      if (e.stamps.length >= max) {
        e.blockedUntil = now + blockMs;
        e.stamps = [];
        return { ok: false, retryAfter: Math.ceil(blockMs / 1000) };
      }
      e.stamps.push(now);

      /* Túl sok különböző kulcs → a legrégebbieket dobjuk (memóriaplafon). */
      if (entries.size > 5000) {
        const keys = [...entries.keys()].slice(0, 1000);
        for (const k of keys) entries.delete(k);
      }
      return { ok: true };
    },
    /** Sikeres művelet után a számláló nullázódik. */
    reset(key) { entries.delete(key); }
  };
}

/* ── 6. Kliens IP ─────────────────────────────────────────────────────────
   Fordított proxy mögött az `X-Forwarded-For` ELSŐ eleme a látogató. Csak
   akkor hisszük el, ha a beállítás kifejezetten engedi: enélkül bárki
   megkerülhetné a sebességkorlátot egy hamis fejléccel. */
function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff && xff.length < 64) return xff;
  }
  return (req.socket && req.socket.remoteAddress) || 'ismeretlen';
}

module.exports = {
  hashPassword, verifyPassword,
  createSession, getSession, destroySession, destroyAllSessions,
  readCookie, setSessionCookie, clearSessionCookie, cookieName, appendHeader,
  isSecureRequest, sameOrigin, clientIp,
  createLimiter, newToken,
  SESSION_IDLE_MS, SESSION_ABSOLUTE_MS
};
