/* ═══════════════════════════════════════════════════════════════════════════
   API — nyilvános terméklista és védett admin végpontok
   ─────────────────────────────────────────────────────────────────────────
   Minden módosító kérésnek NÉGY zárat kell kinyitnia, egymástól függetlenül:

     1. érvényes munkamenet-süti  (ki vagy?)
     2. a munkamenethez tartozó CSRF-token egyedi fejlécben  (te küldted?)
     3. azonos eredetű `Origin`/`Referer`  (a mi lapunkról jött?)
     4. sebességkorlát  (nem géppel nyomod?)

   Bármelyik hiányzik → a kérés elutasítva. A hibaüzenetek szándékosan
   szűkszavúak: nem árulják el, melyik zár akadt meg és miért.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const path = require('node:path');
const sec = require('./security');
const store = require('./store');
const prices = require('./prices');
const { Uploads, MAX_BYTES } = require('./uploads');

const JSON_BODY_LIMIT = 128 * 1024;   /* egy termék bőven belefér */

/* ── Sebességkorlátok ─────────────────────────────────────────────────────
   A bejelentkezés kétszeresen korlátozott: IP-nként ÉS felhasználónévként.
   Az utóbbi azért kell, hogy sok gépről indított, elosztott találgatás se
   férjen hozzá egyetlen fiókhoz. */
const loginByIp = sec.createLimiter({ windowMs: 15 * 60e3, max: 8, blockMs: 15 * 60e3, name: 'login-ip' });
const loginByUser = sec.createLimiter({ windowMs: 60 * 60e3, max: 15, blockMs: 30 * 60e3, name: 'login-user' });
const adminApi = sec.createLimiter({ windowMs: 5 * 60e3, max: 400, blockMs: 5 * 60e3, name: 'admin-api' });
const uploadApi = sec.createLimiter({ windowMs: 60 * 60e3, max: 120, blockMs: 30 * 60e3, name: 'upload' });
const publicApi = sec.createLimiter({ windowMs: 60e3, max: 120, blockMs: 60e3, name: 'public-api' });

/* ── Válaszsegédek ────────────────────────────────────────────────────────── */
function sendJson(res, status, payload, extraHeaders) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    /* Admin- és munkamenetválasz soha nem gyorsítótárazható. */
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, extraHeaders || {}));
  res.end(body);
}

function fail(res, status, message) {
  sendJson(res, status, { ok: false, error: message });
}

/* Túl nagy törzs: 413 + a kapcsolat lezárása. A `Connection: close` azért
   kell, mert a maradék törzset már nem olvassuk el — a csatorna így nem
   használható újra egy következő kéréshez. */
function failTooLarge(res, message) {
  res.setHeader('Connection', 'close');
  sendJson(res, 413, { ok: false, error: message });
}

/**
 * A törzs beolvasása és a hibás esetek egységes kezelése.
 * @returns {Promise<object|null>} az adat, vagy `null`, ha már válaszoltunk
 */
async function bodyOrFail(req, res) {
  const body = await readJsonBody(req);
  if (body === TOO_LARGE) { failTooLarge(res, 'A küldött adat túl nagy.'); return null; }
  if (!body) { fail(res, 400, 'Hibás adat.'); return null; }
  return body;
}

/* A túl nagy törzs megkülönböztetett jelzése: a hívó erre 413-at küld,
   a hibás JSON-ra pedig 400-at. Egyszerű `null` esetén a kettő egybeesne. */
const TOO_LARGE = Symbol('too-large');

/**
 * JSON törzs beolvasása korláttal. Hibás JSON-ra nem dob, hanem `null`-t ad;
 * túl nagy törzsnél a TOO_LARGE jelzést.
 *
 * A korlát túllépésekor NEM bontjuk azonnal a kapcsolatot (`req.destroy()`):
 * az a küldő oldalán hálózati hibaként (ECONNRESET) jelenne meg, válasz
 * nélkül — a feltöltő nem tudná meg, mi a baj. Helyette megállítjuk az
 * olvasást (`pause`), a hívó kiküldi a 413-at `Connection: close`-zal, és a
 * kapcsolat szabályosan zárul.
 */
