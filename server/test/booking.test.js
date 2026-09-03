/* ═══════════════════════════════════════════════════════════════════════════
   FOGLALÁS — a naptár szabályai egy eldobható kiszolgálón
   ─────────────────────────────────────────────────────────────────────────
   A hangsúly azon a szabályon van, amitől az egész működik: egy foglalás a
   kezelés hosszánál 20 PERCCEL TOVÁBB foglalja a naptárt. Ez adja a
   pihenőt — és ez zárja ki visszafelé is a túl hosszú kezelést egy már
   lefoglalt időpont ELÉ.

   A tesztek konkrét, kézzel kiszámolható eseteket járnak körbe, mert a
   szabályt így lehet elrontás nélkül olvasni:

     9:00 + 45 perc + 20 perc pihenő  →  a következő kezdés 10:05
     10:00-ra foglalt 60 perc elé     →  9:00-ra 30 perc még belefér,
                                          45 perc már nem (10:05-ig érne)
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client } = require('./helpers');

let srv;
let admin;

before(async () => {
  srv = await startServer();
  admin = new Client(srv.base);
  const login = await admin.login();
  assert.equal(login.status, 200, 'a teszt admin be tud lépni');
});
after(async () => { if (srv) await srv.stop(); });

/* ── Segédek ────────────────────────────────────────────────────────────── */
const pad = (n) => (n < 10 ? '0' : '') + n;

function iso(date) {
  return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
}

/** A következő megadott hétnap (1 = hétfő), legalább `minDays` nap múlva. */
function nextWeekday(weekday, minDays = 3) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + minDays);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

function slots(site, date, duration) {
  return new Client(srv.base)
    .send(`/api/booking/availability?site=${site}&date=${date}&duration=${duration}`)
    .then((res) => {
      assert.equal(res.status, 200);
      return res.body;
    });
}

function book(payload, client) {
  return (client || new Client(srv.base)).send('/api/booking', {
    method: 'POST',
    json: Object.assign({
      name: 'Teszt Elek',
      phone: '+36 30 123 4567',
      email: 'teszt@pelda.hu',
      terms: true,
      gdpr: true
    }, payload)
  });
}

/** A nap üresre takarítása, hogy a tesztek ne lássák egymás foglalásait. */
async function clearDay(site, date) {
  const res = await admin.send(`/api/admin/bookings?site=${site}&from=${date}&to=${date}`);
  for (const booking of res.body.bookings) {
    await admin.send(`/api/admin/bookings/${booking.id}`, { method: 'DELETE' });
  }
}

/* Minden vizsgálat SAJÁT napot használ, hogy a sorrendjük ne számítson. */
const NAP = {
  lanc: nextWeekday(2, 7),        /* kedd — a 9:00 + 45 perc lánc */
  vissza: nextWeekday(3, 7),      /* szerda — a visszafelé ható szabály */
  szunet: nextWeekday(4, 7),      /* csütörtök — ebédszünet */
  verseny: nextWeekday(5, 7),     /* péntek — ugyanaz a sáv kétszer */
  admin: nextWeekday(2, 14),      /* kedd, jövő héten — admin felvétel */
  szabad: nextWeekday(3, 14)      /* szerda, jövő héten — szabadnap */
};

const VASARNAP = nextWeekday(0, 3);

/* ══════════════════════════════════════════════════════════════════════════
   A PIHENŐ SZABÁLYA
   ══════════════════════════════════════════════════════════════════════ */
