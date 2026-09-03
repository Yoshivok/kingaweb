/* ═══════════════════════════════════════════════════════════════════════════
   VÉGPONTOK — a kiszolgáló körbejárása egy eldobható példányon
   ─────────────────────────────────────────────────────────────────────────
   A hangsúly a NÉGY ZÁRON van (munkamenet, CSRF, azonos eredet, sebesség-
   korlát): ezek nélkül az árlistát bárki átírhatná. Külön teszt néz rá arra
   is, hogy az admin mappa és a `server/` mappa fájljai nem tölthetők le.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client, ADMIN } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { if (srv) await srv.stop(); });

/* Az eldobható mappában a beépített árlista jön létre — ez a kiindulás. */
describe('Nyilvános árlista', () => {
  it('kiadja az árakat', async () => {
    const c = new Client(srv.base);
    const { status, body } = await c.send('/api/prices');

    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.durations.length > 0, 'kell legalább egy időtartam');
    assert.ok(body.treatments.length > 0, 'kell legalább egy kezelés');

    for (const t of body.treatments) {
      assert.ok(t.key && t.name, 'minden kezelésnek van kulcsa és neve');
      assert.equal(typeof t.prices, 'object');
    }
  });

  it('ETag-gel 304-et ad, ha nem változott', async () => {
    const c = new Client(srv.base);
    const first = await c.send('/api/prices');
    const tag = first.headers.get('etag');
    assert.ok(tag, 'kell ETag');

    const second = await c.send('/api/prices', { headers: { 'If-None-Match': tag } });
    assert.equal(second.status, 304);
  });

  it('csak olvasható — POST-ra 405', async () => {
    const c = new Client(srv.base);
    const { status } = await c.send('/api/prices', { method: 'POST', json: {} });
    assert.equal(status, 405);
  });
});

describe('Belépés', () => {
  it('rossz jelszót elutasít', async () => {
    const c = new Client(srv.base);
    const { status, body } = await c.login(ADMIN.user, 'rossz-jelszo');
    assert.equal(status, 401);
    assert.equal(body.ok, false);
  });

  it('rossz névre UGYANAZT az üzenetet adja, mint rossz jelszóra', async () => {
    /* Különben a válaszból kiderülne, létezik-e a fiók. */
    const a = await new Client(srv.base).login('nincs-ilyen-fiok', 'rossz-jelszo');
    const b = await new Client(srv.base).login(ADMIN.user, 'megint-rossz');
    assert.equal(a.status, b.status);
    assert.equal(a.body.error, b.body.error);
  });

  it('jó adatokkal beenged és CSRF-tokent ad', async () => {
    const c = new Client(srv.base);
    const { status, body } = await c.login();
    assert.equal(status, 200);
    assert.equal(body.user, ADMIN.user);
    assert.ok(body.csrfToken && body.csrfToken.length > 20, 'kell CSRF-token');

    const session = await c.send('/api/admin/session');
    assert.equal(session.body.authenticated, true);
  });

  it('kilépés után a munkamenet megszűnik', async () => {
    const c = new Client(srv.base);
    await c.login();
    await c.send('/api/admin/logout', { method: 'POST' });

    const session = await c.send('/api/admin/session');
    assert.equal(session.body.authenticated, false);
  });
});

describe('A négy zár', () => {
  /** Egy érvényes árlista-mentés törzse, a jelenlegi adatokból. */
  async function payload(client) {
    const { body } = await client.send('/api/admin/prices');
    return { prices: { durations: body.durations, treatments: body.treatments, notes: body.notes } };
  }

  it('munkamenet nélkül nem enged olvasni', async () => {
    const c = new Client(srv.base);
    const { status } = await c.send('/api/admin/prices');
    assert.equal(status, 401);
  });

  it('munkamenet nélkül nem enged menteni', async () => {
    const c = new Client(srv.base);
    const { status } = await c.send('/api/admin/prices', { method: 'PUT', json: { prices: {} } });
    assert.equal(status, 401);
  });

  it('rossz CSRF-tokennel nem enged menteni', async () => {
    const c = new Client(srv.base);
    await c.login();
    const data = await payload(c);

    const { status } = await c.send('/api/admin/prices', {
      method: 'PUT', json: data, headers: { 'X-CSRF-Token': 'hamis-token' }
    });
    assert.equal(status, 403);
  });

  it('CSRF-token nélkül sem enged menteni', async () => {
    const c = new Client(srv.base);
    await c.login();
    const data = await payload(c);
    c.csrf = null;

    const { status } = await c.send('/api/admin/prices', { method: 'PUT', json: data });
    assert.equal(status, 403);
  });

  it('idegen oldalról érkező kérést elutasít', async () => {
    const c = new Client(srv.base);
    await c.login();
    const data = await payload(c);

    const { status } = await c.send('/api/admin/prices', {
      method: 'PUT', json: data, headers: { Origin: 'http://gonosz.example' }
    });
    assert.equal(status, 403);
  });
});