function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;

    const finish = (value) => { if (!done) { done = true; resolve(value); } };

    /* A bejelentett méret alapján még olvasás előtt kiszűrhető a nagy törzs. */
    const declared = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declared) && declared > JSON_BODY_LIMIT) {
      req.pause();
      finish(TOO_LARGE);
      return;
    }

    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > JSON_BODY_LIMIT) { req.pause(); finish(TOO_LARGE); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) { finish(null); return; }
        const parsed = JSON.parse(raw, (key, value) =>
          (key === '__proto__' || key === 'constructor' || key === 'prototype') ? undefined : value);
        finish(parsed && typeof parsed === 'object' ? parsed : null);
      } catch { finish(null); }
    });
    req.on('error', () => finish(null));
    req.on('aborted', () => finish(null));
  });
}

/* ── Az API osztálya ──────────────────────────────────────────────────────── */
class Api {
  constructor({ root, trustProxy, defaultAdmin, log }) {
    this.trustProxy = !!trustProxy;
    this.defaultAdmin = defaultAdmin;
    this.log = log || (() => {});
    this.uploads = new Uploads(
      path.join(root, 'optika', 'assets', 'products'),
      '/optika/assets/products/'
    );
  }

  ip(req) { return sec.clientIp(req, this.trustProxy); }
  secure(req) { return sec.isSecureRequest(req, this.trustProxy); }

  /** A kéréshez tartozó munkamenet, vagy `null`. */
  session(req) {
    const sid = sec.readCookie(req, sec.cookieName(this.secure(req)));
    if (!sid) return null;
    const s = sec.getSession(sid, req);
    return s ? { sid, data: s } : null;
  }

  /**
   * Módosító kérés kapuja: munkamenet + CSRF + eredet.
   * @returns {{ok: true, session: object} | {ok: false, status: number, error: string}}
   */
  guard(req) {
    if (!sec.sameOrigin(req, this.trustProxy)) {
      return { ok: false, status: 403, error: 'Érvénytelen kérés.' };
    }
    const s = this.session(req);
    if (!s) {
      return { ok: false, status: 401, error: 'A munkamenet lejárt. Jelentkezzen be újra.' };
    }
    const token = req.headers['x-csrf-token'];
    if (typeof token !== 'string' || token.length !== s.data.csrf.length || token !== s.data.csrf) {
      return { ok: false, status: 403, error: 'Érvénytelen kérés.' };
    }
    return { ok: true, session: s };
  }

  /**
   * A kérés kezelése.
   * @returns {Promise<boolean>} igaz, ha ez a modul válaszolt
   */
  async handle(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith('/api/')) return false;

    /* Az API válaszai soha nem kerülhetnek megosztott gyorsítótárba, és
       más eredetű oldal sem olvashatja őket (nincs CORS-fejléc → a böngésző
       nem adja oda a választ egy idegen lap JavaScriptjének). */
    res.setHeader('Vary', 'Cookie');

    if (p === '/api/products') return this.publicProducts(req, res);
    if (p === '/api/prices') return this.publicPrices(req, res);
    if (p.startsWith('/api/admin/')) return this.admin(req, res, p);

