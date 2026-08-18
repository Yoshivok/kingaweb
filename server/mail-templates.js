/* ═══════════════════════════════════════════════════════════════════════════
   Levélsablonok — az oldal arculatával (terrakotta / homok / espresso).
   Táblázatos elrendezés és beágyazott stílusok: a levelezőkliensek (Gmail,
   Outlook) nem támogatják megbízhatóan a modern CSS-t.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const C = {
  bg: '#faf8f5',
  card: '#ffffff',
  dark: '#1c1511',
  ink: '#241c18',
  muted: '#6b5d54',
  accent: '#d67b4b',
  accentDeep: '#a85832',
  gold: '#c9a96e',
  border: '#ebdcd0',
  cream: '#f7efe9'
};

/* A vendég szövege sosem kerül nyersen a HTML-be */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function row(label, value, opts) {
  const o = opts || {};
  return `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid ${C.border};font:400 13px/1.5 Arial,Helvetica,sans-serif;color:${C.muted};letter-spacing:.04em;text-transform:uppercase;width:38%;vertical-align:top">${esc(label)}</td>
      <td style="padding:12px 0;border-bottom:1px solid ${C.border};font:${o.strong ? '700' : '400'} 15px/1.6 Arial,Helvetica,sans-serif;color:${C.ink};vertical-align:top">${o.raw || esc(value)}</td>
    </tr>`;
}

