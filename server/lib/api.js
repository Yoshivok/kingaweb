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
const booking = require('./booking');
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
/* A foglalás valódi helyet foglal a naptárban, ezért szűkebb a kapu, mint a
   lekérdezéseknél: egy családnak egymás után még bőven elég, gépi foglalásra
   nem. Nem lehet túl szűk: közös internetkapcsolat mögül (iroda, kollégium,
   mobilhálózat) sokan ugyanazzal az IP-vel érkeznek.

   A `BOOKING_RATE_MAX` a DATA_DIR-hez hasonlóan a TESZTHEZ van: a próbafutás
   percek alatt tucatnyi foglalást ad le, amit élesben joggal zárnánk ki.
   Éles indításkor a változó nincs beállítva, tehát a korlát 10 marad. */
const bookingMax = Number(process.env.BOOKING_RATE_MAX) > 0 ? Number(process.env.BOOKING_RATE_MAX) : 10;
const bookingApi = sec.createLimiter({ windowMs: 60 * 60e3, max: bookingMax, blockMs: 60 * 60e3, name: 'booking' });

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
  constructor({ root, trustProxy, defaultAdmin, log, notify }) {
    this.trustProxy = !!trustProxy;
    this.defaultAdmin = defaultAdmin;
    this.log = log || (() => {});
    /* A visszaigazoló és értesítő levél kiküldése. A levelezés a
       `server.js`-ben él (ott van a beállítás és az SMTP), ezért csak egy
       függvényt kapunk — így az API nem függ a levélküldéstől, és a levél
       elakadása sem viheti magával a már elmentett foglalást. */
    this.notify = typeof notify === 'function' ? notify : null;
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
    if (p === '/api/booking') return this.publicBooking(req, res);
    if (p === '/api/booking/options') return this.publicBookingOptions(req, res, url);
    if (p === '/api/booking/availability') return this.publicAvailability(req, res, url);
    if (p === '/api/booking/month') return this.publicMonth(req, res, url);
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
    if (p === '/api/admin/schedule') return this.adminSchedule(req, res);
    if (p === '/api/admin/bookings') return this.adminBookings(req, res);
    if (p === '/api/admin/agenda') return this.adminAgenda(req, res);

    const single = /^\/api\/admin\/products\/(p_[a-f0-9]{18})$/.exec(p);
    if (single) return this.adminProductById(req, res, single[1]);

    const oneBooking = /^\/api\/admin\/bookings\/(bk_[a-f0-9]{16})$/.exec(p);
    if (oneBooking) return this.adminBookingById(req, res, oneBooking[1]);

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

  /* ══════════════════════════════════════════════════════════════════════
     FOGLALÁS — nyilvános végpontok
     ────────────────────────────────────────────────────────────────────
     Mindhárom OLVASÓ végpont ugyanazt a motort kérdezi, amit a mentés is
     (`booking.slotsFor`). Ezért nem tud elcsúszni a felkínált óra attól,
     amit a kiszolgáló elfogad: nincs olyan időpont, amit a naptár mutat,
     de a mentés visszautasít — kivéve, ha közben tényleg elkelt.

     Vendégadat SOHA nem megy ki ezeken: a látogató csak azt látja, hogy
     egy sáv szabad-e, azt nem, hogy ki foglalta le.
     ══════════════════════════════════════════════════════════════════ */

  /** Közös bejárat az olvasó végpontoknak: metódus + sebességkorlát. */
  readGate(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fail(res, 405, 'Csak GET.');
      return false;
    }
    const gate = publicApi.check(this.ip(req));
    if (!gate.ok) {
      sendJson(res, 429, { ok: false, error: 'Túl sok kérés.' }, { 'Retry-After': String(gate.retryAfter) });
      return false;
    }
    return true;
  }

  /** A lekérdezés `site` paramétere, vagy `null`. */
  static siteOf(url) {
    const site = url.searchParams.get('site');
    return booking.SITES.includes(site) ? site : null;
  }

  /** A kért időtartam, a szolgáltatáshoz igazítva. */
  static durationOf(url, site) {
    const service = booking.findService(site, url.searchParams.get('service') || '');
    const asked = Number(url.searchParams.get('duration'));

    if (service) {
      if (service.durations.includes(asked)) return { service, duration: asked };
      /* Hossz nélkül (vagy hibás hosszal) a szolgáltatás legrövidebb
         változatát nézzük — így a naptár akkor sem üres, ha a látogató még
         nem választott hosszt. */
      return { service, duration: Math.min.apply(null, service.durations) };
    }
    if (Number.isInteger(asked) && asked >= booking.LIMITS.minDuration && asked <= booking.LIMITS.maxDuration) {
      return { service: null, duration: asked };
    }
    return { service: null, duration: null };
  }

  /** Foglalható szolgáltatások, hosszak és a nyitvatartás — egy kérésben. */
  async publicBookingOptions(req, res, url) {
    if (!this.readGate(req, res)) return true;

    const site = Api.siteOf(url);
    if (!site) { fail(res, 400, 'Ismeretlen terület.'); return true; }

    const cfg = booking.schedule(site);
    sendJson(res, 200, {
      ok: true,
      site,
      services: booking.services(site),
      buffer: cfg.buffer,
      horizonDays: cfg.horizonDays,
      leadMinutes: cfg.leadMinutes,
      /* A nyitvatartás a naptár szürkítéséhez kell: a zárva tartó napokra
         a látogató rá se tudjon kattintani. */
      hours: cfg.hours,
      today: booking.today()
    });
    return true;
  }

  /** Egy nap szabad kezdései a megadott hosszhoz. */
  async publicAvailability(req, res, url) {
    if (!this.readGate(req, res)) return true;

    const site = Api.siteOf(url);
    if (!site) { fail(res, 400, 'Ismeretlen terület.'); return true; }

    const date = url.searchParams.get('date');
    if (!booking.isDay(date)) { fail(res, 400, 'Hibás dátum.'); return true; }

    const { duration } = Api.durationOf(url, site);
    if (duration === null) { fail(res, 400, 'Hibás időtartam.'); return true; }

    const result = booking.slotsFor(site, date, duration);
    sendJson(res, 200, {
      ok: true,
      site,
      date,
      duration,
      closed: !!result.closed,
      reason: result.reason || '',
      slots: result.slots
    });
    return true;
  }

  /** Egy hónap napjainak állapota (zárva / szabad / betelt). */
  async publicMonth(req, res, url) {
    if (!this.readGate(req, res)) return true;

    const site = Api.siteOf(url);
    if (!site) { fail(res, 400, 'Ismeretlen terület.'); return true; }

    const month = url.searchParams.get('month');
    if (!booking.MONTH_RE.test(String(month || ''))) { fail(res, 400, 'Hibás hónap.'); return true; }

    const { duration } = Api.durationOf(url, site);
    if (duration === null) { fail(res, 400, 'Hibás időtartam.'); return true; }

    sendJson(res, 200, {
      ok: true, site, month, duration,
      days: booking.monthOverview(site, month, duration),
      today: booking.today()
    });
    return true;
  }

  /** Új foglalás a weboldalról. */
  async publicBooking(req, res) {
    if (req.method !== 'POST') { fail(res, 405, 'Csak POST.'); return true; }

    /* Nem admin végpont, de ugyanúgy csak a saját lapunkról fogadjuk el:
       idegen oldal beágyazott szkriptje ne tudjon a nevünkben foglalni. */
    if (!sec.sameOrigin(req, this.trustProxy)) { fail(res, 403, 'Érvénytelen kérés.'); return true; }

    const gate = bookingApi.check(this.ip(req));
    if (!gate.ok) {
      sendJson(res, 429, {
        ok: false,
        error: 'Túl sok foglalás érkezett erről a gépről. Kérjük, hívjon minket telefonon.'
      }, { 'Retry-After': String(gate.retryAfter) });
      return true;
    }

    const body = await bodyOrFail(req, res);
    if (!body) return true;

    /* A két jelölőnégyzet a jogi feltétel: enélkül nincs mit tárolni. */
    if (body.terms !== true || body.gdpr !== true) {
      fail(res, 400, 'A Házirend, az ÁSZF és az adatkezelési tájékoztató elfogadása kötelező.');
      return true;
    }

    const result = await booking.create(body);
    if (!result.ok) { fail(res, 409, result.error); return true; }

    const saved = result.booking;
    this.log(`  ✓ foglalás (${saved.site}): ${saved.date} ${saved.start} · ${saved.name} · ${saved.serviceName}`);

    /* A levél MÁR MENTETT foglalásról szól. Ha a küldés elakad, a foglalás
       akkor is áll — a vendég a képernyőn megkapja a visszaigazolást, a
       naptárban pedig ott a sáv. Ezért nem várunk rá válasszal. */
    let mailed = false;
    if (this.notify) {
      try {
        mailed = await this.notify(saved);
      } catch (err) {
        this.log('  ! a visszaigazoló levél nem ment ki: ' + (err && err.message));
      }
    }

    sendJson(res, 201, {
      ok: true,
      mailed: mailed === true,
      booking: {
        id: saved.id,
        site: saved.site,
        date: saved.date,
        start: saved.start,
        end: booking.toClock(booking.toMinutes(saved.start) + saved.duration),
        duration: saved.duration,
        serviceKey: saved.serviceKey,
        serviceName: saved.serviceName,
        name: saved.name
      }
    });
    return true;
  }

  /* ══════════════════════════════════════════════════════════════════════
     FOGLALÁS — admin végpontok
     ══════════════════════════════════════════════════════════════════ */

  /** A nap menetrendje: foglalások vendégadattal, szünetek, zárás. */
  async adminAgenda(req, res) {
    if (req.method !== 'GET') { fail(res, 405, 'Csak GET.'); return true; }
    const s = this.session(req);
    if (!s) { fail(res, 401, 'Nincs bejelentkezve.'); return true; }

    const url = new URL(req.url, 'http://localhost');
    const site = Api.siteOf(url);
    if (!site) { fail(res, 400, 'Ismeretlen terület.'); return true; }

    /* Egy nap vagy egy időszak — a heti és a havi nézet ugyanezt kéri le
       több napra, egyetlen kérésben. */
    const from = booking.isDay(url.searchParams.get('from')) ? url.searchParams.get('from') : booking.today();
    const to = booking.isDay(url.searchParams.get('to')) ? url.searchParams.get('to') : from;

    const span = booking.daysBetween(from, to);
    if (span < 0 || span > 45) { fail(res, 400, 'Legfeljebb 45 napot kérhet le egyszerre.'); return true; }

    const days = [];
    for (let i = 0; i <= span; i++) days.push(booking.agenda(site, booking.addDays(from, i)));

    sendJson(res, 200, { ok: true, site, from, to, days, today: booking.today() });
    return true;
  }

  /** Foglalások listája és felvétele. */
  async adminBookings(req, res) {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET') {
      const s = this.session(req);
      if (!s) { fail(res, 401, 'Nincs bejelentkezve.'); return true; }

      const site = Api.siteOf(url);
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      sendJson(res, 200, {
        ok: true,
        bookings: booking.list({ site, from, to }),
        today: booking.today()
      });
      return true;
    }

    if (req.method === 'POST') {
      const g = this.guard(req);
      if (!g.ok) { fail(res, g.status, g.error); return true; }

      const body = await bodyOrFail(req, res);
      if (!body) return true;

      /* Adminként a nyitvatartás nem korlátoz (telefonos vendég bármikor
         bejöhet), az ütközés viszont igen — két embert nem tehetünk
         egymásra. Lásd `booking.create`. */
      const result = await booking.create(body, { admin: true });
      if (!result.ok) { fail(res, 409, result.error); return true; }

      this.log(`  + foglalás felvéve (${result.booking.site}): ${result.booking.date} ${result.booking.start}`);

      /* Ha az admin megadta a vendég e-mail címét, ő is kap visszaigazolást —
         ugyanazt, amit a weboldalon foglaló kapna. Cím nélkül csak a
         szolgáltató értesítése megy ki. A levél elakadása a már felvett
         foglaláson nem változtat. */
      let mailed = false;
      if (this.notify) {
        try {
          mailed = await this.notify(result.booking);
        } catch (err) {
          this.log('  ! a visszaigazoló levél nem ment ki: ' + (err && err.message));
        }
      }

      sendJson(res, 201, { ok: true, mailed: mailed === true, booking: result.booking });
      return true;
    }

    fail(res, 405, 'Nem támogatott metódus.');
    return true;
  }

  /** Foglalás lemondása. */
  async adminBookingById(req, res, id) {
    const g = this.guard(req);
    if (!g.ok) { fail(res, g.status, g.error); return true; }

    if (req.method !== 'DELETE') { fail(res, 405, 'Nem támogatott metódus.'); return true; }

    const result = await booking.remove(id);
    if (!result.ok) { fail(res, 404, result.error); return true; }

    this.log(`  − foglalás lemondva: ${result.booking.date} ${result.booking.start} · ${result.booking.name}`);
    sendJson(res, 200, { ok: true });
    return true;
  }

  /** Nyitvatartás, szünetek, szabadnapok. */
  async adminSchedule(req, res) {
    if (req.method === 'GET') {
      const s = this.session(req);
      if (!s) { fail(res, 401, 'Nincs bejelentkezve.'); return true; }

      const url = new URL(req.url, 'http://localhost');
      const site = Api.siteOf(url);
      if (!site) { fail(res, 400, 'Ismeretlen terület.'); return true; }

      sendJson(res, 200, {
        ok: true,
        site,
        schedule: booking.schedule(site),
        services: booking.services(site),
        optikaServices: booking.OPTIKA_SERVICES,
        limits: booking.LIMITS,
        today: booking.today()
      });
      return true;
    }

    if (req.method === 'PUT') {
      const g = this.guard(req);
      if (!g.ok) { fail(res, g.status, g.error); return true; }

      const body = await bodyOrFail(req, res);
      if (!body) return true;

      const site = booking.SITES.includes(body.site) ? body.site : null;
      if (!site) { fail(res, 400, 'Ismeretlen terület.'); return true; }

      const result = await booking.saveSchedule(site, body.schedule);
      if (!result.ok) { fail(res, 400, result.error); return true; }

      this.log(`  ~ nyitvatartás mentve (${site})`);
      sendJson(res, 200, { ok: true, site, schedule: result.schedule });
      return true;
    }

    fail(res, 405, 'Nem támogatott metódus.');
    return true;
  }
}

module.exports = { Api };