    return false;
  }

  /* ── Nyilvános terméklista ──────────────────────────────────────────── */
  async publicProducts(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fail(res, 405, 'Csak GET.');
      return true;
    }
    const gate = publicApi.check(this.ip(req));
    if (!gate.ok) {
      sendJson(res, 429, { ok: false, error: 'Túl sok kérés.' }, { 'Retry-After': String(gate.retryAfter) });
      return true;
    }

    const tag = store.etag();
    if (req.headers['if-none-match'] === tag) {
      res.writeHead(304, { ETag: tag, 'Cache-Control': 'no-cache' });
      res.end();
      return true;
    }

    /* A látogató csak a közzétett termékeket kapja meg, és csak a
       megjelenítéshez szükséges mezőket — a piszkozatok és az időbélyegek
       nem szivárognak ki. */
    const products = store.publishedProducts().map((p) => ({
      id: p.id,
      category: p.category,
      brand: p.brand,
      title: p.title,
      shortDesc: p.shortDesc,
      price: p.price,
      badge: p.badge,
      badgeTone: p.badgeTone,
      images: p.images,
      detail: p.detail
    }));

    sendJson(res, 200, { ok: true, products }, {
      'Cache-Control': 'no-cache',
      ETag: tag
    });
    return true;
  }

  /* ── Nyilvános árlista ──────────────────────────────────────────────
     A masszázs oldal árlistája és a foglalási űrlap választható időtartamai
     egyaránt ebből épülnek — így nem tud elcsúszni a kettő egymástól. */
  async publicPrices(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fail(res, 405, 'Csak GET.');
      return true;
    }
    const gate = publicApi.check(this.ip(req));
    if (!gate.ok) {
      sendJson(res, 429, { ok: false, error: 'Túl sok kérés.' }, { 'Retry-After': String(gate.retryAfter) });
      return true;
    }

    const tag = prices.etag();
    if (req.headers['if-none-match'] === tag) {
      res.writeHead(304, { ETag: tag, 'Cache-Control': 'no-cache' });
      res.end();
      return true;
    }

    const data = prices.get();
    sendJson(res, 200, {
      ok: true,
      durations: data.durations,
      treatments: data.treatments,
      notes: data.notes
    }, { 'Cache-Control': 'no-cache', ETag: tag });
    return true;
  }

  /* ── Admin végpontok ─────────────────────────────────────────────────── */
  async admin(req, res, p) {
    const gate = adminApi.check(this.ip(req));
    if (!gate.ok) {
      sendJson(res, 429, { ok: false, error: 'Túl sok kérés.' }, { 'Retry-After': String(gate.retryAfter) });
      return true;
    }

    if (p === '/api/admin/login') return this.login(req, res);
    if (p === '/api/admin/logout') return this.logout(req, res);
    if (p === '/api/admin/session') return this.sessionInfo(req, res);
    if (p === '/api/admin/products') return this.adminProducts(req, res);
    if (p === '/api/admin/products/order') return this.adminReorder(req, res);
    if (p === '/api/admin/upload') return this.adminUpload(req, res);
    if (p === '/api/admin/password') return this.adminPassword(req, res);
    if (p === '/api/admin/prices') return this.adminPrices(req, res);

    const single = /^\/api\/admin\/products\/(p_[a-f0-9]{18})$/.exec(p);
    if (single) return this.adminProductById(req, res, single[1]);

    fail(res, 404, 'Ismeretlen végpont.');
    return true;
  }

  async login(req, res) {
    if (req.method !== 'POST') { fail(res, 405, 'Csak POST.'); return true; }
    if (!sec.sameOrigin(req, this.trustProxy)) { fail(res, 403, 'Érvénytelen kérés.'); return true; }

    const ip = this.ip(req);
    const ipGate = loginByIp.check(ip);
    if (!ipGate.ok) {
      this.log(`  ! bejelentkezés zárolva (IP): ${ip}`);
      sendJson(res, 429, {
        ok: false,
        error: `Túl sok sikertelen próbálkozás. Próbálja újra ${Math.ceil(ipGate.retryAfter / 60)} perc múlva.`
      }, { 'Retry-After': String(ipGate.retryAfter) });
      return true;
    }

    const body = await readJsonBody(req);
    if (body === TOO_LARGE) { failTooLarge(res, 'A küldött adat túl nagy.'); return true; }
    const username = (body && typeof body.username === 'string') ? body.username.trim().slice(0, 64) : '';
    const password = (body && typeof body.password === 'string') ? body.password.slice(0, 512) : '';

    const userGate = loginByUser.check(username.toLowerCase() || '-');
    if (!userGate.ok) {
      sendJson(res, 429, {
        ok: false,
        error: `Túl sok sikertelen próbálkozás. Próbálja újra ${Math.ceil(userGate.retryAfter / 60)} perc múlva.`
      }, { 'Retry-After': String(userGate.retryAfter) });
      return true;
    }

    const admin = await store.loadAdmin(this.defaultAdmin);

    /* A név összehasonlítása kis-nagybetűtől független, a jelszóé nem.
       Rossz névnél is lefuttatjuk a teljes hash-számítást (a verifyPassword
       gondoskodik róla), hogy a válaszidő ne árulja el, létezik-e a fiók. */
    const nameOk = username.toLowerCase() === admin.username.toLowerCase();
    const passOk = await sec.verifyPassword(password, nameOk ? admin.passwordHash : 'scrypt$0$0$0$x$x');

    if (!nameOk || !passOk) {
      this.log(`  ! sikertelen bejelentkezés — ${ip} · "${username.slice(0, 32)}"`);
      /* Egyetlen, általános üzenet: nem derül ki, a név vagy a jelszó volt rossz. */
      fail(res, 401, 'Hibás felhasználónév vagy jelszó.');
      return true;
    }

    /* Sikeres belépés → a számlálók nullázódnak, és MINDIG új azonosító
       készül (munkamenet-rögzítés elleni védelem). */
    loginByIp.reset(ip);
    loginByUser.reset(username.toLowerCase());

    const existing = this.session(req);
    if (existing) sec.destroySession(existing.sid);

    const secure = this.secure(req);
    const sid = sec.createSession(admin.username, req);
    sec.setSessionCookie(res, sid, secure);

    const s = sec.getSession(sid, req);
    this.log(`  ✓ admin belépés — ${ip} · ${admin.username}`);

    sendJson(res, 200, {
      ok: true,
      user: admin.username,
      csrfToken: s.csrf,
      usingDefaultPassword: admin.isDefault === true,
      idleTimeoutMs: sec.SESSION_IDLE_MS
    });
    return true;
  }

  async logout(req, res) {
    if (req.method !== 'POST') { fail(res, 405, 'Csak POST.'); return true; }
    const s = this.session(req);
    if (s) sec.destroySession(s.sid);
    sec.clearSessionCookie(res, this.secure(req));
    sendJson(res, 200, { ok: true });
    return true;
  }

  async sessionInfo(req, res) {
    if (req.method !== 'GET') { fail(res, 405, 'Csak GET.'); return true; }
    const s = this.session(req);
    if (!s) { sendJson(res, 200, { ok: true, authenticated: false }); return true; }

    const admin = await store.loadAdmin(this.defaultAdmin);
    sendJson(res, 200, {
      ok: true,
      authenticated: true,
      user: s.data.user,
      csrfToken: s.data.csrf,
      usingDefaultPassword: admin.isDefault === true,
      idleTimeoutMs: sec.SESSION_IDLE_MS
    });
    return true;
  }

  async adminProducts(req, res) {
    if (req.method === 'GET') {
      const s = this.session(req);
      if (!s) { fail(res, 401, 'Nincs bejelentkezve.'); return true; }
      sendJson(res, 200, { ok: true, products: store.allProducts(), limits: store.LIMITS });
      return true;
    }

    if (req.method === 'POST') {
      const g = this.guard(req);
      if (!g.ok) { fail(res, g.status, g.error); return true; }

      const body = await bodyOrFail(req, res);
      if (!body) return true;

      const r = await store.createProduct(body.product);
      if (!r.ok) { fail(res, 400, r.error); return true; }

      this.log(`  + új termék: ${r.product.title}`);
      sendJson(res, 201, { ok: true, product: r.product });
      return true;
    }

    fail(res, 405, 'Nem támogatott metódus.');
    return true;
  }

  async adminProductById(req, res, id) {
    const g = this.guard(req);
    if (!g.ok) { fail(res, g.status, g.error); return true; }

    if (req.method === 'PUT') {
      const body = await bodyOrFail(req, res);
      if (!body) return true;

      const r = await store.updateProduct(id, body.product);
      if (!r.ok) { fail(res, 400, r.error); return true; }

      this.log(`  ~ módosítva: ${r.product.title}`);
      /* A már nem hivatkozott képek elszállítása a háttérben. */
      this.uploads.collectGarbage(store.referencedImages()).catch(() => {});
      sendJson(res, 200, { ok: true, product: r.product });
      return true;
    }

    if (req.method === 'DELETE') {
      const r = await store.deleteProduct(id);
      if (!r.ok) { fail(res, 404, r.error); return true; }

      this.log(`  − törölve: ${id}`);
      this.uploads.collectGarbage(store.referencedImages()).catch(() => {});
      sendJson(res, 200, { ok: true });
      return true;
    }

    fail(res, 405, 'Nem támogatott metódus.');
    return true;
  }

  async adminReorder(req, res) {
    if (req.method !== 'POST') { fail(res, 405, 'Csak POST.'); return true; }
    const g = this.guard(req);
    if (!g.ok) { fail(res, g.status, g.error); return true; }

    const body = await bodyOrFail(req, res);
    if (!body) return true;

    const r = await store.reorderProducts(body.ids);
    if (!r.ok) { fail(res, 400, r.error); return true; }
    sendJson(res, 200, { ok: true });
    return true;
  }

  async adminUpload(req, res) {
    if (req.method !== 'POST') { fail(res, 405, 'Csak POST.'); return true; }
    const g = this.guard(req);
    if (!g.ok) { fail(res, g.status, g.error); return true; }

    const gate = uploadApi.check(this.ip(req));
    if (!gate.ok) {
      sendJson(res, 429, { ok: false, error: 'Túl sok feltöltés. Próbálja később.' },
        { 'Retry-After': String(gate.retryAfter) });
      return true;
    }

    /* A `Content-Length` előzetes ellenőrzése: a túl nagy kérést elutasítjuk,
       mielőtt egyetlen bájtot is beolvasnánk. */
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_BYTES) {
      fail(res, 413, `A kép legfeljebb ${Math.round(MAX_BYTES / 1024 / 1024)} MB lehet.`);
      return true;
    }

    let buffer;
    try {
      buffer = await this.uploads.readBody(req);
    } catch (err) {
      failTooLarge(res, err.message);
      return true;
    }

    const r = await this.uploads.save(buffer);
    if (!r.ok) { fail(res, 400, r.error); return true; }

    this.log(`  ↑ kép feltöltve: ${r.url} (${Math.round(r.bytes / 1024)} kB)`);
    sendJson(res, 201, { ok: true, url: r.url, bytes: r.bytes, type: r.type, width: r.width, height: r.height });
    return true;
  }

  async adminPassword(req, res) {
    if (req.method !== 'POST') { fail(res, 405, 'Csak POST.'); return true; }
    const g = this.guard(req);
    if (!g.ok) { fail(res, g.status, g.error); return true; }

    const body = await bodyOrFail(req, res);
    if (!body) return true;

    const current = typeof body.currentPassword === 'string' ? body.currentPassword.slice(0, 512) : '';
    const next = typeof body.newPassword === 'string' ? body.newPassword.slice(0, 512) : '';
    const nextUser = typeof body.newUsername === 'string' ? body.newUsername.trim().slice(0, 64) : '';

    const admin = await store.loadAdmin(this.defaultAdmin);

    /* A jelenlegi jelszó akkor is kell, ha valaki más gépén maradt nyitva a
       munkamenet: a süti önmagában nem elég a jelszó cseréjéhez. */
    if (!await sec.verifyPassword(current, admin.passwordHash)) {
      fail(res, 401, 'A jelenlegi jelszó nem megfelelő.');
      return true;
    }

    const problems = [];
    if (next.length < 12) problems.push('legalább 12 karakter');
    if (!/[a-záéíóöőúüű]/.test(next)) problems.push('kisbetű');
    if (!/[A-ZÁÉÍÓÖŐÚÜŰ]/.test(next)) problems.push('nagybetű');
    if (!/[0-9]/.test(next)) problems.push('szám');
    if (nextUser && !/^[A-Za-z0-9._-]{3,32}$/.test(nextUser)) {
      problems.push('a felhasználónév 3–32 karakter, betű/szám/pont/kötőjel/aláhúzás');
    }
    if (problems.length) {
      fail(res, 400, 'A jelszó nem elég erős — hiányzik: ' + problems.join(', ') + '.');
      return true;
    }

    await store.setAdminPassword(next, nextUser || null);

    /* Jelszócsere után MINDEN munkamenet megszűnik — beleértve azt is, ahol
       esetleg valaki más maradt bejelentkezve. */
    sec.destroyAllSessions();
    sec.clearSessionCookie(res, this.secure(req));

    this.log('  ✓ admin jelszó megváltoztatva — minden munkamenet lezárva');
    sendJson(res, 200, { ok: true, reauth: true });
    return true;
  }

  /* ── Árlista az adminban ─────────────────────────────────────────────── */
  async adminPrices(req, res) {
    if (req.method === 'GET') {
      const s = this.session(req);
      if (!s) { fail(res, 401, 'Nincs bejelentkezve.'); return true; }

      const data = prices.get();
      sendJson(res, 200, {
        ok: true,
        durations: data.durations,
        treatments: data.treatments,
        notes: data.notes,
        updatedAt: data.updatedAt,
        limits: prices.LIMITS
      });
      return true;
    }

    if (req.method === 'PUT') {
      const g = this.guard(req);
      if (!g.ok) { fail(res, g.status, g.error); return true; }

      const body = await bodyOrFail(req, res);
      if (!body) return true;

      const r = await prices.save(body.prices);
      if (!r.ok) { fail(res, 400, r.error); return true; }

      this.log(`  ~ árlista mentve (${r.data.treatments.length} kezelés)`);
      sendJson(res, 200, {
        ok: true,
        durations: r.data.durations,
        treatments: r.data.treatments,
        notes: r.data.notes,
        updatedAt: r.data.updatedAt
      });
      return true;
    }

    fail(res, 405, 'Nem támogatott metódus.');
    return true;
  }
}

module.exports = { Api };