function shell(opts) {
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
            <td style="font:700 22px/1.2 Georgia,'Times New Roman',serif;color:#ffffff;letter-spacing:.3px">Salvia</td>
            <td align="right" style="font:400 11px/1.4 Arial,Helvetica,sans-serif;color:${C.gold};letter-spacing:.18em;text-transform:uppercase">Gyógymasszázs</td>
          </tr></table>
        </td></tr>

        <!-- tartalom -->
        <tr><td style="padding:32px 30px 26px">
          ${opts.badge ? `<div style="display:inline-block;padding:6px 12px;background:${C.cream};border-radius:999px;font:700 11px/1 Arial,Helvetica,sans-serif;color:${C.accentDeep};letter-spacing:.12em;text-transform:uppercase;margin-bottom:16px">${esc(opts.badge)}</div>` : ''}
          <h1 style="margin:0 0 14px;font:400 26px/1.25 Georgia,'Times New Roman',serif;color:${C.ink}">${esc(opts.title)}</h1>
          <p style="margin:0 0 22px;font:400 15px/1.7 Arial,Helvetica,sans-serif;color:${C.muted}">${opts.lead}</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.border}">
            ${opts.rows}
          </table>

          ${opts.after || ''}
        </td></tr>

        <!-- lábléc -->
        <tr><td style="background:${C.cream};padding:22px 30px;border-top:1px solid ${C.border}">
          <p style="margin:0 0 6px;font:400 13px/1.6 Arial,Helvetica,sans-serif;color:${C.muted}">
            <strong style="color:${C.ink}">Salvia Gyógymasszázs</strong><br>
            1051 Budapest, Példa utca 12. &middot; 06 20 501 7453
          </p>
          <p style="margin:0;font:400 12px/1.6 Arial,Helvetica,sans-serif;color:${C.muted}">
            ${esc(opts.footerNote)}
          </p>
        </td></tr>

      </table>
      <p style="margin:16px 0 0;font:400 11px/1.5 Arial,Helvetica,sans-serif;color:${C.muted};max-width:600px">
        Ez az üzenet a weboldalon leadott időpontkérés alapján készült.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px"><tr>
    <td style="background:${C.accentDeep};border-radius:999px">
      <a href="${esc(href)}" style="display:inline-block;padding:13px 26px;font:700 14px/1 Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none">${esc(label)}</a>
    </td></tr></table>`;
}

/* ── 1. Visszaigazolás a vendégnek ────────────────────────────────────────── */
function customerMail(data, cfg) {
  const subject = 'Megkaptuk az időpontkérését — Salvia Gyógymasszázs';
  const rows =
    row('Kezelés', data.treatment, { strong: true }) +
    row('Időtartam', data.duration) +
    row('Preferált nap', data.date) +
    row('Preferált időpont', data.time) +
    (data.message ? row('Megjegyzése', `<span style="white-space:pre-wrap">${esc(data.message)}</span>`, { raw: `<span style="white-space:pre-wrap">${esc(data.message)}</span>` }) : '');

  const after = `
    <div style="margin:26px 0 0;padding:18px 20px;background:${C.cream};border-left:3px solid ${C.accent};border-radius:0 10px 10px 0">
      <p style="margin:0 0 6px;font:700 12px/1 Arial,Helvetica,sans-serif;color:${C.accentDeep};letter-spacing:.1em;text-transform:uppercase">Mi történik most</p>
      <p style="margin:0;font:400 14px/1.7 Arial,Helvetica,sans-serif;color:${C.muted}">
        <strong style="color:${C.ink}">1 munkanapon belül</strong> visszahívjuk a megadott számon
        (${esc(data.phone)}), és egyeztetjük a pontos időpontot. Ez a levél
        <strong style="color:${C.ink}">még nem foglalás</strong>, és nem jár fizetési kötelezettséggel.
      </p>
    </div>
    ${button('tel:' + (cfg.phoneRaw || '+36205017453'), 'Inkább telefonálok')}
    <p style="margin:18px 0 0;font:400 13px/1.7 Arial,Helvetica,sans-serif;color:${C.muted}">
      Ha bármelyik adat téves, egyszerűen válaszoljon erre a levélre.
    </p>`;

  const html = shell({
    subject,
    preheader: 'Megkaptuk az időpontkérését. 1 munkanapon belül visszahívjuk.',
    badge: 'Időpontkérés fogadva',
    title: `Köszönjük, ${esc(data.name)}!`,
    lead: 'Az alábbi kéréssel jelentkezett be nálunk. Kérjük, ellenőrizze az adatokat.',
    rows,
    after,
    footerNote: 'Adatait kizárólag az időpont-egyeztetéshez használjuk. Az adatkezelésről a weboldal „Adatkezelési tájékoztató” oldalán olvashat.'
  });

  const text = [
    `Köszönjük, ${data.name}!`,
    '',
    'Megkaptuk az időpontkérését:',
    `- Kezelés: ${data.treatment}`,
    `- Időtartam: ${data.duration}`,
    `- Preferált nap: ${data.date}`,
    `- Preferált időpont: ${data.time}`,
    data.message ? `- Megjegyzés: ${data.message}` : null,
    '',
    `1 munkanapon belül visszahívjuk a megadott számon (${data.phone}), és egyeztetjük a pontos időpontot.`,
    'Ez a levél még nem foglalás, és nem jár fizetési kötelezettséggel.',
    '',
    'Salvia Gyógymasszázs · 1051 Budapest, Példa utca 12. · 06 20 501 7453'
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}

/* ── 2. Értesítés a masszőrnek ────────────────────────────────────────────── */
function ownerMail(data, cfg) {
  const subject = `Új időpontkérés — ${data.name} (${data.treatment}, ${data.duration})`;
  const rows =
    row('Név', data.name, { strong: true }) +
    row('Telefon', data.phone, { raw: `<a href="tel:${esc(data.phone.replace(/\s+/g, ''))}" style="color:${C.accentDeep};font-weight:700;text-decoration:none">${esc(data.phone)}</a>` }) +
    row('E-mail', data.email, { raw: `<a href="mailto:${esc(data.email)}" style="color:${C.accentDeep};text-decoration:none">${esc(data.email)}</a>` }) +
    row('Kezelés', data.treatment, { strong: true }) +
    row('Időtartam', data.duration) +
    row('Preferált nap', data.date) +
    row('Preferált időpont', data.time) +
    row('Beérkezett', new Date().toLocaleString('hu-HU', { timeZone: cfg.timeZone || 'Europe/Budapest' }));

  const after = `
    ${data.message ? `
    <div style="margin:26px 0 0;padding:18px 20px;background:${C.cream};border-radius:10px">
      <p style="margin:0 0 6px;font:700 12px/1 Arial,Helvetica,sans-serif;color:${C.accentDeep};letter-spacing:.1em;text-transform:uppercase">A vendég megjegyzése</p>
      <p style="margin:0;font:400 14px/1.7 Arial,Helvetica,sans-serif;color:${C.ink};white-space:pre-wrap">${esc(data.message)}</p>
    </div>` : `
    <p style="margin:22px 0 0;font:400 14px/1.7 Arial,Helvetica,sans-serif;color:${C.muted}">A vendég nem írt megjegyzést — az egészségi állapotot a visszahíváskor kell tisztázni.</p>`}
    ${button('tel:' + data.phone.replace(/\s+/g, ''), 'Visszahívás: ' + data.phone)}
    <p style="margin:14px 0 0;font:400 13px/1.7 Arial,Helvetica,sans-serif;color:${C.muted}">
      A levélre válaszolva közvetlenül a vendégnek írhat.
    </p>`;

  const html = shell({
    subject,
    preheader: `${data.name} · ${data.treatment} · ${data.date}`,
    badge: 'Új időpontkérés',
    title: 'Időpontkérés érkezett',
    lead: 'A weboldal űrlapján keresztül új megkeresés jött. A vendég visszaigazolást kapott.',
    rows,
    after,
    footerNote: 'A vendég nyilatkozott arról, hogy megismerte az ellenjavallatokat, és hozzájárult az adatkezeléshez.'
  });

  const text = [
    'Új időpontkérés érkezett a weboldalról:',
    '',
    `Név: ${data.name}`,
    `Telefon: ${data.phone}`,
    `E-mail: ${data.email}`,
    `Kezelés: ${data.treatment} (${data.duration})`,
    `Preferált nap: ${data.date} — ${data.time}`,
    data.message ? `Megjegyzés: ${data.message}` : 'Megjegyzés: —',
    '',
    `Beérkezett: ${new Date().toLocaleString('hu-HU', { timeZone: cfg.timeZone || 'Europe/Budapest' })}`
  ].join('\n');

  return { subject, html, text };
}

module.exports = { customerMail, ownerMail };
