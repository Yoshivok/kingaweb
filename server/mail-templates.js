/* ═══════════════════════════════════════════════════════════════════════════
   Levélsablonok — VISSZAIGAZOLT foglalásokhoz
   ─────────────────────────────────────────────────────────────────────────
   Két arculat, egy sablon. A masszázs terrakotta, az optika sötétzöld-arany
   — ugyanaz a szerkezet, csak a színek, a név és az elérhetőség cserélődik.
   Így nem kell két, egymástól lassan elcsúszó levélsablont karbantartani.

   Táblázatos elrendezés és beágyazott stílusok: a levelezőkliensek (Gmail,
   Outlook) nem támogatják megbízhatóan a modern CSS-t.

   FONTOS SZÖVEGI KÜLÖNBSÉG A KORÁBBI VÁLTOZATHOZ KÉPEST. Régen a beküldés
   csak időpontKÉRÉS volt („1 munkanapon belül visszahívjuk”). Most a naptár
   valódi: a vendég egy szabad sávot foglal le, és az a sáv abban a
   pillanatban el is kel. A levél ezért visszaigazolás, nem ígéret.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

/* ── Arculatok ────────────────────────────────────────────────────────────
   A `dark` a fejléc alapja, az `accent` a kiemelés, a `cream` a kiemelt
   dobozok háttere. A két készlet a két weboldal saját színeiből származik. */
const BRANDS = {
  masszazs: {
    name: 'Salvia',
    tagline: 'Gyógymasszázs',
    fullName: 'Salvia Gyógymasszázs',
    address: '1111 Budapest, Karinthy Frigyes út 20.',
    phone: '06 20 501 7453',
    phoneRaw: '+36205017453',
    colors: {
      bg: '#faf8f5', card: '#ffffff', dark: '#1c1511', ink: '#241c18',
      muted: '#6b5d54', accent: '#d67b4b', accentDeep: '#a85832',
      gold: '#c9a96e', border: '#ebdcd0', cream: '#f7efe9'
    },
    arrive: 'Kérjük, néhány perccel a kezdés előtt érkezzen — az időpont a foglalt idővel indul.',
    consent: 'A vendég nyilatkozott arról, hogy megismerte az ellenjavallatokat, és hozzájárult az adatkezeléshez.'
  },
  optika: {
    name: 'Lumina',
    tagline: 'Optika',
    fullName: 'Lumina Optika',
    address: '1111 Budapest, Karinthy Frigyes út 20.',
    phone: '06 20 972 9122',
    phoneRaw: '+36209729122',
    colors: {
      bg: '#faf8f5', card: '#ffffff', dark: '#1c2321', ink: '#241c18',
      muted: '#6b5d54', accent: '#b8976b', accentDeep: '#8d7048',
      gold: '#d8c39c', border: '#e6ded2', cream: '#f6f1e9'
    },
    arrive: 'Kérjük, néhány perccel a vizsgálat előtt érkezzen, és hozza magával a jelenlegi szemüvegét.',
    consent: 'A vendég elfogadta a Házirendet és az ÁSZF-et, és hozzájárult az adatkezeléshez.'
  }
};

function brandOf(site) { return BRANDS[site] || BRANDS.masszazs; }

/* A vendég szövege sosem kerül nyersen a HTML-be */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Idő emberi alakban ───────────────────────────────────────────────────
   A dátum ÉÉÉÉ-HH-NN alakban érkezik. UTC-ként olvassuk be és UTC-ként
   formázzuk: így a kiszolgáló időzónája nem tolhatja el egy nappal. */
function longDate(day) {
  try {
    return new Date(day + 'T12:00:00Z').toLocaleDateString('hu-HU', {
      timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
    });
  } catch (err) {
    return day;
  }
}

/** '09:00' → '9:00' — az oldalon is vezető nulla nélkül írjuk az órákat. */
function shortTime(clock) {
  return String(clock || '').replace(/^0/, '');
}

function row(C, label, value, opts) {
  const o = opts || {};
  return `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid ${C.border};font:400 13px/1.5 Arial,Helvetica,sans-serif;color:${C.muted};letter-spacing:.04em;text-transform:uppercase;width:38%;vertical-align:top">${esc(label)}</td>
      <td style="padding:12px 0;border-bottom:1px solid ${C.border};font:${o.strong ? '700' : '400'} 15px/1.6 Arial,Helvetica,sans-serif;color:${C.ink};vertical-align:top">${o.raw || esc(value)}</td>
    </tr>`;
}

