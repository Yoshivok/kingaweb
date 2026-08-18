/* ═══════════════════════════════════════════════════════════════════════════
   Levélküldés tesztelése — nem kell hozzá az űrlapot kitölteni.

     node server/test-mail.js                  → a config.json `to` címére
     node server/test-mail.js cim@example.com  → megadott címre

   A hibát emberi nyelven magyarázza (rossz jelszó, hiányzó app-jelszó stb.).
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sendMail, buildMessage } = require('./smtp');
const { customerMail, ownerMail } = require('./mail-templates');

function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (err) {
    console.error('\n  ✗ Nincs server/config.json. Másolja le a mintát:\n');
    console.error('      cp server/config.example.json server/config.json\n');
    process.exit(1);
  }
  const smtp = Object.assign({ host: 'smtp.gmail.com', port: 587, clientName: 'salviamasszazs.hu' }, file.smtp);
  smtp.user = process.env.SMTP_USER || smtp.user || '';
  smtp.pass = process.env.SMTP_PASS || smtp.pass || '';
  return {
    smtp,
    from: file.from || smtp.user,
    fromName: file.fromName || 'Salvia Gyógymasszázs',
    to: process.argv[2] || process.env.MAIL_TO || file.to || '',
    phoneRaw: file.phoneRaw || '+36205017453',
    timeZone: file.timeZone || 'Europe/Budapest'
  };
}

const cfg = loadConfig();

const missing = [];
if (!cfg.smtp.user) missing.push('smtp.user (a küldő fiók e-mail címe)');
if (!cfg.smtp.pass) missing.push('smtp.pass (app-jelszó)');
if (!cfg.to) missing.push('to (a címzett)');

if (missing.length) {
  console.error('\n  ✗ Hiányzó beállítás a server/config.json-ban:\n');
  missing.forEach((m) => console.error('      • ' + m));
  console.error('\n  Gmailnél a fiók saját jelszava NEM működik. Teendő:');
  console.error('    1. Google-fiók → Biztonság → Kétlépcsős azonosítás bekapcsolása');
  console.error('    2. https://myaccount.google.com/apppasswords → új app-jelszó');
  console.error('    3. a kapott 16 karaktert írja a smtp.pass mezőbe\n');
  process.exit(1);
}

const sample = {
  name: 'Teszt Anna',
  phone: '+36 30 111 2222',
  email: cfg.to,
  treatment: 'Gyógymasszázs',
  treatmentKey: 'gyogymasszazs',
  duration: '60 perc',
  date: 'próbaküldés',
  dateRaw: '',
  time: '10:00',
  message: 'Ez egy próbalevél a weboldal beállításának ellenőrzéséhez.'
};

(async () => {
  console.log(`\n  Próbaküldés: ${cfg.smtp.host}:${cfg.smtp.port}`);
  console.log(`  Feladó: ${cfg.from}`);
  console.log(`  Címzett: ${cfg.to}\n`);

  const variants = [
    ['vendégnek szóló visszaigazolás', customerMail(sample, cfg)],
    ['masszőrnek szóló értesítés', ownerMail(sample, cfg)]
  ];

  try {
    for (const [label, mail] of variants) {
      await sendMail(cfg.smtp, buildMessage({
        from: { address: cfg.from, name: cfg.fromName },
        to: [{ address: cfg.to, name: 'Teszt' }],
        subject: '[TESZT] ' + mail.subject,
        html: mail.html,
        text: mail.text
      }));
      console.log(`  ✓ elment: ${label}`);
    }
    console.log('\n  Kész — nézze meg a postaládát (a spam mappát is).\n');
  } catch (err) {
    console.error(`\n  ✗ Nem sikerült: ${err.message}`);
    if (err.hint) console.error(`\n  → ${err.hint}`);
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      console.error('\n  → A kiszolgáló nem érhető el. Ellenőrizze a host/port értéket és a hálózatot.');
    }
    console.error('');
    process.exit(1);
  }
})();
