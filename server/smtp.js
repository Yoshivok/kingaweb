/* ═══════════════════════════════════════════════════════════════════════════
   Minimális SMTP-kliens — külső csomag nélkül (net + tls a Node-ból).
   Támogatja a 587-es portot STARTTLS-sel és a 465-öst közvetlen TLS-sel,
   valamint az AUTH LOGIN hitelesítést (ezt használja a Gmail app-jelszóval).
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

/* ── Válaszolvasó: az SMTP többsoros választ ad (250-… sorok, végül 250 …) ── */
function createReader(socket) {
  let buffer = '';
  let pending = null;

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    if (!pending) return;
    const lines = buffer.split(/\r?\n/);
    for (let i = 0; i < lines.length - 1; i++) {
      /* az utolsó sorban a kód után szóköz áll, a folytatásokban kötőjel */
      if (/^\d{3} /.test(lines[i])) {
        const response = lines.slice(0, i + 1).join('\n');
        buffer = lines.slice(i + 1).join('\n');
        const resolve = pending.resolve;
        pending = null;
        resolve({ code: Number(response.slice(0, 3)), text: response });
        return;
      }
    }
  });

  return {
    read() {
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        socket.once('error', reject);
      });
    },
    reset(newSocket) { socket = newSocket; buffer = ''; pending = null; }
  };
}

/* Beszédes magyarázat a gyakori hibakódokhoz — a nyers SMTP-válasz kevés */
function hintFor(code, text) {
  const t = String(text);
  if (code === 535 || /5\.7\.8|BadCredentials/i.test(t)) {
    return 'A felhasználónév vagy a jelszó nem jó. Gmailnél a fiók saját jelszava NEM működik: '
         + 'kétlépcsős azonosítás bekapcsolása után app-jelszót kell generálni '
         + '(myaccount.google.com/apppasswords), és azt a 16 karaktert kell ide beírni.';
  }
  if (/5\.7\.9|Application-specific password required/i.test(t)) {
    return 'A Google app-jelszót kér. Kapcsolja be a kétlépcsős azonosítást, majd generáljon app-jelszót.';
  }
  if (code === 534) {
    return 'A fiók biztonsági beállításai nem engedik ezt a bejelentkezést — app-jelszó szükséges.';
  }
  if (code === 550 || code === 553) {
    return 'A kiszolgáló elutasította a címzettet vagy a feladót. Ellenőrizze, hogy a `from` '
         + 'ugyanaz a cím-e, mint az SMTP-felhasználó.';
  }
  if (code === 421 || code === 450 || code === 451) {
    return 'A kiszolgáló átmenetileg nem fogad — próbálja újra pár perc múlva.';
  }
  return null;
}

class SmtpSession {
  constructor(socket) {
    this.socket = socket;
    this.reader = createReader(socket);
  }

  async expect(...codes) {
    const res = await this.reader.read();
    if (!codes.includes(res.code)) {
      const err = new Error(`SMTP hiba: vártam ${codes.join('/')}, kaptam: ${res.text.trim()}`);
      err.smtpCode = res.code;
      err.hint = hintFor(res.code, res.text);
      throw err;
    }
    return res;
  }

  send(line) {
    this.socket.write(line + '\r\n');
  }

  async cmd(line, ...codes) {
    this.send(line);
    return this.expect(...codes);
  }
}

/* ── Egy levél elküldése ──────────────────────────────────────────────────── */
async function sendMail(config, message) {
  const { host, port, user, pass, secure } = config;
  const useImplicitTls = secure === true || Number(port) === 465;

  let socket = useImplicitTls
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });

  await new Promise((resolve, reject) => {
    socket.once(useImplicitTls ? 'secureConnect' : 'connect', resolve);
    socket.once('error', reject);
    socket.setTimeout(20000, () => reject(new Error('SMTP időtúllépés a kapcsolódásnál')));
  });

  let session = new SmtpSession(socket);
  await session.expect(220);
  await session.cmd(`EHLO ${config.clientName || 'localhost'}`, 250);

  if (!useImplicitTls) {
    await session.cmd('STARTTLS', 220);
    socket = tls.connect({ socket, servername: host });
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
    session = new SmtpSession(socket);
    await session.cmd(`EHLO ${config.clientName || 'localhost'}`, 250);
  }

  if (user && pass) {
    await session.cmd('AUTH LOGIN', 334);
    await session.cmd(Buffer.from(user, 'utf8').toString('base64'), 334);
    await session.cmd(Buffer.from(pass, 'utf8').toString('base64'), 235);
  }

  await session.cmd(`MAIL FROM:<${message.envelopeFrom}>`, 250);
  for (const rcpt of message.envelopeTo) {
    await session.cmd(`RCPT TO:<${rcpt}>`, 250, 251);
  }
  await session.cmd('DATA', 354);

  /* Pontozás: a sor elején álló pont duplázandó (RFC 5321 4.5.2) */
  const body = message.raw.replace(/\r?\n\./g, '\r\n..');
  socket.write(body.replace(/\r?\n/g, '\r\n') + '\r\n.\r\n');
  await session.expect(250);

  session.send('QUIT');
  socket.end();
  return true;
}

/* ── MIME-levél összeállítása (UTF-8, sima szöveg + HTML) ─────────────────── */
function encodeHeader(value) {
  /* csak akkor kódolunk, ha nem ASCII — így olvasható marad a nyers forrás */
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return '=?UTF-8?B?' + Buffer.from(value, 'utf8').toString('base64') + '?=';
}

function encodeAddress(address, name) {
  return name ? `${encodeHeader(name)} <${address}>` : `<${address}>`;
}

function base64Body(text) {
  return Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
}

function buildMessage(opts) {
  const boundary = '=_salvia_' + crypto.randomBytes(12).toString('hex');
  const domain = (opts.from.address.split('@')[1] || 'localhost');

  const headers = [
    `From: ${encodeAddress(opts.from.address, opts.from.name)}`,
    `To: ${opts.to.map((t) => encodeAddress(t.address, t.name)).join(', ')}`,
    opts.replyTo ? `Reply-To: ${encodeAddress(opts.replyTo.address, opts.replyTo.name)}` : null,
    `Subject: ${encodeHeader(opts.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ].filter(Boolean);

  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(opts.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(opts.html),
    `--${boundary}--`,
    ''
  ];

  return {
    raw: headers.join('\r\n') + '\r\n\r\n' + parts.join('\r\n'),
    envelopeFrom: opts.from.address,
    envelopeTo: opts.to.map((t) => t.address)
  };
}

module.exports = { sendMail, buildMessage };