function shell(brand, opts) {
  const C = brand.colors;
  return `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.card};border:1px solid ${C.border};border-radius:16px;overflow:hidden">

        <!-- fejléc -->
        <tr><td style="background:${C.dark};padding:26px 30px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font:700 22px/1.2 Georgia,'Times New Roman',serif;color:#ffffff;letter-spacing:.3px">${esc(brand.name)}</td>
            <td align="right" style="font:400 11px/1.4 Arial,Helvetica,sans-serif;color:${C.gold};letter-spacing:.18em;text-transform:uppercase">${esc(brand.tagline)}</td>
          </tr></table>
        </td></tr>

        <!-- tartalom -->
        <tr><td style="padding:32px 30px 26px">
          ${opts.badge ? `<div style="display:inline-block;padding:6px 12px;background:${C.cream};border-radius:999px;font:700 11px/1 Arial,Helvetica,sans-serif;color:${C.accentDeep};letter-spacing:.12em;text-transform:uppercase;margin-bottom:16px">${esc(opts.badge)}</div>` : ''}
          <h1 style="margin:0 0 14px;font:400 26px/1.25 Georgia,'Times New Roman',serif;color:${C.ink}">${opts.title}</h1>
          <p style="margin:0 0 22px;font:400 15px/1.7 Arial,Helvetica,sans-serif;color:${C.muted}">${opts.lead}</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.border}">
            ${opts.rows}
          </table>

          ${opts.after || ''}
        </td></tr>

        <!-- lábléc -->
        <tr><td style="background:${C.cream};padding:22px 30px;border-top:1px solid ${C.border}">
          <p style="margin:0 0 6px;font:400 13px/1.6 Arial,Helvetica,sans-serif;color:${C.muted}">
            <strong style="color:${C.ink}">${esc(brand.fullName)}</strong><br>
            ${esc(brand.address)} &middot; ${esc(brand.phone)}
          </p>
          <p style="margin:0;font:400 12px/1.6 Arial,Helvetica,sans-serif;color:${C.muted}">
            ${esc(opts.footerNote)}
          </p>
        </td></tr>

      </table>
      <p style="margin:16px 0 0;font:400 11px/1.5 Arial,Helvetica,sans-serif;color:${C.muted};max-width:600px">
        Ez az üzenet a weboldalon leadott foglalás alapján készült.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(C, href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px"><tr>
    <td style="background:${C.accentDeep};border-radius:999px">
      <a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font:700 14px/1 Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none">${esc(label)}</a>
    </td></tr></table>`;
}

/** A foglalás közös sorai — mindkét levélben ugyanaz a sorrend. */
function slotRows(C, data) {
  return (
    row(C, 'Szolgáltatás', data.serviceName, { strong: true }) +
    row(C, 'Időtartam', data.duration + ' perc') +
    row(C, 'Nap', longDate(data.date), { strong: true }) +
    row(C, 'Időpont', shortTime(data.start) + ' – ' + shortTime(data.end), { strong: true })
  );
}