describe('Két időpont között 20 perc pihenő', () => {
  it('üres napon a nyitástól kínál kezdést', async () => {
    const data = await slots('masszazs', NAP.lanc, 45);
    assert.equal(data.closed, false);
    assert.equal(data.slots[0], '08:00', 'a lista a nyitással kezdődik');
  });

  it('9:00-kor lefoglalt 45 perc után a következő kezdés 10:05', async () => {
    await clearDay('masszazs', NAP.lanc);

    const res = await book({
      site: 'masszazs', serviceKey: 'svedmasszazs', duration: 45,
      date: NAP.lanc, start: '09:00'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const data = await slots('masszazs', NAP.lanc, 45);
    assert.equal(data.slots.indexOf('09:00'), -1, 'a lefoglalt kezdés eltűnt');
    assert.equal(data.slots.indexOf('09:30'), -1, 'a belelógó kezdés is eltűnt');
    assert.equal(data.slots[0], '10:05', '9:00 + 45 perc + 20 perc pihenő');
  });

  it('a rövidebb kezelés a foglalás ELÉ még befér', async () => {
    /* 8:00 + 30 perc + 20 perc pihenő = 8:50, ami 9:00 előtt véget ér. */
    const data = await slots('masszazs', NAP.lanc, 30);
    assert.ok(data.slots.includes('08:00'), '8:00-ra 30 perc még belefér');
    assert.ok(data.slots.includes('10:05'), 'a foglalás után is lehet jönni');
  });
});

describe('A szabály visszafelé is működik', () => {
  before(async () => {
    await clearDay('masszazs', NAP.vissza);
    const res = await book({
      site: 'masszazs', serviceKey: 'gyogymasszazs', duration: 60,
      date: NAP.vissza, start: '10:00'
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  it('10:00 elé 9:00-ra 45 perc NEM fér be', async () => {
    /* 9:00 + 45 + 20 = 10:05 — belelógna a 10:00-ás foglalásba. */
    const data = await slots('masszazs', NAP.vissza, 45);
    assert.equal(data.slots.indexOf('09:00'), -1);
    assert.equal(data.slots.indexOf('09:30'), -1);
  });

  it('10:00 elé 9:00-ra 30 perc viszont igen', async () => {
    /* 9:00 + 30 + 20 = 9:50 — épp véget ér a foglalás kezdete előtt. */
    const data = await slots('masszazs', NAP.vissza, 30);
    assert.ok(data.slots.includes('09:00'));
  });

  it('a foglalás után 11:20-tól lehet újra jönni', async () => {
    /* 10:00 + 60 + 20 = 11:20 */
    const data = await slots('masszazs', NAP.vissza, 30);
    assert.ok(data.slots.includes('11:20'));
  });

  it('a kiszolgáló a fel nem kínált kezdést sem fogadja el', async () => {
    const res = await book({
      site: 'masszazs', serviceKey: 'svedmasszazs', duration: 45,
      date: NAP.vissza, start: '09:00'
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.ok, false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ZÁRVA TARTÁS, SZÜNET, SZABADNAP
   ══════════════════════════════════════════════════════════════════════ */
describe('Zárva tartás', () => {
  it('vasárnapra nem kínál időpontot', async () => {
    const data = await slots('masszazs', VASARNAP, 45);
    assert.equal(data.closed, true);
    assert.ok(data.reason, 'megmondja, miért');
    assert.equal(data.slots.length, 0);
  });

  it('vasárnapra foglalni sem lehet', async () => {
    const res = await book({
      site: 'masszazs', serviceKey: 'svedmasszazs', duration: 45,
      date: VASARNAP, start: '10:00'
    });
    assert.equal(res.status, 409);
  });

  it('a múltba nem lehet foglalni', async () => {
    const past = iso(new Date(Date.now() - 3 * 86400000));
    const data = await slots('masszazs', past, 45);
    assert.equal(data.closed, true);
  });
});

describe('Állandó szünet (ebéd)', () => {
  it('a szünetbe belelógó kezdést nem kínálja fel', async () => {
    /* Az alapértelmezett ebédszünet hétköznap 12:00–12:30. */
    const data = await slots('masszazs', NAP.szunet, 45);
    assert.equal(data.slots.indexOf('11:30'), -1, '11:30 + 45 perc belelógna az ebédbe');
    assert.equal(data.slots.indexOf('12:00'), -1, 'a szünet kezdete sem választható');
    assert.ok(data.slots.includes('12:30'), 'a szünet után újra lehet');
  });

  it('a szünet elé nem kér még egy pihenőt — a szünet maga a pihenés', async () => {
    /* 11:15 + 45 perc = 12:00, pont a szünet kezdetéig. Ez elfogadható. */
    const data = await slots('masszazs', NAP.szunet, 30);
    assert.ok(data.slots.includes('11:30'), '11:30 + 30 perc = 12:00, épp a szünetig');
  });
});

describe('Szabadnap', () => {
  it('a kijelölt nap kiesik, majd visszavonás után újra elérhető', async () => {
    const before = await slots('optika', NAP.szabad, 30);
    assert.equal(before.closed, false, 'kiindulásként nyitva van');

    const current = await admin.send('/api/admin/schedule?site=optika');
    const schedule = current.body.schedule;
    schedule.closures = schedule.closures.concat([
      { label: 'Szabadság', from: NAP.szabad, to: NAP.szabad }
    ]);

    const saved = await admin.send('/api/admin/schedule', {
      method: 'PUT', json: { site: 'optika', schedule }
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));

    const during = await slots('optika', NAP.szabad, 30);
    assert.equal(during.closed, true);
    assert.match(during.reason, /Szabadság/);

    /* Vissza az eredeti állapotra, hogy a többi vizsgálat ne akadjon el. */
    schedule.closures = [];
    await admin.send('/api/admin/schedule', { method: 'PUT', json: { site: 'optika', schedule } });

    const after = await slots('optika', NAP.szabad, 30);
    assert.equal(after.closed, false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   A FOGLALÁS MENTÉSE
   ══════════════════════════════════════════════════════════════════════ */
describe('Ugyanaz a sáv nem kel el kétszer', () => {
  it('a második kérés 409-et kap', async () => {
    await clearDay('optika', NAP.verseny);

    const first = await book({
      site: 'optika', serviceKey: 'general-exam', duration: 30,
      date: NAP.verseny, start: '10:00'
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const second = await book({
      site: 'optika', serviceKey: 'general-exam', duration: 30,
      date: NAP.verseny, start: '10:00'
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.ok, false);
  });

  it('lemondás után a sáv újra szabad', async () => {
    const list = await admin.send(`/api/admin/bookings?site=optika&from=${NAP.verseny}&to=${NAP.verseny}`);
    const booking = list.body.bookings.find((b) => b.start === '10:00');
    assert.ok(booking, 'megvan a foglalás');

    const removed = await admin.send(`/api/admin/bookings/${booking.id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);

    const data = await slots('optika', NAP.verseny, 30);
    assert.ok(data.slots.includes('10:00'));
  });
});

describe('A foglalás ellenőrzése', () => {
  it('a jelölőnégyzetek nélkül nincs foglalás', async () => {
    const res = await new Client(srv.base).send('/api/booking', {
      method: 'POST',
      json: {
        site: 'masszazs', serviceKey: 'svedmasszazs', duration: 45,
        date: NAP.lanc, start: '11:00',
        name: 'Teszt Elek', phone: '+36301234567', email: 'a@b.hu',
        terms: true, gdpr: false
      }
    });
    assert.equal(res.status, 400);
  });

  it('olyan hosszt nem fogad el, amihez nincs ár', async () => {
    /* A svédmasszázs 20 percben nem kérhető: az árlistában „—”. */
    const res = await book({
      site: 'masszazs', serviceKey: 'svedmasszazs', duration: 20,
      date: NAP.lanc, start: '15:00'
    });
    assert.equal(res.status, 409);
  });

  it('ismeretlen szolgáltatást nem fogad el', async () => {
    const res = await book({
      site: 'masszazs', serviceKey: 'nincs-ilyen', duration: 45,
      date: NAP.lanc, start: '15:00'
    });
    assert.equal(res.status, 409);
  });

  it('idegen eredetről nem lehet foglalni', async () => {
    const res = await new Client(srv.base).send('/api/booking', {
      method: 'POST',
      headers: { Origin: 'https://tamado.pelda' },
      json: {
        site: 'masszazs', serviceKey: 'svedmasszazs', duration: 45,
        date: NAP.lanc, start: '15:00',
        name: 'Teszt Elek', phone: '+36301234567', email: 'a@b.hu',
        terms: true, gdpr: true
      }
    });
    assert.equal(res.status, 403);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ADATVÉDELEM ÉS ADMIN
   ══════════════════════════════════════════════════════════════════════ */
describe('A nyilvános végpontok nem adnak ki vendégadatot', () => {
  it('a szabad órák listája csak időpontokat tartalmaz', async () => {
    const raw = await new Client(srv.base)
      .send(`/api/booking/availability?site=masszazs&date=${NAP.vissza}&duration=30`);
    const text = JSON.stringify(raw.body);
    assert.equal(text.includes('Teszt Elek'), false);
    assert.equal(text.includes('teszt@pelda.hu'), false);
  });

  it('a havi áttekintés is csak állapotot ad', async () => {
    const month = NAP.vissza.slice(0, 7);
    const raw = await new Client(srv.base)
      .send(`/api/booking/month?site=masszazs&month=${month}&duration=30`);
    const text = JSON.stringify(raw.body);
    assert.equal(text.includes('Teszt Elek'), false);
  });

  it('a foglalások listája bejelentkezés nélkül nem érhető el', async () => {
    const res = await new Client(srv.base).send('/api/admin/bookings?site=masszazs');
    assert.equal(res.status, 401);
  });

  it('a nyitvatartás mentése CSRF-token nélkül elakad', async () => {
    const res = await admin.send('/api/admin/schedule', {
      method: 'PUT',
      headers: { 'X-CSRF-Token': 'hamis' },
      json: { site: 'masszazs', schedule: {} }
    });
    assert.equal(res.status, 403);
  });
});

describe('Admin foglalásfelvétel', () => {
  it('a nyitvatartáson kívülre is felvehet időpontot', async () => {
    const res = await admin.send('/api/admin/bookings', {
      method: 'POST',
      json: {
        site: 'masszazs', serviceKey: 'svedmasszazs', duration: 45,
        date: NAP.admin, start: '07:00',        /* nyitás előtt */
        name: 'Telefonos Vendég', phone: '+36 30 999 8888'
      }
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.booking.source, 'admin');
  });

  it('ütközést adminként sem enged', async () => {
    const res = await admin.send('/api/admin/bookings', {
      method: 'POST',
      json: {
        site: 'masszazs', serviceKey: 'svedmasszazs', duration: 30,
        date: NAP.admin, start: '07:30',        /* belelógna az előzőbe */
        name: 'Másik Vendég', phone: '+36 30 777 6666'
      }
    });
    assert.equal(res.status, 409);
  });

  it('a napi menetrend a vendég adataival együtt jön', async () => {
    const res = await admin.send(`/api/admin/agenda?site=masszazs&from=${NAP.admin}`);
    assert.equal(res.status, 200);

    const booking = res.body.days[0].items.find((item) => item.kind === 'booking');
    assert.ok(booking, 'megvan a felvett foglalás');
    assert.equal(booking.booking.name, 'Telefonos Vendég');
    assert.equal(booking.booking.phone, '+36 30 999 8888');
    assert.equal(booking.to, '07:45', 'a kezelés vége');
    assert.equal(booking.restTo, '08:05', 'a pihenő vége');
  });

  it('a nyitvatartás nem menthető el üresre', async () => {
    const current = await admin.send('/api/admin/schedule?site=masszazs');
    const schedule = current.body.schedule;
    schedule.hours = [null, null, null, null, null, null, null];

    const res = await admin.send('/api/admin/schedule', {
      method: 'PUT', json: { site: 'masszazs', schedule }
    });
    assert.equal(res.status, 400);
  });
});
