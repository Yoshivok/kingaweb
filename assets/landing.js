/* ═══════════════════════════════════════════════════════════════════════════
   MANULA-OPTIC MED. — összekötő oldal vezérlése
   ─────────────────────────────────────────────────────────────────────────
   • a három panel egy vízszintes sávban ül: [masszázs] [választó] [optika]
   • a választás csak elcsúsztatja a sávot — a weboldalak nem töltődnek újra
   • a két iframe a háttérben, még döntés előtt betöltődik
   • a weboldalak forrásához nem nyúlunk: minden vezérlés ebben a keretben van
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var body = document.body;
  var track = document.getElementById('track');
  var chooser = document.querySelector('.chooser');
  var returntab = document.getElementById('returntab');

  var ORDER = { masszazs: 0, chooser: 1, optika: 2 };
  var VIEWS = ['masszazs', 'chooser', 'optika'];
  var SLIDE_MS = 1050;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var current = 'chooser';
  var moveTimer = null;

  /* ── Panelek és iframe-ek ────────────────────────────────────────────── */
  var panels = {};
  VIEWS.forEach(function (v) {
    panels[v] = document.querySelector('.panel[data-panel="' + v + '"]');
  });

  var frames = {
    masszazs: { el: document.getElementById('frame-masszazs'), requested: false, loaded: false },
    optika:   { el: document.getElementById('frame-optika'),   requested: false, loaded: false }
  };

  /* A weboldal betöltésének elindítása. Egyszer fut le panelenként. */
  function requestFrame(key) {
    var f = frames[key];
    if (!f || f.requested) return;
    f.requested = true;
    panels[key].classList.add('is-pending');
    /* Nem `once`: a weboldalon belüli lapváltáskor (pl. impresszum) újra fut,
       és a friss dokumentumra ismét felkerül az Escape-figyelő. */
    f.el.addEventListener('load', function () {
      f.loaded = true;
      panels[key].classList.remove('is-pending');
      bridgeEscape(key);
      /* Friss dokumentum a tetejéről indul (pl. az impresszumra lépve), és
         az sem biztos, hogy jelezni fog — ott a fül legyen elérhető. */
      f.atTop = true;
      applyReturntab();
      bridgeScroll(key);
      /* Friss dokumentum: az „fut-e most” állapotot újra ki kell küldeni,
         különben az előtöltött oldal a képen kívül is animálna. */
      f.motion = undefined;
      tellFrame(key, current === key);
      if (current !== key) panels[key].classList.add('is-parked');
    });
    f.el.src = f.el.getAttribute('data-src');

    /* A `load` csak a képek és betűtípusok megérkezése után jön — addig a friss
       dokumentum már teljes sebességgel animál a képen kívül. Amint a DOM
       elérhető, ráültetjük a jelzést: a weboldalak szkriptje induláskor ebből
       az osztályból olvassa ki a kezdőállapotot. */
    var seed = setInterval(function () {
      var doc;
      try { doc = f.el.contentDocument; } catch (err) { clearInterval(seed); return; }
      if (!doc || !doc.documentElement || doc.URL === 'about:blank') return;
      doc.documentElement.classList.toggle('is-frame-idle', current !== key);
      /* A görgetésfigyelő már a `load` előtt felkerülhet — a hero elem
         ekkorra megvan, és a látogató addigra görgethet is. */
      bridgeScroll(key);
      if (doc.readyState === 'complete') clearInterval(seed);
    }, 50);
    setTimeout(function () { clearInterval(seed); }, 15000);
  }

  /* ── Escape a weboldalakon belül ─────────────────────────────────────────
     A fókusz belépéskor az iframe-be kerül, így a keret már nem látja a
     billentyűt. Azonos eredetű lévén a dokumentumra közvetlenül figyelünk —
     a weboldalak forrásához nem nyúlunk, csak futásidőben csatlakozunk.
     Csak akkor lépünk vissza, ha az oldalnak nincs dolga az Escape-pel. */
  function siteBusy(doc) {
    /* Nyitott menü, natív párbeszédablak vagy modális réteg — szabványos jelek */
    if (doc.querySelector('[aria-expanded="true"], dialog[open], [aria-modal="true"]')) return true;
    var el = doc.activeElement;
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function bridgeEscape(key) {
    var doc;
    try { doc = frames[key].el.contentDocument; } catch (err) { return; }
    if (!doc || doc.__escBridge) return;
    doc.__escBridge = true;
    /* Capture fázis: az oldal saját Escape-kezelője bezárná a menüt, mielőtt
       megnézhetnénk, hogy nyitva volt-e. Itt még az eredeti állapotot látjuk. */
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (current !== key || siteBusy(doc)) return;
      go('chooser');
    }, true);
  }

  /* ── A visszatérő fül csak a hero fölött látszik ─────────────────────────
     A görgetés az iframe-en BELÜL történik, a fül viszont itt, a keretben ül.
     A keret nem olvashatja ki a beágyazott dokumentum görgetését: `file://`
     alól a két oldal eltérő eredetűnek számít (origin "null"), és a
     `contentDocument` elérése SecurityError-t dob. Ezért a weboldalak maguk
     szólnak ki egy `mom:hero` üzenettel — ugyanazon a csatornán, amin a
     `mom:motion` befelé megy. Tartalék az azonos eredetű mérés (http alól),
     ha a weboldal szkriptje valamiért nem futna le. */

  /* Amíg nem tudjuk jobban: látszódjon. Egy hibás jelzés miatt ne vesszen el
     a visszaút a választóhoz. */
  function isAtTop(key) {
    var f = frames[key];
    return !f || f.atTop !== false;
  }

  function applyReturntab() {
    body.classList.toggle(
      'is-frame-scrolled',
      current !== 'chooser' && !isAtTop(current)
    );
  }

  function setFrameAtTop(key, atTop) {
    var f = frames[key];
    if (!f || f.atTop === atTop) return;
    f.atTop = atTop;
    if (current === key) applyReturntab();
  }

  /* A weboldalak jelzése: „a hero fölött vagyok / lejjebb görgettem” */
  window.addEventListener('message', function (ev) {
    var data = ev.data;
    if (!data || data.type !== 'mom:hero') return;
    /* Csak a saját két iframe-ünk szólhat bele — az ablakhivatkozás
       összehasonlítása eltérő eredet mellett is működik. */
    VIEWS.forEach(function (v) {
      var f = frames[v];
      if (f && f.el && ev.source === f.el.contentWindow) {
        setFrameAtTop(v, data.atTop !== false);
      }
    });
  });

  /* ── Tartalék: azonos eredetű mérés (http/https alól) ─────────────────── */
  var HERO_SELECTOR = '#hero-section, .hero, .hero-section';

  function heroThreshold(doc) {
    var hero = doc.querySelector(HERO_SELECTOR);
    var h = hero ? hero.getBoundingClientRect().height : 0;
    /* A gomb már a hero vége előtt tűnjön el, ne a legutolsó képponton */
    if (!h) h = doc.documentElement.clientHeight || 600;
    return Math.max(120, h - 100);
  }

  function syncReturntab(key) {
    var f = frames[key];
    if (!f || !f.el) return;

    var win, doc;
    try {
      win = f.el.contentWindow;
      doc = f.el.contentDocument;
    } catch (err) { return; }   /* eltérő eredet: a weboldal üzenete dönt */
    if (!win || !doc || !doc.documentElement) return;

    var y = win.pageYOffset || doc.documentElement.scrollTop || 0;
    setFrameAtTop(key, y <= heroThreshold(doc));
  }

  /* Nem `once`: a weboldalon belüli lapváltáskor (impresszum, ÁSZF) új
     dokumentum jön, és a `load` újra lefut. */
  function bridgeScroll(key) {
    var win, doc;
    try {
      win = frames[key].el.contentWindow;
      doc = frames[key].el.contentDocument;
    } catch (err) { return; }
    if (!win || !doc || doc.__scrollBridge) return;
    doc.__scrollBridge = true;

    var ticking = false;
    win.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        syncReturntab(key);
      });
    }, { passive: true });

    syncReturntab(key);
  }

  /* ── Panelek elérhetősége: ami nincs képen, az a fókuszból is kiesik ─── */
  function setActivePanel(view) {
    VIEWS.forEach(function (v) {
      var panel = panels[v];
      if (!panel) return;
      var active = (v === view);
      if (active) {
        panel.removeAttribute('inert');
        panel.removeAttribute('aria-hidden');
      } else {
        panel.setAttribute('inert', '');
        panel.setAttribute('aria-hidden', 'true');
      }
      if (frames[v]) {
        if (active) frames[v].el.removeAttribute('tabindex');
        else frames[v].el.setAttribute('tabindex', '-1');
      }
    });
  }

  /* ── Parkolás: a képen kívüli panelt ne rajzolja a böngésző ──────────── */
  /* A `visibility: hidden` csak ITT, a keretben állítja meg a rajzolást. Az
     iframe-en belüli dokumentum ettől még „látható”: a `document.hidden`
     hamis marad, az IntersectionObserverei pedig az iframe saját nézetmezejét
     figyelik — így a képen kívüli weboldal hero-animációi (canvas-hurok,
     fényfoltok, forgó gyűrűk) végig futnának. Két sötét, egész képernyős hero
     egyszerre annyi réteget tart a GPU-n, hogy a kompozitor időnként eldobja
     és újraépíti a rajzfelületet: ez a hero-n fekete villanásként látszik.
     Ezért külön szólunk a weboldalaknak, hogy álljanak le. */
  function tellFrame(key, active) {
    var f = frames[key];
    if (!f || !f.el || f.motion === active) return;
    f.motion = active;

    var win = f.el.contentWindow;
    if (win) {
      /* A tartalom nem érzékeny (csak be/ki jelzés), a fogadó oldal pedig a
         küldő ablakot ellenőrzi — így `file://` alól is működik. */
      try { win.postMessage({ type: 'mom:motion', active: active }, '*'); } catch (err) { /* még nem tölthető */ }
    }
    /* Azonos eredetű: a CSS-kapcsolót közvetlenül is felrakjuk, hogy a jelzés
       akkor is megérkezzen, ha a weboldal szkriptje még nem futott le. */
    try {
      var doc = f.el.contentDocument;
      if (doc && doc.documentElement) {
        doc.documentElement.classList.toggle('is-frame-idle', !active);
      }
    } catch (err) { /* eltérő eredet: marad a postMessage */ }
  }

  function unpark(view) {
    if (panels[view]) panels[view].classList.remove('is-parked');
    tellFrame(view, true);
  }
  function parkOthers(view) {
    VIEWS.forEach(function (v) {
      if (v !== view && panels[v]) panels[v].classList.add('is-parked');
      if (v !== view) tellFrame(v, false);
    });
  }

  /* ── Címsor és előzmények ────────────────────────────────────────────── */
  var TITLES = {
    chooser:  'Manula-Optic Med. — Masszázsterápia és Optika',
    masszazs: 'Salvia Gyógymasszázs — Manula-Optic Med.',
    optika:   'Lumina Optika — Manula-Optic Med.'
  };

  function syncHistory(view, replace) {
    var url = view === 'chooser'
      ? location.pathname + location.search
      : location.pathname + location.search + '#' + view;
    var state = { view: view };
    if (replace) history.replaceState(state, '', url);
    else history.pushState(state, '', url);
    document.title = TITLES[view];
  }

  /* ── A váltás ────────────────────────────────────────────────────────── */
  function go(view, opts) {
    opts = opts || {};
    if (!ORDER.hasOwnProperty(view) || view === current) return;

    requestFrame(view);            /* ha eddig nem kértük, most sürgős */

    /* A fénysöprés a tartalommal együtt mozog: az optika felé haladva
       (a kamera jobbra megy) a kép balra úszik ki. */
    body.dataset.dir = ORDER[view] > ORDER[current] ? 'left' : 'right';

    current = view;
    body.dataset.view = view;
    delete body.dataset.hover;

    /* Az érkező panel azonnal kirajzolható kell legyen, még a csúszás előtt */
    unpark(view);

    body.classList.toggle('is-leaving', view !== 'chooser');
    setActivePanel(view);

    returntab.hidden = (view === 'chooser');

    /* Váltáskor az érkező weboldal saját görgetési állapota dönt: ha valaki
       lejjebb hagyta, oda visszatérve se villanjon fel a fül. */
    syncReturntab(view);
    applyReturntab();

    if (!opts.silent) syncHistory(view, !!opts.replace);

    if (reduced || opts.instant) {
      afterMove(view);
      return;
    }

    body.classList.add('is-moving');
    clearTimeout(moveTimer);
    moveTimer = setTimeout(function () { afterMove(view); }, SLIDE_MS);
  }

  function afterMove(view) {
    body.classList.remove('is-moving');
    delete body.dataset.dir;
    parkOthers(view);
    /* A fókusz az érkező panelre kerül: az iframe-en belül így működik a
       billentyűs görgetés, a választón pedig a nyilak és az Escape. */
    if (view !== 'chooser' && frames[view]) {
      frames[view].el.focus({ preventScroll: true });
    } else {
      panels.chooser.setAttribute('tabindex', '-1');
      panels.chooser.focus({ preventScroll: true });
    }
    /* A részecskehurok csak a választón fut — a weboldalak alatt megáll. */
    pumpParticles();
  }

  /* Animáció nélküli ugrás — mélylinkre érkezéskor */
  function jump(view) {
    body.classList.add('no-anim');
    go(view, { instant: true, replace: true });
    /* két képkocka után engedjük vissza az animációt */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { body.classList.remove('no-anim'); });
    });
  }

  /* ── Kattintás a két félen ───────────────────────────────────────────── */
  Array.prototype.forEach.call(document.querySelectorAll('.half'), function (half) {
    var target = half.getAttribute('data-target');

    half.addEventListener('click', function (e) {
      /* Középső gomb / módosítóbillentyű: hagyjuk új lapon megnyílni */
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      go(target);
    });

    /* Előzetes betöltés, amint a látogató a fél fölé ér */
    ['pointerenter', 'focus'].forEach(function (evt) {
      half.addEventListener(evt, function () {
        requestFrame(target);
        if (current === 'chooser') body.dataset.hover = target;
      });
    });
    ['pointerleave', 'blur'].forEach(function (evt) {
      half.addEventListener(evt, function () { delete body.dataset.hover; });
    });
  });

  /* ── Visszatérés a választóhoz ───────────────────────────────────────── */
  returntab.addEventListener('click', function () { go('chooser'); });

  /* ── Billentyűzet ────────────────────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'Escape' && current !== 'chooser') {
      go('chooser');
      return;
    }
    /* Nyilakkal csak a választóból lépünk tovább, hogy a weboldalakon
       belüli görgetést és űrlapokat ne zavarjuk. */
    if (current !== 'chooser') return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); go('masszazs'); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go('optika'); }
  });

  /* ── Átméretezés: a hero magassága (és vele a küszöb) változhat ──────── */
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (current !== 'chooser') syncReturntab(current);
    }, 150);
  }, { passive: true });

  /* ── Böngésző előre/vissza ───────────────────────────────────────────── */
  window.addEventListener('popstate', function (e) {
    var view = (e.state && e.state.view) || viewFromHash();
    go(view, { silent: true });
  });

  function viewFromHash() {
    var h = (location.hash || '').replace('#', '');
    return ORDER.hasOwnProperty(h) && h !== 'chooser' ? h : 'chooser';
  }

  /* ── Egérkövető parallax ─────────────────────────────────────────────── */
  if (!reduced && window.matchMedia('(hover: hover)').matches) {
    var parX = 0, parY = 0, parRaf = null;

    chooser.addEventListener('pointermove', function (e) {
      parX = (e.clientX / window.innerWidth) - 0.5;
      parY = (e.clientY / window.innerHeight) - 0.5;
      if (parRaf) return;
      parRaf = requestAnimationFrame(function () {
        parRaf = null;
        chooser.style.setProperty('--px', parX.toFixed(4));
        chooser.style.setProperty('--py', parY.toFixed(4));
      });
    });

    chooser.addEventListener('pointerleave', function () {
      chooser.style.setProperty('--px', 0);
      chooser.style.setProperty('--py', 0);
    });
  }

  /* ── Részecskeréteg ──────────────────────────────────────────────────── */
  var pump = { raf: null, run: false };

  function initParticles() {
    if (reduced) return;

    var canvas = document.getElementById('particles');
    var ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    var W = 0, H = 0, dpr = 1, parts = [];
    var mouse = { x: -999, y: -999 };

    /* Előre kirajzolt lágy fényfolt — képkockánként olcsóbb, mint a gradiens */
    function sprite(rgb) {
      var s = 64, c = document.createElement('canvas');
      c.width = c.height = s;
      var g = c.getContext('2d');
      var grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0,    'rgba(' + rgb + ',0.95)');
      grd.addColorStop(0.28, 'rgba(' + rgb + ',0.45)');
      grd.addColorStop(1,    'rgba(' + rgb + ',0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
      return c;
    }

    var SPR = {
      sage:  sprite('214,123,75'),
      terra: sprite('214,123,75'),
      gold:  sprite('226,205,162')
    };

    function make(side) {
      var stacked = window.innerWidth <= 900;   /* mobilon egymás alatt állnak */
      var x, y;
      if (stacked) {
        x = Math.random() * W;
        y = side === 0 ? Math.random() * H * 0.5 : H * 0.5 + Math.random() * H * 0.5;
      } else {
        x = side === 0 ? Math.random() * W * 0.5 : W * 0.5 + Math.random() * W * 0.5;
        y = Math.random() * H;
      }
      var gold = Math.random() < 0.3;
      return {
        side: side, x: x, y: y,
        /* bal: lassan emelkedő pára — jobb: lebegő fényszemcsék */
        r: side === 0 ? 0.9 + Math.random() * 2.0 : 0.7 + Math.random() * 2.9,
        vx: (Math.random() - 0.5) * 0.16,
        vy: side === 0 ? -(0.10 + Math.random() * 0.26) : -(0.03 + Math.random() * 0.13),
        a:  0.16 + Math.random() * 0.42,
        tw: Math.random() * Math.PI * 2,
        tws: side === 0 ? 0.006 + Math.random() * 0.012 : 0.012 + Math.random() * 0.03,
        img: gold ? SPR.gold : (side === 0 ? SPR.sage : SPR.terra)
      };
    }

    var quality = 1;

    function seed() {
      var count = Math.round(Math.min(90, Math.max(26, (W * H) / 21000)) * quality);
      parts = [];
      for (var i = 0; i < count; i++) parts.push(make(i % 2));
    }

    setParticleQuality = function (q) {
      quality = q;
      if (q === 0) { pump.run = false; canvas.style.display = 'none'; return; }
      seed();
    };

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width  = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    var lastDraw = 0;
    var STEP = 2;          /* fele annyi képkocka, kétszeres lépés → azonos sebesség */

    /* A logó szemformáját visszhangzó, lassan forgó lencsemotívum. Azért a
       vásznon van, mert itt már úgyis történik rajzolás minden képkockán;
       külön DOM-rétegként két áttetsző felületet kellett volna képkockánként
       újrakeverni — mérve ez volt a legdrágább maradék elem. */
    function drawLens(ts) {
      var size = Math.min(W * 0.40, 460);
      var cx = W - W * 0.04 - size / 2;
      var cy = H / 2;
      var r = size / 2;

      ctx.strokeStyle = 'rgba(226, 205, 162, 0.17)';
      ctx.lineWidth = 1.6;

      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.47, (ts / 52000) * Math.PI * 2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.47, r, -(ts / 78000) * Math.PI * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* A két felet elválasztó pászmán lefutó fénycsík — ugyanezért a vásznon:
       DOM-elemként egy vékony, de a teljes képernyőt bejáró réteget kellett
       képkockánként újrakeverni. */
    function drawScan(ts) {
      var t = (ts % 7000) / 7000;
      var fade = Math.min(1, Math.min(t, 1 - t) * 7);
      if (fade <= 0.01) return;

      var stacked = window.innerWidth <= 900;
      var g;
      ctx.globalAlpha = 0.75 * fade;

      if (stacked) {
        var lenX = W * 0.22;
        var x = -lenX + t * (W + lenX * 2);
        g = ctx.createLinearGradient(x, 0, x + lenX, 0);
        g.addColorStop(0, 'rgba(253, 246, 240, 0)');
        g.addColorStop(0.5, 'rgba(253, 246, 240, 0.85)');
        g.addColorStop(1, 'rgba(253, 246, 240, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, H / 2 - 6, lenX, 12);
      } else {
        var lenY = H * 0.22;
        var y = -lenY + t * (H + lenY * 2);
        g = ctx.createLinearGradient(0, y, 0, y + lenY);
        g.addColorStop(0, 'rgba(253, 246, 240, 0)');
        g.addColorStop(0.5, 'rgba(253, 246, 240, 0.85)');
        g.addColorStop(1, 'rgba(253, 246, 240, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(W / 2 - 6, y, 12, lenY);
      }
      ctx.globalAlpha = 1;
    }

    function frame(ts) {
      if (!pump.run) { pump.raf = null; return; }
      pump.raf = requestAnimationFrame(frame);
      if (ts - lastDraw < 31) return;
      lastDraw = ts;

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      drawLens(ts);
      drawScan(ts);

      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];

        p.x += p.vx * STEP;
        p.y += p.vy * STEP;
        p.tw += p.tws * STEP;

        /* Az egér finoman eltolja a közeli szemcséket */
        var dx = p.x - mouse.x, dy = p.y - mouse.y;
        var d2 = dx * dx + dy * dy;
        if (d2 < 20000 && d2 > 1) {
          var f = (1 - d2 / 20000) * 0.55;
          var d = Math.sqrt(d2);
          p.x += (dx / d) * f;
          p.y += (dy / d) * f;
        }

        /* Körbeér a képernyőn */
        if (p.y < -30) { p.y = H + 20; p.x = reseedX(p.side); }
        if (p.x < -30) p.x = W + 20;
        if (p.x > W + 30) p.x = -20;

        var alpha = p.a * (0.55 + 0.45 * Math.sin(p.tw));
        var size = p.r * 9;
        ctx.globalAlpha = alpha;
        ctx.drawImage(p.img, p.x - size / 2, p.y - size / 2, size, size);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    function reseedX(side) {
      if (window.innerWidth <= 900) return Math.random() * W;
      return side === 0 ? Math.random() * W * 0.5 : W * 0.5 + Math.random() * W * 0.5;
    }

    canvas.parentElement.addEventListener('pointermove', function (e) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    });
    canvas.parentElement.addEventListener('pointerleave', function () {
      mouse.x = mouse.y = -999;
    });

    var rTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(rTimer);
      rTimer = setTimeout(resize, 180);
    });

    resize();
    document.body.classList.add('canvas-lens');

    pumpParticles = function () {
      var want = (current === 'chooser') && document.visibilityState === 'visible';
      if (want && !pump.raf) { pump.run = true; pump.raf = requestAnimationFrame(frame); }
      if (!want) { pump.run = false; }
    };
    pumpParticles();
  }

  /* Alapértelmezésben nem csinálnak semmit; az initParticles cseréli le őket. */
  var pumpParticles = function () {};
  var setParticleQuality = function () {};

  /* ── Önszabályozás gyengébb gépre ────────────────────────────────────────
     A fenti optimalizálás után a választó 60 kép/mp-et ad, de nem tudhatjuk,
     milyen gépen és mekkora képernyőn fut. Belépés után megmérjük a valódi
     képkockaidőt, és ha a gép nem bírja, lépcsőzetesen visszaveszünk.
     A mediánt nézzük, hogy egy-egy akadás ne rontsa el a döntést. */
  function watchPerformance() {
    if (reduced) return;

    var samples = [], last = 0, started = 0;

    function tick(ts) {
      if (current !== 'chooser') return;         /* csak a választón mérünk */
      if (!started) { started = ts; last = ts; requestAnimationFrame(tick); return; }
      samples.push(ts - last);
      last = ts;
      if (ts - started < 2200) { requestAnimationFrame(tick); return; }

      samples.sort(function (a, b) { return a - b; });
      var median = samples[Math.floor(samples.length / 2)] || 16;

      if (median > 40) {            /* 25 kép/mp alatt: minden mozgó réteg le */
        body.classList.add('is-lowfx');
        setParticleQuality(0);
      } else if (median > 26) {     /* 38 kép/mp alatt: feleannyi szemcse */
        setParticleQuality(0.5);
      }
    }

    requestAnimationFrame(tick);
  }

  document.addEventListener('visibilitychange', function () { pumpParticles(); });

  /* ── Megéri-e előre letölteni MINDKÉT weboldalt? ──────────────────────────
     Csak akkor, ha a kapcsolat és a gép elbírja. A jelzések nem mindenhol
     állnak rendelkezésre (Safari, Firefox) — ha nincs adat, előtöltünk, mert
     az a jobb élmény a gépek túlnyomó részén. */
  function preloadWorthwhile() {
    var net = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (net) {
      if (net.saveData) return false;                       /* „adattakarékos” mód */
      var type = net.effectiveType || '';
      if (type === 'slow-2g' || type === '2g' || type === '3g') return false;
    }
    /* 4 GB alatti (bevallott) memória: két teljes weboldal egyszerre már sok */
    if (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory < 4) return false;
    return true;
  }

  /* ── Indulás ─────────────────────────────────────────────────────────── */
  function boot() {
    var start = viewFromHash();

    setActivePanel(start === 'chooser' ? 'chooser' : start);
    syncHistory(start, true);

    /* A belépő animáció elindítása a következő képkockán */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        body.classList.remove('is-booting');
      });
    });

    initParticles();

    if (start !== 'chooser') {
      requestFrame(start);
      jump(start);
    }

    /* A másik oldalt is előtöltjük, hogy a váltás azonnali legyen.
       Csak a belépő animáció után, hogy ne lassítsa.

       KIVÉTEL: takarékos vagy lassú kapcsolaton, illetve kevés memóriájú
       gépen nem toljuk le mindkét weboldalt előre. Két teljes dokumentum
       egyszerre — saját betűtípusokkal, vászonanimációval és a szemanatómia
       szoftveres 3D-motorjával — épp azon a gépen fogyasztja el a maradék
       erőforrást, amelyik amúgy sem bírja: ott a választó akadozni kezd, a
       kompozitor pedig rajzfelületet dobál (fekete villanás). A váltás
       ilyenkor sem törik el, csak nem azonnali: a `go()` úgyis kikéri az
       adott oldalt, addig a saját háttérszínén töltésjelző fut. */
    if (preloadWorthwhile()) {
      var idle = window.requestIdleCallback || function (cb) { return setTimeout(cb, 1); };
      setTimeout(function () {
        idle(function () { requestFrame('masszazs'); }, { timeout: 2500 });
        setTimeout(function () {
          idle(function () { requestFrame('optika'); }, { timeout: 2500 });
        }, 700);
      }, start === 'chooser' ? 1500 : 400);
    }

    /* A belépő animáció lefutott: innentől a rövidebb, mozgékonyabb
       átmenetek élnek (parallax, hover). */
    setTimeout(function () { body.classList.add('is-live'); }, reduced ? 0 : 2400);

    /* Az iframe-ek betöltése után mérünk, hogy az ne torzítsa az eredményt */
    setTimeout(watchPerformance, 3800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
