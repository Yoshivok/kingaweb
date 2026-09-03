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
  var wakeTimer = null;
  /* Hamis, amíg egy induló váltás érkező panelje az ébresztésére vár. */
  var woken = true;
  /* Igaz a sáv csúszása alatt. A váltás a lap legdrágább pillanata: egyszerre
     mozog a sáv, nagyít a választó, és rajzol a két teljes weboldal. Amit
     ilyenkor meg lehet állítani, azt megállítjuk. */
  var sliding = false;
  /* Igaz a belépő animáció alatt. Ugyanaz a gondolat, mint a `sliding`-nál:
     a lap első két másodperce a legdrágább — akkor fut a belépő animáció,
     akkor érkeznek a betűtípusok, és akkor mérünk. A háttér szemcséi
     ilyenkor nem hiányoznak senkinek. */
  var entering = true;

  /* ── TELJESÍTMÉNYSZINT ────────────────────────────────────────────────────
     Három szint: 'high' | 'mid' | 'low'. A stíluslap alapból a TAKARÉKOS
     változatot adja; a `fx-high` osztály kapcsolja rá a rajzolással járó
     díszeket (lüktető pontok, megrajzolódó vonalak, fényudvarok, üveghatás),
     az `is-lowfx` pedig megállít minden mozgást és leveszi a vásznat.

     A szintet MÉG AZ ELSŐ KIRAJZOLÁS ELŐTT eldöntjük a gép bevallott
     adottságaiból. A korábbi megoldás csak 3,8 mp után kezdett mérni — addigra
     a belépő animáció, vagyis épp a leglátványosabb rész, már le is futott
     akadozva. Így a gyenge gép egyetlen képkockán sem fizeti meg a drága
     rétegeket.

     A mérés ezután már csak LEFELÉ módosíthat. Felfelé lépni futás közben
     zavaró lenne: a díszek a semmiből ugranának be.

     Teszteléshez az URL-ből felülbírálható:
       ?fx=high | ?fx=mid | ?fx=low   — kényszerített szint
       ?fx=debug                      — képkocka-számláló a sarokban          */
  var tier = 'mid';

  function hardwareTier() {
    var cores = navigator.hardwareConcurrency || 0;
    /* Csak Chromiumban van; gigabájt, 8-nál felfelé levágva */
    var mem = navigator.deviceMemory || 0;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var pixels = (window.innerWidth * dpr) * (window.innerHeight * dpr);

    /* Két szál vagy 2 GB alatt: már a takarékos szint is sok volna */
    if ((cores && cores <= 2) || (mem && mem <= 2)) return 'low';

    /* Négy szál / 4 GB — a tipikus „gyengébb gép”: irodai laptop, Chromebook,
       középkategóriás telefon. Pont az a kör, ahol a lap akadozott. */
    if ((cores && cores <= 4) || (mem && mem <= 4)) return 'mid';

    /* Sok képpont kevés maggal: 4K-s kijelző középkategóriás gépen. A díszek
       költsége a képernyő méretével nő, a gépé nem. */
    if (pixels > 5000000 && cores < 8) return 'mid';

    /* Ha semmit nem tudunk a gépről (régebbi Safari), a takarékos az alap */
    if (!cores && !mem) return 'mid';

    return 'high';
  }

  /* A gép nyers képessége. A csökkentett mozgás ettől FÜGGETLEN: az egy
     ízlésbeli kérés, nem gyengeségi jelzés — egy erős gépen is bekapcsolható.
     Ezért az előtöltés döntése ezt nézi, a látvány szintje pedig `tier`-t. */
  var hwTier = hardwareTier();

  function syncTier() {
    body.classList.toggle('fx-high', tier === 'high');
    body.classList.toggle('is-lowfx', tier === 'low');
  }

  /* Csak lefelé lép. A visszatérési érték jelzi, változott-e a szint. */
  function downgrade(to) {
    var RANK = { high: 2, mid: 1, low: 0 };
    if (RANK[to] >= RANK[tier]) return false;
    tier = to;
    syncTier();
    retuneParticles();
    return true;
  }

  var forcedTier = /[?&]fx=(high|mid|low)(?:&|$)/.exec(location.search);
  tier = forcedTier ? forcedTier[1] : (reduced ? 'low' : hwTier);
  syncTier();

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
      /* Ha a látogató a betöltés előtt kattintott, a dokumentum épp a csúszás
         alatt készül el. A csúszás CSENDES első felében ilyenkor sem indulhat —
         a félidős ébresztés (vagy az `afterMove`) majd szól neki. */
      tellFrame(key, current === key && woken);
      if (current !== key) panels[key].classList.add('is-parked');
    });
    f.el.src = f.el.getAttribute('data-src');

    /* A `load` csak a képek és betűtípusok megérkezése után jön — addig a friss
       dokumentum már teljes sebességgel animál a képen kívül. Amint a DOM
       elérhető, ráültetjük a jelzést: a weboldalak szkriptje induláskor ebből
       az osztályból olvassa ki a kezdőállapotot.

       A ritmus szándékosan lassú: két iframe-re 50 ms-onként az másodpercenként
       negyven ébresztés a fő szálon, épp a betöltés alatt, amikor a választó
       belépő animációja fut. A jelzés attól még időben megérkezik: a `document`
       elem a legelső képkockán megvan, a `readyState === 'interactive'` pedig
       már azt jelenti, hogy a weboldal saját szkriptje elindult — onnantól ő
       maga kezeli az állapotot, nincs mit figyelni. */
    var seed = setInterval(function () {
      var doc;
      try { doc = f.el.contentDocument; } catch (err) { clearInterval(seed); return; }
      if (!doc || !doc.documentElement || doc.URL === 'about:blank') return;
      doc.documentElement.classList.toggle('is-frame-idle', current !== key);
      /* A görgetésfigyelő már a `load` előtt felkerülhet — a hero elem
         ekkorra megvan, és a látogató addigra görgethet is. */
      bridgeScroll(key);
      if (doc.readyState !== 'loading') clearInterval(seed);
    }, 120);
    setTimeout(function () { clearInterval(seed); }, 8000);
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

  /* Láthatóvá teszi a panelt — de a MOZGÁSÁT szándékosan NEM indítja el.
     Az érkező weboldal hero-ja ugyanúgy elvenné a fő szálat a csúszás alatt,
     mint a távozóé: eddig épp a legrosszabbkor, a becsúszás első képkockáin
     kezdett teljes sebességgel animálni, miközben a böngészőnek amúgy is ki
     kellett rajzolnia az egész beérkező dokumentumot. A mozgás az
     csúszás MÁSODIK FELÉBEN indul (lásd `go`), amikor a panel java már a képen
     van — a hero belépője így ott fut le, ahol tényleg látszik. */
  function unpark(view) {
    if (panels[view]) panels[view].classList.remove('is-parked');
  }
  /* Csak a MOZGÁST állítja meg a többi panelen — a láthatóságukhoz nem nyúl.
     A `parkOthers` (ami el is rejti őket) csak a csúszás végén futhat, mert a
     távozó panelnek látszania kell, amíg kicsúszik. A benne futó animációnak
     viszont nem: egy kicsúszó, ezredmásodpercek alatt eltűnő hero-ról senki
     nem veszi észre, hogy közben kimerevedett — a felszabaduló fő szál és
     GPU viszont épp a csúszásnak kell. */
  function quietOthers(view) {
    VIEWS.forEach(function (v) {
      if (v !== view) tellFrame(v, false);
    });
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

    /* Gyors egymásutánban indított váltásnál a korábbi ébresztés már nem
       arra a panelre vonatkozik, amelyik érkezik. */
    clearTimeout(wakeTimer);
    woken = false;

    requestFrame(view);            /* ha eddig nem kértük, most sürgős */

    /* A fénysöprés a tartalommal együtt mozog: az optika felé haladva
       (a kamera jobbra megy) a kép balra úszik ki. */
    body.dataset.dir = ORDER[view] > ORDER[current] ? 'left' : 'right';

    current = view;
    body.dataset.view = view;
    delete body.dataset.hover;

    /* Az érkező panel azonnal kirajzolható kell legyen, még a csúszás előtt */
    unpark(view);

    /* …a többi viszont ITT hallgat el, nem a csúszás végén. Korábban a
       `parkOthers` volt az egyetlen hely, ahol a weboldalak leállítást kaptak,
       az pedig csak `afterMove`-ban fut: a távozó oldal hero-ja a teljes 1050 ms
       alatt végig teljes sebességgel animált, miközben a sáv csúszott és a
       választó nagyított. Épp ott adódott össze minden költség, ahol a
       legsimábbnak kellene lennie. */
    sliding = true;
    quietOthers(view);
    pumpParticles();

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

    /* Az érkező oldal a csúszás felénél ébred. A két véglet közül egyik sem jó:
       a csúszás ELEJÉN indítva (ez volt eddig) a hero teljes sebességgel
       animál, miközben a böngésző még csak most rajzolja ki az egész
       dokumentumot és közben a sáv is csúszik — ez volt a váltás akadásának a
       fő oka. A csúszás VÉGÉRE halasztva viszont a hero szövege üresen
       érkezne be: `hero-in … both`-tal indul, vagyis `opacity: 0`-ról.
       Félidőben a panel java már a képen van, a drága első fél mégis csendes. */
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(function () {
      woken = true;
      tellFrame(view, true);
    }, Math.round(SLIDE_MS * 0.5));
  }

  function afterMove(view) {
    sliding = false;
    body.classList.remove('is-moving');
    delete body.dataset.dir;
    parkOthers(view);
    /* Biztosíték: ha a félidős ébresztés valamiért elmaradt, itt mindenképp
       megtörténik. Ha már megvolt, a `tellFrame` felismeri és nem csinál semmit. */
    clearTimeout(wakeTimer);
    woken = true;
    tellFrame(view, true);
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

    /* A parallaxot HÁROM elem használja: a két dísz és a medál. Korábban a
       `--px/--py` a közös `.chooser`-en változott — csakhogy egy egyéni tulajdonság
       megváltoztatása a teljes részfa stílusát újraszámoltatja, itt 59 elemét
       (köztük a két dísz-SVG összes útvonalát), MINDEN egérmozdulatnál. A három
       tényleges fogyasztóra kötve ez háromra csökken. */
    var parLayers = [
      document.querySelector('.orn--left'),
      document.querySelector('.orn--right'),
      document.querySelector('.medallion')
    ].filter(function (el) { return !!el; });

    function setPar(x, y) {
      for (var i = 0; i < parLayers.length; i++) {
        parLayers[i].style.setProperty('--px', x);
        parLayers[i].style.setProperty('--py', y);
      }
    }

    chooser.addEventListener('pointermove', function (e) {
      parX = (e.clientX / window.innerWidth) - 0.5;
      parY = (e.clientY / window.innerHeight) - 0.5;
      if (parRaf) return;
      parRaf = requestAnimationFrame(function () {
        parRaf = null;
        setPar(parX.toFixed(4), parY.toFixed(4));
      });
    });

    chooser.addEventListener('pointerleave', function () { setPar(0, 0); });
  }

  /* ── Részecskeréteg ──────────────────────────────────────────────────── */
  var pump = { raf: null, run: false };

  function initParticles() {
    if (reduced || tier === 'low') return;

    var canvas = document.getElementById('particles');
    var ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    var W = 0, H = 0, dpr = 1, parts = [];
    var stacked = false;              /* mobilon a két fél egymás alatt áll */
    var mouse = { x: -999, y: -999 };

    /* Szintenkénti profil.
       `dprMax`  — a rajzolási felbontás felső határa
       `cap`     — a vászon rajzfelületének felső határa KÉPPONTBAN
       `area`    — hány képpontonként essen egy szemcse
       `min/max` — a szemcseszám alsó és felső korlátja                        */
    var PROFILE = {
      high: { dprMax: 1.25, cap: 1500000, area: 22000, min: 24, max: 80 },
      mid:  { dprMax: 1.0,  cap:  850000, area: 36000, min: 16, max: 46 }
    };

    function prof() { return PROFILE[tier] || PROFILE.mid; }

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

    function seed() {
      var p = prof();
      var count = Math.round(Math.min(p.max, Math.max(p.min, (W * H) / p.area)));
      parts = [];
      for (var i = 0; i < count; i++) parts.push(make(i % 2));
    }

    /* A szint megváltozásakor a keret ezt hívja: új felbontás, új szemcseszám,
       vagy — a padlón — a vászon teljes leállítása. */
    retuneParticles = function () {
      if (tier === 'low') {
        pump.run = false;
        canvas.style.display = 'none';
        return;
      }
      canvas.style.display = '';
      resize();
      pumpParticles();
    };

    function resize() {
      var p = prof();
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      stacked = window.innerWidth <= 900;

      /* A RAJZOLÁSI felbontás felső korlátja.
         A szemcsék lágy fényfoltok — nem nyerünk semmit azzal, ha képpontra
         pontosan rajzoljuk őket, a költség viszont egyenesen a rajzfelület
         képpontszámával nő: törölni, rárajzolni és a lapra keverni minden
         képkockán az EGÉSZ vásznat kell. A korábbi `min(dpr, 1.5)` egy
         1920×1080-as kijelzőn 4,6 millió, 4K-n több mint 18 millió képpontot
         jelentett képkockánként — integrált GPU-n ez volt a vászon fő
         költsége, nem a szemcsék száma.

         Innentől a rajzfelület felülről kötött: kisebb felbontáson készül, és
         a böngésző nagyítja a kijelzőre. Lágy foltokon ez nem látszik. */
      var want = Math.min(window.devicePixelRatio || 1, p.dprMax);
      var px = W * H * want * want;
      if (px > p.cap) want = Math.max(0.55, want * Math.sqrt(p.cap / px));
      dpr = want;

      canvas.width  = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scanSpr = null;
      seed();

      /* A méretváltás kiüríti a vásznat. Amíg a mozgás nem fut (a belépő
         animáció alatt, vagy másik panelen állva), nincs ki újrarajzolja —
         egy álló képkocka visszateszi a kompozíciót. */
      if (!pump.run) paint(performance.now ? performance.now() : Date.now());
    }

    var lastDraw = 0;
    /* A szemcsék lassan sodródnak — 25 kép/mp bőven elég hozzá, és negyedével
       kevesebb teljes vászontörlést és -újrarajzolást jelent, mint a korábbi
       32. A lépés ezzel arányosan nő, így a SEBESSÉG nem változik. */
    var FRAME_MS = 40;
    var STEP = FRAME_MS / 15.5;   /* a korábbi 31 ms ↔ 2 lépés arány megtartva */

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
       képkockánként újrakeverni.

       A csík maga is előre kirajzolva ül egy apró vásznon. Korábban minden
       képkockán új `createLinearGradient` objektum készült, és azzal töltöttük
       ki a téglalapot: a színátmenet felállítása (a színek kiszámolása,
       a rajzoló felkészítése) így képkockánként újrakezdődött, holott a csík
       mindvégig ugyanaz — csak a helye változik. Egyszer megrajzoljuk,
       utána már csak eltoljuk. */
    var scanSpr = null;

    function buildScan() {
      var c = document.createElement('canvas');
      var g2 = c.getContext('2d');
      var g;

      if (stacked) {
        c.width = Math.max(2, Math.round(W * 0.22));
        c.height = 12;
        g = g2.createLinearGradient(0, 0, c.width, 0);
      } else {
        c.width = 12;
        c.height = Math.max(2, Math.round(H * 0.22));
        g = g2.createLinearGradient(0, 0, 0, c.height);
      }

      g.addColorStop(0, 'rgba(253, 246, 240, 0)');
      g.addColorStop(0.5, 'rgba(253, 246, 240, 0.85)');
      g.addColorStop(1, 'rgba(253, 246, 240, 0)');
      g2.fillStyle = g;
      g2.fillRect(0, 0, c.width, c.height);
      return c;
    }

    function drawScan(ts) {
      var t = (ts % 7000) / 7000;
      var fade = Math.min(1, Math.min(t, 1 - t) * 7);
      if (fade <= 0.01) return;
      if (!scanSpr) scanSpr = buildScan();

      ctx.globalAlpha = 0.75 * fade;
      if (stacked) {
        var lenX = scanSpr.width;
        ctx.drawImage(scanSpr, -lenX + t * (W + lenX * 2), H / 2 - 6);
      } else {
        var lenY = scanSpr.height;
        ctx.drawImage(scanSpr, W / 2 - 6, -lenY + t * (H + lenY * 2));
      }
      ctx.globalAlpha = 1;
    }

    /* A RAJZOLÁS maga, a hurkolástól függetlenül. Azért külön, mert induláskor
       egyetlen álló képkockát is kérünk belőle: a vászon nem csak szemcséket
       rajzol, hanem a lencsemotívumot és a fénycsíkot is — vagyis a kompozíció
       része. Ha a hurokkal együtt késleltetnénk, ezek egyszerűen hiányoznának
       a lap első másodperceiből. Így a kép az első képkockától teljes, csak
       még nem mozog. */
    function paint(ts) {
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

    function frame(ts) {
      if (!pump.run) { pump.raf = null; return; }
      pump.raf = requestAnimationFrame(frame);
      if (ts - lastDraw < FRAME_MS) return;
      lastDraw = ts;
      paint(ts);
    }

    function reseedX(side) {
      if (stacked) return Math.random() * W;
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

    /* A `resize` egyben ki is rajzolja az első, álló képkockát: a lencsemotívum
       és a fénycsík ettől a pillanattól a helyén van, hiába indul a mozgás
       csak a belépő animáció után. */
    resize();
    document.body.classList.add('canvas-lens');

    pumpParticles = function () {
      /* Csúszás közben nem rajzolunk: a vászon képkockánkénti munkája épp a
         sáv transzformációjától venné el a fő szálat. Egy másodpercre megálló
         szemcsemozgás egy csúszó képernyőn észrevehetetlen. */
      var want = (current === 'chooser') && document.visibilityState === 'visible'
        && !sliding && !entering;
      if (want && !pump.raf) {
        pump.run = true;
        pump.raf = requestAnimationFrame(frame);
      }
      if (!want) { pump.run = false; }
    };
    pumpParticles();
  }

  /* Alapértelmezésben nem csinálnak semmit; az initParticles cseréli le őket. */
  var pumpParticles = function () {};
  var retuneParticles = function () {};

  /* ── Önszabályozás: a mért képkockaidő ───────────────────────────────────
     A gép adottságai alapján felvett szint jó becslés, de nem több annál: egy
     bevallottan erős gép is akadozhat, ha épp másik fül dolgozik rajta, ha a
     böngésző szoftveresen rajzol (letiltott vagy tiltólistás GPU), vagy ha a
     két beágyazott weboldal betöltése elveszi az erőforrást.

     Ezért ablakonként mérünk, és a mediánt nézzük, hogy egy-egy akadás ne
     rontsa el a döntést. A mérés csak LEFELÉ léphet.

     Fontos, hogy több ablakot nézünk, ne csak egyet: a korábbi változat
     egyetlen, 3,8 mp-nél kezdődő mérésből döntött — az épp a két weboldal
     betöltésének kellős közepére esett, tehát a lap legrosszabb pillanatát
     mérte, és utána soha többé nem nézett vissza. Most az első ablak a belépő
     animáció után, még nyugodt lapon fut (ebből lesz az előtöltés döntése is),
     a továbbiak pedig végigkísérik a betöltést. */
  var WINDOWS = 4;                 /* ennyi ablak után abbahagyjuk a mérést */
  var WINDOW_FRAMES = 70;          /* ~1,2 mp 60 kép/mp mellett */

  function watchPerformance(onFirst) {
    if (reduced || tier === 'low') { if (onFirst) onFirst(null); return; }

    var samples = [], last = 0, winStart = 0, windows = 0, reported = false;

    function verdict(median) {
      /* Küszöbök szintenként. A takarékos szint már levette a díszeket:
         ha ott is 30 kép/mp alatt van, a vászonnak kell mennie. */
      if (tier === 'high') {
        if (median > 42) downgrade('low');
        else if (median > 26) downgrade('mid');       /* 38 kép/mp alatt */
      } else if (tier === 'mid') {
        if (median > 34) downgrade('low');            /* 29 kép/mp alatt */
      }
    }

    function finishWindow(median) {
      verdict(median);
      if (!reported) { reported = true; if (onFirst) onFirst(median); }
      windows++;
      if (windows < WINDOWS && tier !== 'low') requestAnimationFrame(tick);
    }

    function tick(ts) {
      /* Csak a választón mérünk: a weboldalak fölött a keret amúgy sem rajzol,
         és a beágyazott dokumentum képkockaideje nem a mi dolgunk. */
      if (current !== 'chooser') {
        if (!reported) { reported = true; if (onFirst) onFirst(null); }
        return;
      }
      if (!last) { last = ts; winStart = ts; requestAnimationFrame(tick); return; }

      samples.push(ts - last);
      last = ts;

      /* Az ablak vagy elég képkocka, vagy elég idő után zárul. Az időkorlát
         azért kell, mert épp a lassú gépen gyűlne össze a legnehezebben 70
         képkocka — és ott a legfontosabb, hogy időben szülessen döntés. */
      var full = samples.length >= WINDOW_FRAMES ||
        (ts - winStart > 1600 && samples.length >= 20);
      if (!full) { requestAnimationFrame(tick); return; }

      samples.sort(function (a, b) { return a - b; });
      var median = samples[Math.floor(samples.length / 2)] || 16;
      samples = [];
      last = 0;
      finishWindow(median);
    }

    requestAnimationFrame(tick);
  }

  /* ── Képkocka-számláló teszteléshez (?fx=debug) ──────────────────────────
     Enélkül a gyengébb gépen csak érzésre lehet ítélni. A számláló magától
     semmit nem befolyásol, és a jelző nélkül létre sem jön. */
  function initFpsMeter() {
    if (!/[?&]fx=debug(?:&|$)/.test(location.search)) return;

    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:999;' +
      'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;' +
      'background:rgba(0,0,0,.72);color:#e2cda2;padding:6px 9px;' +
      'border-radius:6px;pointer-events:none;white-space:pre';
    document.body.appendChild(el);

    var frames = 0, since = 0, worst = 0;

    requestAnimationFrame(function loop(ts) {
      requestAnimationFrame(loop);
      if (!since) { since = ts; return; }
      frames++;
      if (ts - since < 500) return;
      var fps = Math.round((frames * 1000) / (ts - since));
      worst = worst ? Math.min(worst, fps) : fps;
      el.textContent = 'szint: ' + tier + '\n' + fps + ' kép/mp (min ' + worst + ')';
      frames = 0;
      since = ts;
    });
  }

  document.addEventListener('visibilitychange', function () { pumpParticles(); });

  /* ── Megéri-e előre letölteni MINDKÉT weboldalt? ──────────────────────────
     Csak akkor, ha a kapcsolat és a gép elbírja. A jelzések nem mindenhol
     állnak rendelkezésre (Safari, Firefox) — ha nincs adat, előtöltünk, mert
     az a jobb élmény a gépek túlnyomó részén. */
  function preloadWorthwhile() {
    /* Gyenge gépen egyáltalán nem töltünk elő — akkor sem, ha a gép ADOTTSÁGAI
       gyengék, és akkor sem, ha a MÉRÉS minősítette annak. A csökkentett mozgás
       kérése viszont nem gyengeségi jelzés: az egy ízlésbeli beállítás, erős
       gépen is bekapcsolható, ezért az önmagában nem tiltja az előtöltést. */
    if (hwTier === 'low') return false;
    if (tier === 'low' && !reduced) return false;

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

  /* Meghívja a visszahívást, amint az adott weboldal betöltött. Ha már kész,
     azonnal; ha a `load` valamiért elmarad (hibás kép, akadó erőforrás), egy
     időkorlát mégis továbbengedi, hogy a lánc ne álljon meg örökre. */
  function whenFrameLoaded(key, cb) {
    var f = frames[key];
    if (!f || !f.el || f.loaded) { cb(); return; }

    var fired = false;
    function fire() {
      if (fired) return;
      fired = true;
      cb();
    }
    f.el.addEventListener('load', fire, { once: true });
    setTimeout(fire, 9000);
  }

  /* ── Előtöltés: EGYESÉVEL, nem egyszerre ──────────────────────────────────
     A választó azért gyors, mert a két weboldal már készen áll, amikor a
     látogató dönt. Csakhogy két teljes dokumentum — saját betűtípusokkal,
     vászonanimációval és a szemanatómia szoftveres 3D-motorjával — nem
     ingyenes: a letöltés, az értelmezés, a stílusszámítás, a képek dekódolása
     és az első kirajzolás ugyanazon a fő szálon és ugyanazon a GPU-n történik,
     amelyen közben a választó animációja fut.

     Két változás:

     1. EGYESÉVEL. A második weboldal csak akkor indul, amikor az első
        betöltött. Erős gépen ez alig érzékelhető különbség, gyengén viszont
        megfelezi a csúcsterhelést.

     2. KÉSŐBB. Nem fix 1,5 mp-nél, hanem a belépő animáció ÉS az első
        képkockaidő-mérés után. Így a lap legérzékenyebb két másodperce
        háborítatlan marad, a mérés pedig nyugodt lapot lát — nem a saját
        előtöltésünk terhelését méri.

     Ettől a váltás nem törik el: a `go()` úgyis kikéri az adott oldalt, és a
     látogató amúgy is a fél fölé viszi az egeret kattintás előtt — a
     `pointerenter` már ott elindítja a betöltést. */
  function startPreload(start) {
    if (!preloadWorthwhile()) return;

    /* Mélylinkre érkezve az adott oldal már fut: csak a másik van hátra. */
    var queue = start === 'masszazs' ? ['optika']
      : start === 'optika' ? ['masszazs']
        : ['masszazs', 'optika'];

    var idle = window.requestIdleCallback || function (cb) { return setTimeout(cb, 1); };

    function next(i) {
      if (i >= queue.length) return;
      idle(function () {
        var key = queue[i];
        requestFrame(key);
        whenFrameLoaded(key, function () { next(i + 1); });
      }, { timeout: 2500 });
    }

    next(0);
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
    initFpsMeter();

    if (start !== 'chooser') {
      requestFrame(start);
      jump(start);
    }

    /* A belépő animáció lefutott: innentől a rövidebb, mozgékonyabb
       átmenetek élnek (parallax, hover). */
    setTimeout(function () {
      body.classList.add('is-live');
      /* A belépő lefutott: innentől mehet a háttérréteg is. */
      entering = false;
      pumpParticles();
    }, reduced ? 0 : 2400);

    /* A belépő animáció után mérünk, még háborítatlan lapon — és az első
       ablak eredménye engedi tovább az előtöltést. Mélylinkre érkezve nincs
       mit mérni (nem a választó van a képen): ott azonnal továbbenged. */
    var preloadDone = false;
    function beginPreload() {
      if (preloadDone) return;
      preloadDone = true;
      startPreload(start);
    }

    setTimeout(function () { watchPerformance(beginPreload); }, reduced ? 0 : 2500);

    /* Biztonsági háló. A mérés `requestAnimationFrame`-re épül, az pedig nem
       mindig fut: rejtett fülön a böngésző felfüggeszti, képen kívüli
       iframe-ben megritkítja. Az előtöltés nem múlhat ezen — ha a mérés nem
       ad időben eredményt, a gép adottságaiból felvett szinttel indulunk. */
    setTimeout(beginPreload, 7000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
