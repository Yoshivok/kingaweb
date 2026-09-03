/* ═══════════════════════════════════════════════════════════════════════════
   SALVIA GYÓGYMASSZÁZS — hozzájárulás-kezelés (sütik és külső tartalmak)
   ─────────────────────────────────────────────────────────────────────────
   Az oldal nem használ követő- vagy marketingsütiket, és nem futtat analitikát.
   Egyetlen dolgot tárolunk az eszközön: magát a döntést (localStorage), ami az
   ePrivacy-irányelv szerint feltétlenül szükséges tárolás.

   A hozzájárulás valódi hatása: a `data-consent-src` attribútummal jelölt
   külső beágyazások (pl. Google Maps térkép) CSAK elfogadás után töltődnek be.
   Elutasításkor a helyükön egy gomb marad, amivel eseti alapon engedélyezhetők.

   Beágyazás jelölése:
     <div class="embed" data-consent-src="https://…/maps/embed?pb=…"
          data-consent-title="A rendelő helye a térképen"
          data-consent-label="Térkép megjelenítése"></div>

   Nyilvános felület: window.SalviaConsent.granted() / .open() / .set(bool)
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEY = 'salvia-consent';
  var VERSION = 1;

  /* ── Tárolás ──────────────────────────────────────────────────────────── */
  function read() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      var val = JSON.parse(raw);
      return (val && val.v === VERSION) ? val : null;
    } catch (err) {
      /* privát böngészés vagy letiltott tárolás: döntés nélkül működünk tovább */
      return null;
    }
  }

  function write(external) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({
        v: VERSION, external: !!external, ts: Date.now()
      }));
    } catch (err) { /* nem kritikus */ }
  }

  /* ── Külső beágyazások ────────────────────────────────────────────────── */
  function placeholder(box) {
    var label = box.getAttribute('data-consent-label') || 'Tartalom megjelenítése';
    var gate = box.querySelector('.embed-gate');
    if (!gate) {
      gate = document.createElement('div');
      gate.className = 'embed-gate';
      gate.innerHTML =
        '<p class="embed-gate__text">Ez a tartalom külső szolgáltatótól töltődik be, ' +
        'ami továbbítja az Ön IP-címét. Megjelenítéshez engedélyre van szükség.</p>' +
        '<button class="btn btn--ghost btn--sm" type="button">' + label + '</button>';
      box.appendChild(gate);
    }
    var btn = gate.querySelector('button');
    if (btn) {
      btn.addEventListener('click', function () {
        set(true);
      });
    }
  }

  function release(box) {
    var src = box.getAttribute('data-consent-src');
    if (!src) return;
    var existing = box.querySelector('iframe');
    if (existing && existing.getAttribute('src') === src) return;
    var frame = document.createElement('iframe');
    frame.src = src;
    frame.title = box.getAttribute('data-consent-title') || 'Beágyazott tartalom';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'no-referrer-when-downgrade';
    frame.setAttribute('allowfullscreen', '');
    box.innerHTML = '';
    box.appendChild(frame);
  }

  function syncEmbeds(granted) {
    var boxes = document.querySelectorAll('[data-consent-src]');
    Array.prototype.forEach.call(boxes, function (box) {
      if (granted) release(box);
      else if (!box.querySelector('.embed-gate')) placeholder(box);
    });
  }

  /* ── Sáv ──────────────────────────────────────────────────────────────── */
  var bar = null;

  function show() { if (bar) bar.hidden = false; }
  function hide() { if (bar) bar.hidden = true; }

  function set(external) {
    write(external);
    syncEmbeds(external);
    hide();
  }

  function init() {
    bar = document.getElementById('consent');

    var saved = read();
    syncEmbeds(!!(saved && saved.external));

    if (bar) {
      Array.prototype.forEach.call(bar.querySelectorAll('[data-consent]'), function (btn) {
        btn.addEventListener('click', function () {
          set(btn.getAttribute('data-consent') === 'all');
        });
      });
      if (!saved) show();
    }

    /* „Süti-beállítások” hivatkozás a láblécben */
    Array.prototype.forEach.call(document.querySelectorAll('[data-consent-open]'), function (el) {
      el.addEventListener('click', function (ev) {
        ev.preventDefault();
        show();
        var first = bar && bar.querySelector('[data-consent]');
        if (first) first.focus();
      });
    });
  }

  window.SalviaConsent = {
    granted: function () { var s = read(); return !!(s && s.external); },
    open: show,
    set: set
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