/* ── 1. Visszaigazolás a vendégnek ────────────────────────────────────────── */
function customerMail(data, cfg) {
  const brand = brandOf(data.site);
  const C = brand.colors;
  const subject = `Foglalása visszaigazolva — ${longDate(data.date)} ${shortTime(data.start)} · ${brand.fullName}`;

  const rows = slotRows(C, data) +
    (data.message
      ? row(C, 'Megjegyzése', '', { raw: `<span style="white-space:pre-wrap">${esc(data.message)}</span>` })
      : '');

  const after = `
    <div style="margin:26px 0 0;padding:18px 20px;background:${C.cream};border-left:3px solid ${C.accent};border-radius:0 10px 10px 0">
      <p style="margin:0 0 6px;font:700 12px/1 Arial,Helvetica,sans-serif;color:${C.accentDeep};letter-spacing:.1em;text-transform:uppercase">Jó tudni</p>
      <p style="margin:0;font:400 14px/1.7 Arial,Helvetica,sans-serif;color:${C.muted}">
        ${esc(brand.arrive)}
        Ha mégsem tud jönni, kérjük, <strong style="color:${C.ink}">jelezze legalább 24 órával előre</strong>
        a ${esc(brand.phone)} számon — így másnak fel tudjuk ajánlani a felszabaduló időt.
      </p>
    </div>
    ${button(C, 'tel:' + brand.phoneRaw, 'Hívás: ' + brand.phone)}
    <p style="margin:18px 0 0;font:400 13px/1.7 Arial,Helvetica,sans-serif;color:${C.muted}">
      Ha bármelyik adat téves, egyszerűen válaszoljon erre a levélre.
      Foglalás azonosítója: <strong style="color:${C.ink}">${esc(data.id || '—')}</strong>
    </p>`;

  const html = shell(brand, {
    subject,
    preheader: `${longDate(data.date)} ${shortTime(data.start)} — ${data.serviceName}`,
    badge: 'Foglalás visszaigazolva',
    title: `Köszönjük, ${esc(data.name)}!`,
    lead: 'Időpontját rögzítettük a naptárunkban. Az alábbi adatokat mentettük el — kérjük, ellenőrizze őket.',
    rows,
    after,
    footerNote: 'Adatait kizárólag a foglalás teljesítéséhez használjuk. Az adatkezelésről a weboldal „Adatkezelési tájékoztató” oldalán olvashat.'
  });

  const text = [
    `Köszönjük, ${data.name}!`,
    '',
    'Foglalását rögzítettük:',
    `- Szolgáltatás: ${data.serviceName}`,
    `- Időtartam: ${data.duration} perc`,
    `- Nap: ${longDate(data.date)}`,
    `- Időpont: ${shortTime(data.start)} – ${shortTime(data.end)}`,
    data.message ? `- Megjegyzés: ${data.message}` : null,
    '',
    brand.arrive,
    `Ha mégsem tud jönni, kérjük, jelezze legalább 24 órával előre a ${brand.phone} számon.`,
    '',
    `Foglalás azonosítója: ${data.id || '—'}`,
    '',
    `${brand.fullName} · ${brand.address} · ${brand.phone}`
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}

/* ── 2. Értesítés a szolgáltatónak ────────────────────────────────────────── */
function ownerMail(data, cfg) {
  const brand = brandOf(data.site);
  const C = brand.colors;
  const subject = `Új foglalás — ${longDate(data.date)} ${shortTime(data.start)} · ${data.name} (${data.serviceName})`;

  const tel = String(data.phone || '').replace(/\s+/g, '');
  const rows =
    slotRows(C, data) +
    row(C, 'Név', data.name, { strong: true }) +
    row(C, 'Telefon', data.phone, { raw: `<a href="tel:${esc(tel)}" style="color:${C.accentDeep};font-weight:700;text-decoration:none">${esc(data.phone)}</a>` }) +
    (data.email
      ? row(C, 'E-mail', data.email, { raw: `<a href="mailto:${esc(data.email)}" style="color:${C.accentDeep};text-decoration:none">${esc(data.email)}</a>` })
      : '') +
    row(C, 'Pihenőig foglalt', shortTime(data.restEnd || data.end)) +
    row(C, 'Beérkezett', new Date().toLocaleString('hu-HU', { timeZone: (cfg && cfg.timeZone) || 'Europe/Budapest' }));

  const after = `
    ${data.message ? `
    <div style="margin:26px 0 0;padding:18px 20px;background:${C.cream};border-radius:10px">
      <p style="margin:0 0 6px;font:700 12px/1 Arial,Helvetica,sans-serif;color:${C.accentDeep};letter-spacing:.1em;text-transform:uppercase">A vendég megjegyzése</p>
      <p style="margin:0;font:400 14px/1.7 Arial,Helvetica,sans-serif;color:${C.ink};white-space:pre-wrap">${esc(data.message)}</p>
    </div>` : `
    <p style="margin:22px 0 0;font:400 14px/1.7 Arial,Helvetica,sans-serif;color:${C.muted}">A vendég nem írt megjegyzést.</p>`}
    ${data.phone ? button(C, 'tel:' + tel, 'Hívás: ' + data.phone) : ''}
    <p style="margin:14px 0 0;font:400 13px/1.7 Arial,Helvetica,sans-serif;color:${C.muted}">
      A foglalás az admin felület naptárában is megjelent, és onnan mondható le.
    </p>`;

  const html = shell(brand, {
    subject,
    preheader: `${data.name} · ${data.serviceName} · ${longDate(data.date)} ${shortTime(data.start)}`,
    badge: 'Új foglalás',
    title: 'Lefoglaltak egy időpontot',
    lead: 'A weboldal naptárán keresztül új foglalás érkezett. A vendég visszaigazolást kapott.',
    rows,
    after,
    footerNote: brand.consent
  });

  const text = [
    'Új foglalás érkezett a weboldalról:',
    '',
    `Nap: ${longDate(data.date)}`,
    `Időpont: ${shortTime(data.start)} – ${shortTime(data.end)} (pihenővel ${shortTime(data.restEnd || data.end)}-ig)`,
    `Szolgáltatás: ${data.serviceName} (${data.duration} perc)`,
    '',
    `Név: ${data.name}`,
    `Telefon: ${data.phone}`,
    data.email ? `E-mail: ${data.email}` : null,
    data.message ? `Megjegyzés: ${data.message}` : 'Megjegyzés: —',
    '',
    `Azonosító: ${data.id || '—'}`,
    `Beérkezett: ${new Date().toLocaleString('hu-HU', { timeZone: (cfg && cfg.timeZone) || 'Europe/Budapest' })}`
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}

module.exports = { customerMail, ownerMail, BRANDS, brandOf, longDate, shortTime };
