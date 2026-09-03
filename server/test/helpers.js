/* ═══════════════════════════════════════════════════════════════════════════
   TESZTSEGÉDEK — eldobható kiszolgáló minden futáshoz
   ─────────────────────────────────────────────────────────────────────────
   A teszt SOHA nem nyúl az éles adatokhoz. Minden futás kap egy üres,
   ideiglenes adatmappát (`DATA_DIR`), és a végén nyomtalanul eltakarítja.
   Ezért kellett a `server/lib/jsonfile.js`-ben és a `server.js`-ben az a két
   környezeti változó: nélkülük a próbamentés a valódi árlistát írná felül.

   A port is szabadon választott: a teszt nem ütközik a futó `npm start`-tal,
   így nyugodtan futtatható munka közben is.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server', 'server.js');

/* A teszt saját admin fiókot hoz létre az üres adatmappában. Az éles jelszó
   nem kell hozzá, és nem is derülhet ki belőle. */
const ADMIN = { user: 'tesztadmin', pass: 'Teszt-Jelszo-123' };

/** Szabad port kérése az operációs rendszertől. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Elindít egy kiszolgálót üres adatmappával, és megvárja, amíg válaszol.
 * @returns {Promise<{base: string, dataDir: string, log: () => string, stop: () => Promise<void>}>}
 */
async function startServer() {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'momed-teszt-'));
  const port = await freePort();

  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      OUTBOX_DIR: path.join(dataDir, 'outbox'),
      ADMIN_USER: ADMIN.user,
      ADMIN_PASSWORD: ADMIN.pass,
      /* Közvetlen kiszolgálás: a sebességkorlát a valódi IP-t lássa. */
      TRUST_PROXY: 'false'
    })
  });

  let log = '';
  child.stdout.on('data', (c) => { log += c; });
  child.stderr.on('data', (c) => { log += c; });

  let exited = null;
  child.on('exit', (code) => { exited = code; });

  const base = `http://127.0.0.1:${port}`;

  /* Indulásra várunk — de nem a végtelenségig, és ha a folyamat közben
     elszállt, a naplóját is megmutatjuk, ne kelljen találgatni. */
  const deadline = Date.now() + 15000;
  for (;;) {
    if (exited !== null) throw new Error(`A kiszolgáló elindulás közben leállt (${exited}).\n${log}`);
    try {
      const res = await fetch(`${base}/api/prices`);
      if (res.ok) break;
    } catch { /* még nem figyel — várunk */ }
    if (Date.now() > deadline) throw new Error(`A kiszolgáló 15 mp alatt sem indult el.\n${log}`);
    await sleep(60);
  }

  return {
    base,
    dataDir,
    log: () => log,
    async stop() {
      if (exited === null) {
        child.kill('SIGTERM');
        const until = Date.now() + 5000;
        while (exited === null && Date.now() < until) await sleep(30);
        if (exited === null) child.kill('SIGKILL');
      }
      await fsp.rm(dataDir, { recursive: true, force: true });
    }
  };
}

/* ── Apró HTTP-kliens ─────────────────────────────────────────────────────
   Ugyanazt teszi, amit a böngésző az admin felületen: viszi a munkamenet-
   sütit, és minden módosító kéréshez odateszi a CSRF-fejlécet és az
   `Origin`-t. Ezeket egyenként felül lehet bírálni — a védelmi zárakat
   pontosan így tudjuk próbára tenni. */
class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
    this.csrf = null;
  }

  async send(pathname, options = {}) {
    const opts = options;
    const method = opts.method || 'GET';
    const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});

    if (this.cookie && !('Cookie' in headers)) headers.Cookie = this.cookie;
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && method !== 'HEAD') {
      if (this.csrf && !('X-CSRF-Token' in headers)) headers['X-CSRF-Token'] = this.csrf;
      if (!('Origin' in headers)) headers.Origin = this.base;
    }

    const res = await fetch(this.base + pathname, {
      method,
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
      redirect: 'manual'
    });

    /* Süti eltárolása. Üres értékkel érkező süti = kiléptetés. */
    for (const raw of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const pair = raw.split(';')[0];
      this.cookie = pair.slice(pair.indexOf('=') + 1) ? pair : '';
    }

    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }

    return { status: res.status, headers: res.headers, body };
  }

  /** Belépés; a kapott CSRF-tokent innentől magától küldi. */
  async login(user = ADMIN.user, pass = ADMIN.pass) {
    const res = await this.send('/api/admin/login', {
      method: 'POST',
      json: { username: user, password: pass }
    });
    if (res.status === 200 && res.body && res.body.csrfToken) this.csrf = res.body.csrfToken;
    return res;
  }
}

module.exports = { startServer, Client, ADMIN, ROOT };