describe('Árlista mentése', () => {
  it('a mentett ár azonnal látszik a nyilvános végponton', async () => {
    const c = new Client(srv.base);
    await c.login();

    const before = await c.send('/api/admin/prices');
    const durations = before.body.durations;
    const treatments = JSON.parse(JSON.stringify(before.body.treatments));

    /* Az első kezelés első kérhető hosszát írjuk át egy felismerhető összegre. */
    const min = durations.find((d) => treatments[0].prices[d] != null);
    assert.ok(min, 'az első kezelésnek van legalább egy ára');
    treatments[0].prices[min] = 12345;

    const saved = await c.send('/api/admin/prices', {
      method: 'PUT',
      json: { prices: { durations, treatments, notes: before.body.notes } }
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.treatments[0].prices[min], 12345);

    const publicView = await new Client(srv.base).send('/api/prices');
    assert.equal(publicView.body.treatments[0].prices[min], 12345,
      'amit az admin mentett, azt kell látnia a látogatónak is');
  });

  it('mentés után változik az ETag', async () => {
    const c = new Client(srv.base);
    await c.login();

    const tagBefore = (await c.send('/api/prices')).headers.get('etag');

    const cur = await c.send('/api/admin/prices');
    const treatments = JSON.parse(JSON.stringify(cur.body.treatments));
    const min = cur.body.durations.find((d) => treatments[0].prices[d] != null);
    treatments[0].prices[min] = 23456;

    await c.send('/api/admin/prices', {
      method: 'PUT',
      json: { prices: { durations: cur.body.durations, treatments, notes: cur.body.notes } }
    });

    const tagAfter = (await c.send('/api/prices')).headers.get('etag');
    assert.notEqual(tagBefore, tagAfter, 'új árnál a böngésző ne a régit gyorsítótárazza');
  });

  it('a nulla és a negatív összeg "nem kérhető" lesz, nem hibás ár', async () => {
    const c = new Client(srv.base);
    await c.login();

    const cur = await c.send('/api/admin/prices');
    const durations = cur.body.durations;
    const treatments = JSON.parse(JSON.stringify(cur.body.treatments));
    treatments[0].prices[durations[0]] = -500;
    treatments[0].prices[durations[1]] = 0;

    const saved = await c.send('/api/admin/prices', {
      method: 'PUT', json: { prices: { durations, treatments, notes: cur.body.notes } }
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.treatments[0].prices[durations[0]], null);
    assert.equal(saved.body.treatments[0].prices[durations[1]], null);
  });

  it('üres kezeléslistát nem fogad el', async () => {
    const c = new Client(srv.base);
    await c.login();
    const cur = await c.send('/api/admin/prices');

    const { status, body } = await c.send('/api/admin/prices', {
      method: 'PUT', json: { prices: { durations: cur.body.durations, treatments: [], notes: [] } }
    });
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  });

  it('időtartam nélkül nem menthető', async () => {
    const c = new Client(srv.base);
    await c.login();
    const cur = await c.send('/api/admin/prices');

    const { status } = await c.send('/api/admin/prices', {
      method: 'PUT', json: { prices: { durations: [], treatments: cur.body.treatments, notes: [] } }
    });
    assert.equal(status, 400);
  });

  it('a hibás mentés nem rontja el a meglévő árlistát', async () => {
    const c = new Client(srv.base);
    await c.login();
    const before = await c.send('/api/prices');

    await c.send('/api/admin/prices', {
      method: 'PUT', json: { prices: { durations: [], treatments: [], notes: [] } }
    });

    const after = await c.send('/api/prices');
    assert.deepEqual(after.body.treatments, before.body.treatments,
      'elutasított mentés után minden marad a régiben');
  });

  it('a vezérlőkaraktereket kiszedi a névből, a hosszút levágja', async () => {
    const c = new Client(srv.base);
    await c.login();

    const cur = await c.send('/api/admin/prices');
    const treatments = JSON.parse(JSON.stringify(cur.body.treatments));
    /* Szándékosan piszkos név: vezérlőkarakter + a 80-as korlátnál hosszabb. */
    treatments[0].name = 'Teszt\u0007nev' + ' x'.repeat(200);

    const saved = await c.send('/api/admin/prices', {
      method: 'PUT',
      json: { prices: { durations: cur.body.durations, treatments, notes: cur.body.notes } }
    });

    const name = saved.body.treatments[0].name;
    assert.ok(!/[\u0000-\u001F]/.test(name), 'vezérlőkarakter nem maradhat');
    assert.ok(name.length <= 80, 'a név legfeljebb 80 karakter, kapott: ' + name.length);
  });
});

describe('Kiszolgált útvonalak', () => {
  it('az admin felület egy ajtón át elérhető', async () => {
    const c = new Client(srv.base);
    assert.equal((await c.send('/admins')).status, 200);
    assert.equal((await c.send('/admins/app.js')).status, 200);
    assert.equal((await c.send('/admins/prices.js')).status, 200);
  });

  it('az admin mappa közvetlenül NEM tölthető le', async () => {
    const c = new Client(srv.base);
    assert.equal((await c.send('/admin/prices.js')).status, 404);
    assert.equal((await c.send('/admin/index.html')).status, 404);
  });

  it('a server mappa fájljai nem tölthetők le', async () => {
    const c = new Client(srv.base);
    assert.equal((await c.send('/server/config.json')).status, 404);
    assert.equal((await c.send('/server/data/prices.json')).status, 404);
    assert.equal((await c.send('/server/data/admin.json')).status, 404);
  });

  it('a masszázs oldal és az árlista stíluslapja betölt', async () => {
    const c = new Client(srv.base);
    assert.equal((await c.send('/masszazs/')).status, 200);
    assert.equal((await c.send('/masszazs/assets/css/prices.css')).status, 200);
  });
});
