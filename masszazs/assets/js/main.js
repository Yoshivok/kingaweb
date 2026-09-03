/* ═══════════════════════════════════════════════════════════════════════════
   SALVIA GYÓGYMASSZÁZS — interakciók
   ─────────────────────────────────────────────────────────────────────────
   1.  Konfiguráció (kezelés–időtartam párok, űrlap végpont)
   2.  Fejléc állapot + aktív menüpont
   3.  Kezelések legördülő menü
   4.  Mobil menü
   5.  Scroll-reveal animáció
   5b. Hero: szüneteltetés + mutatót követő fény
   5c. Kezeléskártya → részletes leírás
   5d. Sötét szekciók háttérfényei
   6.  Vissza a tetejére
   7.  „Időpontot kérek” gombok → űrlap előtöltése
   8.  Kezelés → választható időtartamok
   9.  Űrlap validáció és beküldés
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 1. KONFIGURÁCIÓ ──────────────────────────────────────────────────── */

  /* Az űrlap ide küldi a foglalást. A projekt saját kiszolgálója
     (`node server/server.js`) ezen a végponton veszi fel a naptárba, és két
     levelet küld: visszaigazolást a vendégnek, értesítést a masszőrnek.
     Ha a végpont nem érhető el (pl. statikus tárhelyen, szerver nélkül), az
     oldal a levelezőprogramos útra vált — de akkor EGYÉRTELMŰEN közli, hogy
     az időpont még nincs lefoglalva. */
  var FORM_ENDPOINT = '/api/booking';

  var CONTACT_EMAIL = 'kgmomed@gmail.com';

  /* Szakmailag indokolt kezelési hosszak — TARTALÉK. Élesben a kiszolgáló
     `/api/booking/options` válasza írja felül (az árlistából származik), így
     az adminban felvett vagy törölt kezelés azonnal itt is látszik. Ez a
     lista csak addig él, amíg a válasz megérkezik — és akkor is, ha nem. */
  var TREATMENTS = {
    gyogymasszazs: { name: 'Gyógymasszázs', durations: [30, 45, 60, 90] },
    svedmasszazs: { name: 'Svédmasszázs', durations: [30, 45, 60, 90] },
    nyirokmasszazs: { name: 'Nyirokmasszázs, nyirokdrenázs', durations: [30, 45, 60] },
    cellulitmasszazs: { name: 'Cellulitmasszázs, zsírtörés', durations: [30, 45, 60] },
    szegmentmasszazs: { name: 'Szegmentmasszázs', durations: [60] },
    kotoszoveti: { name: 'Kötőszöveti masszázs', durations: [60] },
    szekmasszazs: { name: 'Székmasszázs', durations: [20, 30, 45] },
    arcmasszazs: { name: 'Arcmasszázs', durations: [20, 30] },
    talpmasszazs: { name: 'Talpmasszázs', durations: [20, 30, 40] },
    tanacs: { name: 'Nem tudom, kérek javaslatot', durations: [] }
  };

  /* A NYITVATARTÁST már nem itt tartjuk. Korábban egy `OPENING` állandó
     sorolta fel a nyitást és a zárást, és abból készült az óralista — de az
     nem tudott a foglalt sávokról, a szünetekről és a szabadnapokról, ezért
     olyan órát is felkínált, ami valójában nem volt szabad. Most a
     kiszolgáló `/api/booking/availability` válasza adja a listát, ami mind a
     négyet figyelembe veszi. A nyitvatartás az admin felületen szerkeszthető
     (a lábléc és a kapcsolat szekció szövegét viszont kézzel kell
     utánavezetni). */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /* ── 1b. KERETBEN FUTÁS: MOZGÁS FELFÜGGESZTÉSE ────────────────────────────
     Az összekötő oldal mindkét weboldalt egyszerre tartja betöltve, egymás
     melletti iframe-ekben. A képen kívüli panel `visibility: hidden`, de ez a
     GYERMEK dokumentumot nem állítja meg: a `document.hidden` ott továbbra is
     hamis, az IntersectionObserver az iframe saját nézetmezejét figyeli, így a
     hero animációi a háttérben is végig futnak. Két sötét, egész képernyős
     hero egyszerre annyi réteget tart a GPU-n, hogy a kompozitor időnként
     eldobja és újraépíti a felületet — ez a hero-n fekete villanásként
     látszik. A keret ezért üzen, ha ez a panel épp nincs a képen. */
  /* A keret már a szkript indulása előtt ráteheti az osztályt a <html>-re,
     ezért onnan olvassuk ki a kezdőállapotot. Önállóan megnyitva mindig aktív. */
  var frameActive = !document.documentElement.classList.contains('is-frame-idle');
  var frameHooks = [];

  window.addEventListener('message', function (ev) {
    /* Csak a beágyazó keret szólhat bele (a jelzés önmagában ártalmatlan) */
    if (window.parent === window || ev.source !== window.parent) return;
    var data = ev.data;
    if (!data || data.type !== 'mom:motion') return;
    if (frameActive === !!data.active) return;
    frameActive = !!data.active;
    document.documentElement.classList.toggle('is-frame-idle', !frameActive);
    frameHooks.forEach(function (fn) { fn(); });
  });

  /* Igaz, ha a látogató ténylegesen látja ezt az oldalt. */
  function isLive() {
    return frameActive && !document.hidden;
  }

  /* ── 1c. HERO-POZÍCIÓ JELZÉSE A KERETNEK ──────────────────────────────────
     Az összekötő oldal „Választó” füle csak addig látszik, amíg a látogató az
     oldal tetején, a hero szakaszon van. A görgetés viszont ITT, a beágyazott
     dokumentumban történik, a fül pedig a keretben ül — és `file://` alól a
     keret nem olvashatja ki ezt a dokumentumot (eltérő eredetnek számít).
     Ezért innen szólunk ki. Önállóan megnyitva nincs kinek: ilyenkor kilép. */
  (function reportHeroPosition() {
    if (window.parent === window) return;

    var lastAtTop = null;

    function threshold() {
      var hero = $('.hero');
      var h = hero ? hero.getBoundingClientRect().height : 0;
      /* A fül már a hero vége előtt tűnjön el, ne a legutolsó képponton */
      return Math.max(120, (h || document.documentElement.clientHeight || 600) - 100);
    }

    function report(force) {
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      var atTop = y <= threshold();
      if (!force && atTop === lastAtTop) return;
      lastAtTop = atTop;
      try {
        window.parent.postMessage({ type: 'mom:hero', atTop: atTop }, '*');
      } catch (err) { /* a keret még nem fogad: a következő görgetés újrapróbálja */ }
    }

    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        report(false);
      });
    }, { passive: true });

    /* A hero magassága a betűtípusok és képek megérkezésével még változhat */
    window.addEventListener('resize', function () { report(true); }, { passive: true });
    window.addEventListener('load', function () { report(true); });
    report(true);
  })();

  /* ── 2. FEJLÉC ÁLLAPOT + AKTÍV MENÜPONT ───────────────────────────────── */
  var header = $('#header');

  function onScroll() {
    if (header) header.classList.toggle('is-stuck', window.scrollY > 12);
    toggleToTop();
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* Aktív menüpont a látható szekció alapján */
  var navLinks = $$('.nav__link[href^="#"]');
  var watched = navLinks
    .map(function (link) {
      var el = document.getElementById(link.getAttribute('href').slice(1));
      return el ? { link: link, el: el } : null;
    })
    .filter(Boolean);

  /* A „Kezelések” menüpont a részletes ismertetőkre és a kártyákra is aktív */
  var treatmentsSections = ['kezelesek']
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);
  var treatmentsToggle = $('.nav__toggle');

  if ('IntersectionObserver' in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var hit = watched.filter(function (w) { return w.el === entry.target; })[0];
        if (hit) {
          hit.link.classList.toggle('is-active', entry.isIntersecting);
          if (entry.isIntersecting) {
            watched.forEach(function (w) {
              if (w !== hit) w.link.classList.remove('is-active');
            });
          }
        }
        if (treatmentsToggle && treatmentsSections.indexOf(entry.target) !== -1) {
          var anyVisible = treatmentsSections.some(function (s) {
            var r = s.getBoundingClientRect();
            return r.top < window.innerHeight * 0.5 && r.bottom > window.innerHeight * 0.3;
          });
          treatmentsToggle.classList.toggle('is-active', anyVisible);
        }
      });
    }, { rootMargin: '-45% 0px -45% 0px' });

    watched.forEach(function (w) { spy.observe(w.el); });
    treatmentsSections.forEach(function (s) { spy.observe(s); });
  }

  /* ── 3. KEZELÉSEK LEGÖRDÜLŐ MENÜ ──────────────────────────────────────── */
  var dropItem = $('.nav__item--has-menu');
  if (dropItem && treatmentsToggle) {
    var closeTimer = null;

    function openDrop() {
      window.clearTimeout(closeTimer);
      dropItem.classList.add('is-open');
      treatmentsToggle.setAttribute('aria-expanded', 'true');
    }
    function doClose() {
      dropItem.classList.remove('is-open');
      treatmentsToggle.setAttribute('aria-expanded', 'false');
    }
    /* Késleltetés csak az egérrel való elhagyáshoz kell (türelmi idő);
       kattintásra és Escape-re azonnal záródjon. */
    function closeDrop(delay) {
      window.clearTimeout(closeTimer);
      if (!delay) { doClose(); return; }
      closeTimer = window.setTimeout(doClose, delay);
    }

    treatmentsToggle.addEventListener('click', function () {
      if (dropItem.classList.contains('is-open')) closeDrop();
      else openDrop();
    });
    dropItem.addEventListener('mouseenter', openDrop);
    dropItem.addEventListener('mouseleave', function () { closeDrop(160); });
    dropItem.addEventListener('focusin', openDrop);
    dropItem.addEventListener('focusout', function (e) {
      if (!dropItem.contains(e.relatedTarget)) closeDrop();
    });
    $$('.submenu a', dropItem).forEach(function (a) {
      a.addEventListener('click', function () { closeDrop(); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dropItem.classList.contains('is-open')) {
        closeDrop();
        treatmentsToggle.focus();
      }
    });
  }

  /* ── 4. MOBIL MENÜ ────────────────────────────────────────────────────── */
  var burger = $('.burger');
  var mobileNav = $('#mobile-nav');

  function setMobileNav(open) {
    if (!burger || !mobileNav) return;
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Menü bezárása' : 'Menü megnyitása');
    mobileNav.hidden = !open;
    document.body.classList.toggle('is-locked', open);
  }

  if (burger && mobileNav) {
    burger.addEventListener('click', function () {
      setMobileNav(burger.getAttribute('aria-expanded') !== 'true');
    });
    $$('a', mobileNav).forEach(function (a) {
      a.addEventListener('click', function () { setMobileNav(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !mobileNav.hidden) {
        setMobileNav(false);
        burger.focus();
      }
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 1080 && !mobileNav.hidden) setMobileNav(false);
    });
  }

  /* ── 5. SCROLL-REVEAL ─────────────────────────────────────────────────── */
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var revealables = $$('.reveal');

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealables.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var siblings = Array.prototype.slice.call(
          entry.target.parentNode ? entry.target.parentNode.children : []
        ).filter(function (n) { return n.classList && n.classList.contains('reveal'); });
        var index = siblings.indexOf(entry.target);
        entry.target.style.transitionDelay = (index > 0 ? Math.min(index, 6) * 70 : 0) + 'ms';
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

    revealables.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ── 5b. HERO: SZÜNETELTETÉS + MUTATÓT KÖVETŐ FÉNY ────────────────────── */
  /* A háttéranimációk alapból futnak (CSS); a JS csak leállítja őket, ha a
     hero kigördült a képből vagy a fül háttérbe került — így nem fogyaszt
     CPU-t akkor, amikor senki nem látja. */
  var heroEl = $('.hero');

  if (heroEl) {
    var heroVisible = true;

    var syncHeroMotion = function () {
      heroEl.classList.toggle('is-paused', !heroVisible || !isLive());
    };
    frameHooks.push(syncHeroMotion);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        heroVisible = entries[0].isIntersecting;
        syncHeroMotion();
      }, { threshold: 0 }).observe(heroEl);
    }
    document.addEventListener('visibilitychange', syncHeroMotion);

    /* A fénykör és a fényudvar-eltolás csak egeres/trackpados eszközön él:
       érintésen nincs mutató, a mozgásra érzékeny látogatóknál pedig kimarad. */
    if (!reduceMotion && window.matchMedia('(pointer: fine)').matches) {
      var gx = 0, gy = 0, aimGX = 0, aimGY = 0, frame = 0;

      /* A --tx/--ty a fénykörre, a --px/--py a fényudvarra kerül — NEM a
         .hero-ra. Az egyéni tulajdonság öröklődik: a .hero-ra írva a
         böngészőnek a hero EGÉSZ részfáját (címsor, bekezdések, gombok) újra
         kellett stílusoznia minden képkockában, amíg az egér mozgott. Elemre
         szűkítve képkockánként két elem stílusa számolódik újra, a transformot
         pedig onnantól tisztán a kompozitor intézi. */
      var touchEl = $('.hero__touch', heroEl);
      var haloEl = $('.hero__halo', heroEl);

      /* A hero dobozát egyszer olvassuk ki, és csak görgetéskor, átméretezéskor
         vagy betöltés után dobjuk el. A getBoundingClientRect() KIKÉNYSZERÍTI
         az elrendezés újraszámolását: minden egérmozgás-eseménynél meghívva
         (nem képkockánként — eseményenként!) ez volt a hero legdrágább főszálas
         tétele, és a kihagyott képkockák pont ilyenkor sűrűsödtek. */
      var box = null;
      var dropBox = function () { box = null; };
      var readBox = function () {
        if (!box) box = heroEl.getBoundingClientRect();
        return box;
      };
      window.addEventListener('scroll', dropBox, { passive: true });
      window.addEventListener('resize', dropBox, { passive: true });
      window.addEventListener('load', dropBox);

      var placeTouch = function () {
        if (!touchEl) return;
        touchEl.style.setProperty('--tx', gx.toFixed(1) + 'px');
        touchEl.style.setProperty('--ty', gy.toFixed(1) + 'px');
      };

      var draw = function () {
        gx += (aimGX - gx) * 0.09;
        gy += (aimGY - gy) * 0.09;

        var b = readBox();
        placeTouch();

        if (haloEl) {
          /* eltolás a középtől: ettől a fényudvar és a fénykör külön síkban
             mozdul — mélységérzet extra rétegek nélkül */
          haloEl.style.setProperty('--px', ((gx / b.width - 0.5) * -30).toFixed(1) + 'px');
          haloEl.style.setProperty('--py', ((gy / b.height - 0.5) * -22).toFixed(1) + 'px');
        }

        frame = (Math.abs(aimGX - gx) > 0.4 || Math.abs(aimGY - gy) > 0.4)
          ? requestAnimationFrame(draw)
          : 0;
      };

      /* A mutató helyét csak eltároljuk; a rajzolás rAF-ben, képkockánként
         egyszer történik — nem minden egérmozgás-eseménynél. */
      heroEl.addEventListener('pointermove', function (ev) {
        var b = readBox();
        aimGX = ev.clientX - b.left;
        aimGY = ev.clientY - b.top;
        if (!frame) frame = requestAnimationFrame(draw);
      }, { passive: true });

      heroEl.addEventListener('pointerenter', function (ev) {
        var b = readBox();
        /* ugrás nélküli belépés: a fénykör ott jelenik meg, ahol a mutató */
        gx = aimGX = ev.clientX - b.left;
        gy = aimGY = ev.clientY - b.top;
        placeTouch();
        heroEl.classList.add('is-touch');
      }, { passive: true });

      heroEl.addEventListener('pointerleave', function () {
        heroEl.classList.remove('is-touch');
      }, { passive: true });
    }
  }

  /* ── 5c. KEZELÉSKÁRTYA → RÉSZLETES LEÍRÁS ─────────────────────────────── */
  /* A leírások megjelenítését a CSS :target végzi (JS nélkül is működik).
     Itt csak két kényelmi funkció van: a nyitott kezeléshez tartozó kártya
     kijelölése, és hogy ugyanarra a kártyára újra kattintva bezáródjon. */
  var detailBox = $('#reszletek');

  if (detailBox) {
    var cardLinks = $$('.card__link[href^="#"]');

    /* Melyik leírás van nyitva? A horgony a leíráson belülre is mutathat
       (pl. a teljes ellenjavallati listára), ezért felfelé keresünk. */
    var openTreatmentId = function () {
      var id = (window.location.hash || '').slice(1);
      if (!id) return '';
      var el = document.getElementById(id);
      if (!el) return '';
      var article = el.closest ? el.closest('.treatment') : null;
      return article ? article.id : '';
    };

    var syncCards = function () {
      var openId = openTreatmentId();
      cardLinks.forEach(function (link) {
        var isOpen = openId && link.getAttribute('href') === '#' + openId;
        link.classList.toggle('is-open', !!isOpen);
        if (isOpen) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
    };

    window.addEventListener('hashchange', syncCards);
    syncCards();

    cardLinks.forEach(function (link) {
      link.addEventListener('click', function (ev) {
        /* Ugyanaz a kártya másodszor: becsukjuk, és visszalépünk a rácshoz.
           (Ilyenkor a böngésző nem váltana horgonyt, így hashchange sem lenne.) */
        if (link.getAttribute('href') !== window.location.hash) return;
        ev.preventDefault();
        window.location.hash = '#kezelesek';
      });
    });
  }

  /* ── 5d. SÖTÉT SZEKCIÓK HÁTTÉRFÉNYEI ──────────────────────────────────── */
  /* A fények CSS-ből mozognak; itt csak leállítjuk őket, amikor a szekció
     nem látszik vagy a fül háttérbe kerül. */
  var darkSections = $$('.section--dark');

  if (darkSections.length) {
    var visibleDark = [];

    var syncGlows = function () {
      darkSections.forEach(function (el, i) {
        el.classList.toggle('is-paused', !visibleDark[i] || !isLive());
      });
    };
    frameHooks.push(syncGlows);

    if ('IntersectionObserver' in window) {
      var glowObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          visibleDark[darkSections.indexOf(entry.target)] = entry.isIntersecting;
        });
        syncGlows();
      }, { rootMargin: '10% 0px' });

      darkSections.forEach(function (el, i) {
        visibleDark[i] = false;
        glowObserver.observe(el);
      });
    } else {
      darkSections.forEach(function (el, i) { visibleDark[i] = true; });
    }
    document.addEventListener('visibilitychange', syncGlows);
  }

  /* ── 6. VISSZA A TETEJÉRE ─────────────────────────────────────────────── */
  var toTop = $('#to-top');
  function toggleToTop() {
    if (toTop) toTop.hidden = window.scrollY < 700;
  }
  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  /* Évszám a láblécben */
  var yearEl = $('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ── 7–9. IDŐPONTFOGLALÁSI ŰRLAP ────────────────────────────────────────
     Az űrlap VALÓDI foglalást ad le: a felkínált órák a kiszolgáló naptárából
     jönnek (`/api/booking/availability`), és a beküldés lefoglalja a sávot.
     Két időpont közé a kiszolgáló mindig beszámítja a pihenőt — a lista
     ezért nem óránként lépked, hanem ott kínál kezdést, ahol tényleg van
     hely (pl. egy 9:00-kor induló 45 perces kezelés után 10:05-kor).

     A SORREND KÖTÖTT: kezelés → hossz → nap → óra. Hossz nélkül nem lehet
     tudni, mekkora sáv kell, ezért az óralista addig zárva marad. */
  var form = $('#booking-form');
  var result = $('#form-result');
  var treatmentSel = $('#f-treatment');
  var durationSel = $('#f-duration');
  var dateInput = $('#f-date');

  var timeSel = $('#f-time');

  /* Az utoljára megkapott naptárválasz — az ellenőrzés is ebből dolgozik,
     hogy a beküldés ne kínálhasson mást, mint amit a látogató látott. */
  var slotState = { date: '', duration: 0, slots: [], closed: false, reason: '' };
  var slotRequest = 0;

  /* Helyi (nem UTC) dátum ÉÉÉÉ-HH-NN alakban — a <input type="date"> ezt várja */
  function isoDay(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* A dátumválasztó nem engedi a mai nap előtti dátumot. A felső határt a
     kiszolgáló mondja meg (`horizonDays`), amint megjön a beállítás. */
  if (dateInput) {
    var today = new Date();
    dateInput.min = isoDay(today);
    dateInput.max = isoDay(new Date(today.getTime() + 1000 * 60 * 60 * 24 * 120));
  }

  /* A választott hossz percben, vagy 0, ha még nincs. */
  function chosenDuration() {
    if (!durationSel) return 0;
    var value = parseInt(durationSel.value, 10);
    return isFinite(value) && value > 0 ? value : 0;
  }

  /* '09:00' → '9:00' — az oldal mindenhol vezető nulla nélkül írja az órákat. */
  function shortTime(clock) {
    return String(clock || '').replace(/^0/, '');
  }

  /* A kezdéshez tartozó befejezés: „9:00 – 9:45” */
  function slotLabel(clock, minutes) {
    var parts = clock.split(':');
    var end = (parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)) + minutes;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return shortTime(clock) + ' – ' + shortTime(p(Math.floor(end / 60)) + ':' + p(end % 60));
  }

  function setTimePlaceholder(text, disabled) {
    if (!timeSel) return;
    timeSel.innerHTML = '';
    timeSel.appendChild(new Option(text, ''));
    timeSel.disabled = disabled !== false;
  }

  /* ── 8b. SZABAD IDŐPONTOK A KISZOLGÁLÓRÓL ────────────────────────────────
     Minden kérésnek sorszáma van: ha a látogató gyorsan másik napra vált, a
     korábbi, lassabban megérkező válasz nem írhatja felül a frissebbet. */
  function loadSlots(keep) {
    if (!timeSel) return;

    var previous = keep ? timeSel.value : '';
    var dateVal = dateInput && dateInput.value ? dateInput.value : '';
    var minutes = chosenDuration();

    if (!minutes) {
      slotState = { date: '', duration: 0, slots: [], closed: false, reason: '' };
      setTimePlaceholder('Először válasszon kezelést és hosszt');
      return;
    }
    if (!dateVal) {
      slotState = { date: '', duration: minutes, slots: [], closed: false, reason: '' };
      setTimePlaceholder('Először válasszon napot');
      return;
    }

    if (!window.fetch) {
      setTimePlaceholder('Az időpontokat nem tudjuk lekérdezni — kérjük, hívjon minket');
      return;
    }

    setTimePlaceholder('Szabad időpontok keresése…');
    var token = ++slotRequest;

    fetch('/api/booking/availability?site=masszazs&date=' + encodeURIComponent(dateVal) +
      '&duration=' + minutes, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (token !== slotRequest) return;          /* közben másik nap jött */
        if (!data || !data.ok) throw new Error('rossz válasz');

        slotState = {
          date: data.date,
          duration: data.duration,
          slots: data.slots || [],
          closed: !!data.closed,
          reason: data.reason || ''
        };
        renderSlots(previous);
      })
      .catch(function () {
        if (token !== slotRequest) return;
        slotState = { date: dateVal, duration: minutes, slots: [], closed: false, reason: '' };
        setTimePlaceholder('Az időpontokat most nem tudjuk lekérdezni — kérjük, hívjon minket');
      });
  }

  function renderSlots(previous) {
    if (!timeSel) return;
    timeSel.innerHTML = '';

    if (!slotState.slots.length) {
      timeSel.appendChild(new Option(
        slotState.reason || 'Erre a napra nincs szabad időpont', ''));
      timeSel.disabled = true;
      var hint = $('#hint-time');
      if (hint && slotState.reason) hint.textContent = slotState.reason;
      return;
    }

    timeSel.disabled = false;
    timeSel.appendChild(new Option('Válasszon időpontot…', ''));
    slotState.slots.forEach(function (clock) {
      timeSel.appendChild(new Option(slotLabel(clock, slotState.duration), clock));
    });

    /* A korábbi választás csak akkor marad meg, ha még mindig szabad. */
    timeSel.value = previous || '';
    if (timeSel.selectedIndex < 0) timeSel.value = '';

    var hintEl = $('#hint-time');
    if (hintEl) {
      hintEl.textContent = 'A kiválasztott időpont azonnal lefoglalódik. ' +
        'Két kezelés között 20 perc szünetet tartunk, ezért csak a valóban szabad kezdések látszanak.';
    }
  }

  if (dateInput) {
    dateInput.addEventListener('change', function () {
      clearError(dateInput);
      loadSlots(true);
    });
  }

  /* 8. Kezelés → választható időtartamok */
  function fillDurations(key, keep) {
    if (!durationSel) return;
    var previous = keep ? durationSel.value : '';
    durationSel.innerHTML = '';

    var conf = TREATMENTS[key];
    if (!key || !conf) {
      durationSel.appendChild(new Option('Először válasszon kezelést', ''));
      durationSel.disabled = true;
      durationSel.required = true;
      loadSlots(false);
      return;
    }

    if (!conf.durations.length) {
      durationSel.appendChild(new Option('Ez a kezelés jelenleg nem foglalható', ''));
      durationSel.disabled = true;
      durationSel.required = true;
      loadSlots(false);
      return;
    }

    durationSel.disabled = false;
    durationSel.required = true;
    durationSel.appendChild(new Option('Válasszon hosszt…', ''));
    conf.durations.forEach(function (min) {
      /* Ha az árlista már megérkezett, a hossz mellé az árat is kiírjuk —
         így a vendég nem az árlistához visszalapozva dönt. Az űrlap az
         option ÉRTÉKÉT használja (a percet), a feliratot nem, tehát ez a
         kiegészítés a beküldött adaton nem változtat. */
      var price = conf.prices ? conf.prices[min] : null;
      var label = price != null ? (min + ' perc — ' + formatFt(price)) : (min + ' perc');
      durationSel.appendChild(new Option(label, String(min)));
    });
    if (previous && conf.durations.indexOf(parseInt(previous, 10)) !== -1) {
      durationSel.value = previous;
    }
    loadSlots(keep === true);
  }

  if (treatmentSel) {
    treatmentSel.addEventListener('change', function () {
      fillDurations(treatmentSel.value, false);
      clearError(durationSel);
      clearError(treatmentSel);
    });
    fillDurations(treatmentSel.value, false);
  }

  if (durationSel) {
    durationSel.addEventListener('change', function () {
      clearError(durationSel);
      loadSlots(true);
    });
  }

  /* 7. „Időpontot kérek — …” gombok */
  $$('[data-book]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-book');
      if (form && form.hidden && result) {
        /* Ha épp a visszajelzés látszik, visszaállítjuk az űrlapot */
        result.hidden = true;
        form.hidden = false;
      }
      if (treatmentSel && TREATMENTS[key]) {
        treatmentSel.value = key;
        fillDurations(key, false);
        clearError(treatmentSel);
      }
      var target = $('#idopontfoglalas');
      if (target) {
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }
      window.setTimeout(function () {
        var nameField = $('#f-name');
        if (nameField && !nameField.value) nameField.focus({ preventScroll: true });
        else if (durationSel && !durationSel.disabled) durationSel.focus({ preventScroll: true });
      }, reduceMotion ? 0 : 650);
    });
  });

  /* 9. Validáció */
  function errorEl(field) {
    if (!field) return null;
    var ids = (field.getAttribute('aria-describedby') || '').split(/\s+/);
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && el.classList.contains('field__error')) return el;
    }
    return null;
  }

  function setError(field, message) {
    var el = errorEl(field);
    if (el) {
      el.textContent = message;
      el.hidden = false;
    }
    if (field) field.setAttribute('aria-invalid', 'true');
  }

  function clearError(field) {
    var el = errorEl(field);
    if (el) {
      el.textContent = '';
      el.hidden = true;
    }
    if (field) field.removeAttribute('aria-invalid');
  }

  var PHONE_RE = /^[+()\d\s./-]{7,20}$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

  function validate() {
    var problems = [];

    function check(field, condition, message) {
      if (!field) return;
      if (condition) { clearError(field); return; }
      setError(field, message);
      problems.push(field);
    }

    var name = $('#f-name');
    var phone = $('#f-phone');
    var email = $('#f-email');
    var contra = $('#f-contra');
    var gdpr = $('#f-gdpr');

    check(name, name && name.value.trim().length >= 3, 'Kérjük, adja meg a nevét.');
    check(phone, phone && PHONE_RE.test(phone.value.trim()),
      'Kérjük, adjon meg egy érvényes telefonszámot.');
    check(email, email && EMAIL_RE.test(email.value.trim()),
      'Kérjük, adjon meg egy érvényes e-mail címet.');
    check(treatmentSel, treatmentSel && treatmentSel.value !== '',
      'Válassza ki a kívánt kezelést.');
    check(durationSel, durationSel && !durationSel.disabled && durationSel.value !== '',
      'Válassza ki a kezelés hosszát.');

    /* A nap és az óra MOST már kötelező: valódi sávot foglalunk le. */
    check(dateInput, dateInput && dateInput.value !== '',
      'Válassza ki, melyik napra szeretne jönni.');

    if (dateInput && dateInput.value && slotState.date === dateInput.value && slotState.closed) {
      setError(dateInput, slotState.reason || 'Ezen a napon zárva tartunk.');
      problems.push(dateInput);
    }

    check(timeSel, timeSel && timeSel.value !== '' &&
      slotState.slots.indexOf(timeSel.value) !== -1,
      'Válasszon egy szabad időpontot a listából.');

    check(contra, contra && contra.checked,
      'A Házirend, az ÁSZF és az egészségügyi feltételek elfogadása a foglalás kötelező feltétele.');
    check(gdpr, gdpr && gdpr.checked,
      'Az adatkezelési tájékoztató elfogadása nélkül nem tudjuk felvenni Önnel a kapcsolatot.');

    return problems;
  }

  /* Élő hibatörlés */
  if (form) {
    $$('input, select, textarea', form).forEach(function (field) {
      var evt = (field.type === 'checkbox' || field.tagName === 'SELECT') ? 'change' : 'input';
      field.addEventListener(evt, function () {
        if (field.getAttribute('aria-invalid') === 'true') clearError(field);
      });
    });
  }

  /* A kiszolgálónak küldött foglalás. */
  function collect() {
    var key = treatmentSel ? treatmentSel.value : '';
    return {
      site: 'masszazs',
      serviceKey: key,
      duration: chosenDuration(),
      date: dateInput && dateInput.value ? dateInput.value : '',
      start: timeSel && timeSel.value ? timeSel.value : '',
      name: $('#f-name') ? $('#f-name').value.trim() : '',
      phone: $('#f-phone') ? $('#f-phone').value.trim() : '',
      email: $('#f-email') ? $('#f-email').value.trim() : '',
      message: $('#f-message') ? $('#f-message').value.trim() : '',
      terms: true,
      gdpr: true
    };
  }

  /* Az összegzés emberi alakja — ugyanaz a beküldés előtt és után. */
  function describe(data) {
    var conf = TREATMENTS[data.serviceKey];
    var dateText = data.date;
    try {
      dateText = new Date(data.date + 'T00:00:00')
        .toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    } catch (e) { /* marad a nyers dátum */ }

    return {
      name: data.name,
      phone: data.phone,
      email: data.email,
      treatment: conf ? conf.name : data.serviceKey,
      duration: data.duration + ' perc',
      date: dateText,
      time: data.duration ? slotLabel(data.start, data.duration) : shortTime(data.start),
      message: data.message
    };
  }

  function buildMailto(view) {
    var lines = [
      'Időpontkérés a weboldalról',
      '',
      'Név: ' + view.name,
      'Telefon: ' + view.phone,
      'E-mail: ' + view.email,
      'Kezelés: ' + view.treatment,
      'Kezelés hossza: ' + view.duration,
      'Kért nap: ' + view.date,
      'Kért időpont: ' + view.time,
      '',
      'Megjegyzés:',
      view.message || '—',
      '',
      'Az ellenjavallatokat elolvastam és tudomásul vettem.',
      'Az adatkezeléshez hozzájárultam.'
    ];
    return 'mailto:' + CONTACT_EMAIL +
      '?subject=' + encodeURIComponent('Időpontkérés — ' + view.treatment + ' (' + view.name + ')') +
      '&body=' + encodeURIComponent(lines.join('\n'));
  }

  function renderSummary(view) {
    var box = $('#form-result-summary');
    if (!box) return;
    var rows = [
      ['Név', view.name],
      ['Telefon', view.phone],
      ['E-mail', view.email],
      ['Kezelés', view.treatment],
      ['Hossz', view.duration],
      ['Időpont', view.date + ' · ' + view.time]
    ];
    box.innerHTML = rows.map(function (r) {
      return '<div><span class="k">' + r[0] + '</span><span class="v"></span></div>';
    }).join('');
    /* A felhasználói adatokat textContent-tel írjuk be (nincs HTML-beszúrás) */
    $$('.v', box).forEach(function (cell, i) { cell.textContent = rows[i][1]; });
  }

  /**
   * @param {object} view a megjelenítendő összegzés
   * @param {boolean} booked igaz, ha a kiszolgáló tényleg lefoglalta a sávot
   * @param {boolean} mailed igaz, ha a visszaigazoló levél is kiment
   */
  function showResult(view, booked, mailed) {
    if (!result) return;
    var title = $('#form-result-title');
    var text = $('#form-result-text');
    var actions = $('#form-result-actions');

    if (booked) {
      if (title) title.textContent = 'Az időpontját lefoglaltuk';
      if (text) {
        text.textContent = mailed
          ? 'Visszaigazoló levelet küldtünk a megadott e-mail címre. Az időpont a naptárunkban rögzítve van — ' +
            'kérjük, néhány perccel a kezdés előtt érkezzen. Ha mégsem tud jönni, hívjon minket legalább 24 órával előre.'
          : 'Az időpont a naptárunkban rögzítve van. Kérjük, néhány perccel a kezdés előtt érkezzen. ' +
            'Ha mégsem tud jönni, hívjon minket legalább 24 órával előre.';
      }
      if (actions) actions.innerHTML = '';
    } else {
      if (title) title.textContent = 'A foglalást most nem tudtuk rögzíteni';
      if (text) {
        text.textContent = 'Nem értük el a foglalási rendszert, ezért ez az időpont NINCS lefoglalva. ' +
          'Küldje el az alábbi levelet, vagy hívjon minket — az időpontot telefonon azonnal rögzítjük.';
      }
      if (actions) {
        actions.innerHTML = '';
        var mail = document.createElement('a');
        mail.className = 'btn btn--primary';
        mail.href = buildMailto(view);
        mail.textContent = 'Küldés e-mailben';
        var tel = document.createElement('a');
        tel.className = 'btn btn--ghost';
        tel.href = 'tel:+36205017453';
        tel.textContent = 'Inkább telefonálok: 06 20 501 7453';
        actions.appendChild(mail);
        actions.appendChild(tel);
      }
    }

    renderSummary(view);
    if (form) form.hidden = true;
    result.hidden = false;
    result.focus();
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var problems = validate();
      if (problems.length) {
        problems[0].focus();
        problems[0].scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'center'
        });
        return;
      }

      var data = collect();
      var view = describe(data);

      if (!window.fetch) {
        showResult(view, false, false);
        return;
      }

      var submitBtn = $('button[type="submit"]', form);
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Foglalás…'; }

      fetch(FORM_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(data)
      })
        .then(function (res) {
          return res.json().catch(function () { return null; })
            .then(function (body) { return { status: res.status, body: body }; });
        })
        .then(function (res) {
          if (res.body && res.body.ok) {
            showResult(view, true, res.body.mailed === true);
            return;
          }

          /* Elkelt időpont vagy visszautasított adat: NEM állítjuk, hogy
             sikerült. A listát frissítjük, hogy a látogató a friss
             kínálatból választhasson újra. */
          var message = (res.body && res.body.error)
            || 'Ezt az időpontot időközben lefoglalták. Kérjük, válasszon másikat.';
          setError(timeSel, message);
          loadSlots(false);
          if (timeSel) {
            timeSel.focus();
            timeSel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
          }
        })
        .catch(function () {
          /* Nincs kapcsolat a kiszolgálóval — átváltunk az e-mailes útra,
             de egyértelműen közöljük, hogy ez még nem foglalás. */
          showResult(view, false, false);
        })
        .then(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Időpont lefoglalása';
          }
        });
    });
  }

  /* „Új foglalás indítása” — a visszajelzésből vissza az űrlaphoz. A vendég
     adatait meghagyjuk (gyakori, hogy ugyanaz a személy foglal még egy
     időpontot), a napot és az órát viszont nem: azok időközben elkelhettek. */
  var resetBtn = $('#form-reset');
  if (resetBtn && form && result) {
    resetBtn.addEventListener('click', function () {
      result.hidden = true;
      form.hidden = false;
      if (dateInput) dateInput.value = '';
      loadSlots(false);
      form.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      if (treatmentSel) treatmentSel.focus({ preventScroll: true });
    });
  }


  /* ── 10. INTERAKTÍV ANATÓMIA & PANASZTÉRKÉP (2-LÉPCSŐS DRILLDOWN) ────────── */
  var FULL_BODY_MAIN_REGIONS = {
    // FRONT VIEW
    'fej': {
      name: 'Arc, Állkapocs & Fej',
      view: 'front',
      side: 'right',
      target: { x: 400, y: 70 },
      label: { x: 550, y: 70 },
      svgPath: 'M 550,70 L 475,70 L 400,70'
    },
    'nyak': {
      name: 'Nyak & Tarkó',
      view: 'front',
      side: 'left',
      target: { x: 400, y: 155 },
      label: { x: 250, y: 155 },
      svgPath: 'M 250,155 L 325,155 L 400,155'
    },
    'kar': {
      name: 'Kar, Váll & Könyök',
      view: 'front',
      side: 'left',
      target: { x: 275, y: 310 },
      label: { x: 230, y: 310 },
      svgPath: 'M 230,310 L 252,310 L 275,310'
    },
    'torzs': {
      name: 'Mellkas & Has',
      view: 'front',
      side: 'right',
      target: { x: 400, y: 280 },
      label: { x: 550, y: 280 },
      svgPath: 'M 550,280 L 475,280 L 400,280'
    },
    'lab': {
      name: 'Comb, Térd & Vádli',
      view: 'front',
      side: 'left',
      target: { x: 345, y: 600 },
      label: { x: 250, y: 600 },
      svgPath: 'M 250,600 L 297,600 L 345,600'
    },
    'boka-front': {
      name: 'Boka & Sarok',
      view: 'front',
      groupKey: 'talp',
      side: 'right',
      target: { x: 440, y: 810 },
      label: { x: 550, y: 810 },
      svgPath: 'M 550,810 L 495,810 L 440,810'
    },

    // BACK VIEW
    'nyak-back': {
      name: 'Nyak & Tarkó',
      view: 'back',
      groupKey: 'nyak',
      side: 'left',
      target: { x: 400, y: 140 },
      label: { x: 250, y: 140 },
      svgPath: 'M 250,140 L 325,140 L 400,140'
    },
    'hat': {
      name: 'Háti szakasz & Gerinc',
      view: 'back',
      side: 'right',
      target: { x: 400, y: 240 },
      label: { x: 550, y: 240 },
      svgPath: 'M 550,240 L 475,240 L 400,240'
    },
    'derek': {
      name: 'Derék & Ágyéki Gerinc',
      view: 'back',
      groupKey: 'hat',
      side: 'left',
      target: { x: 400, y: 340 },
      label: { x: 250, y: 340 },
      svgPath: 'M 250,340 L 325,340 L 400,340'
    },
    'fenek': {
      name: 'Csípő, Medence & Farizom',
      view: 'back',
      groupKey: 'csipo',
      side: 'right',
      target: { x: 400, y: 430 },
      label: { x: 540, y: 430 },
      svgPath: 'M 540,430 L 457,430 L 400,430'
    },
    'vadli-back': {
      name: 'Vádli & Comb-hátsó',
      view: 'back',
      groupKey: 'lab',
      side: 'left',
      target: { x: 350, y: 620 },
      label: { x: 250, y: 620 },
      svgPath: 'M 250,620 L 300,620 L 350,620'
    },
    'talp': {
      name: 'Boka & Sarok',
      view: 'back',
      side: 'right',
      target: { x: 440, y: 810 },
      label: { x: 550, y: 810 },
      svgPath: 'M 550,810 L 495,810 L 440,810'
    }
  };

  var REGION_GROUPS = {
    'kar': {
      name: 'Kar, Váll & Könyök',
      img: 'assets/img/anatomy-region-arm.webp',
      imgFemale: 'assets/img/anatomy-region-arm-female.webp',
      title: 'Részletes Kar & Vállöv Anatómia',
      subHotspots: [
        {
          key: 'kar-vall',
          name: 'Vállizom (Rotátorköpeny)',
          pin: { x: 26, y: 22 },
          pinFemale: { x: 48, y: 26 },
          title: 'Befagyott Váll Szindróma & Rotátorköpeny Feszülés',
          latin: 'Musculus Deltoideus & Capsulitis adhesiva',
          badge: 'Vállizomzat',
          symptoms: [
            'Vállízületi emelési fájdalom és felkarba sugárzó nyomás',
            'Éjszakai fájdalom az érintett vállon fekve',
            'Vállízületi beszűkülés karkörzéskor'
          ],
          causes: 'Vállízületi letapadások, túlterhelés, mikrosérülések.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs (45–60 perc)'
        },
        {
          key: 'kar-felkar',
          name: 'Felkar (Bicepsz & Tricepsz)',
          pin: { x: 28, y: 46 },
          pinFemale: { x: 54, y: 48 },
          title: 'Felkar Izomláz & Izomrost Letapadás',
          latin: 'Musculus Biceps brachii & Triceps brachii',
          badge: 'Felkarizom',
          symptoms: [
            'Bicepsz vagy tricepsz feszülése behajlításkor vagy kinyújtáskor',
            'Izomláz és nyilalló érzés edzés vagy emelés után'
          ],
          causes: 'Nehéz fizikai munka, edzés, terhelés.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs / Svédmasszázs (30–45 perc)'
        },
        {
          key: 'kar-konyok',
          name: 'Könyök (Teniszkönyök & Golfkönyök)',
          pin: { x: 32, y: 68 },
          pinFemale: { x: 43, y: 72 },
          title: 'Teniszkönyök & Golfkönyök',
          latin: 'Epicondylitis lateralis & medialis',
          badge: 'Könyökízület',
          symptoms: [
            'Könyök külső vagy belső oldalának nyomásérzékenysége',
            'Tárgyak megragadásakor, szorításakor jelentkező éles fájdalom',
            'Alkarba sugárzó zsibbadó merevség'
          ],
          causes: 'Monoton kéz- és alkari terhelés (egérhasználat, billentyűzet, szerszámok, teniszezés).',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs / Kötőszöveti masszázs (30–45 perc)'
        },
        {
          key: 'kar-alkar',
          name: 'Alkar & Csukló (Alagút szindróma)',
          pin: { x: 62, y: 82 },
          pinFemale: { x: 68, y: 80 },
          title: 'Alagút Szindróma & Ínhüvelygyulladás',
          latin: 'Carpal Tunnel & Tendovaginitis flexorum',
          badge: 'Alkar & Kézfej',
          symptoms: [
            'Hüvelyk-, mutató- és középső ujj zsibbadása, hangyázása',
            'Éjszakai felriadás kézzsibbadásra',
            'Gépelés és finommotoros mozdulatok gyengesége'
          ],
          causes: 'Csuklóalagút szűkülete, monoton billentyűzet- és egérhasználat, ínhüvely túlerőltetése.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs / Kötőszöveti technika (30–45 perc)'
        }
      ]
    },

    'lab': {
      name: 'Comb, Térd & Vádli',
      img: 'assets/img/anatomy-region-leg.webp',
      imgFemale: 'assets/img/anatomy-region-leg-female.webp',
      title: 'Részletes Láb & Térdízületi Anatómia',
      subHotspots: [
        {
          key: 'lab-comb',
          name: 'Combizom (Quadriceps)',
          pin: { x: 54, y: 26 },
          pinFemale: { x: 58, y: 32 },
          title: 'Combizom Feszülés & Izomláz',
          latin: 'Musculus Quadriceps femoris & Hamstrings',
          badge: 'Combizomzat',
          symptoms: [
            'Combfájdalom és izomköteg feszülés guggoláskor vagy lépcsőzéskor',
            'Comb hátsó részének nyúlási korlátozottsága'
          ],
          causes: 'Sporttevékenység, túledzés, hosszú séta.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs / Svédmasszázs (30–60 perc)'
        },
        {
          key: 'lab-terd',
          name: 'Térdízület (Patella ínhüvely)',
          pin: { x: 54, y: 50 },
          pinFemale: { x: 65, y: 52 },
          title: 'Patella Ínhüvely Feszültség & Ugrótérd',
          latin: 'Tendinitis patellae & Ligamentum patellae',
          badge: 'Térdízület',
          symptoms: [
            'Térdkalács alatti vagy körüli fájdalom hajlításkor',
            'Lépcsőn lefelé menetelkor szúró térdfájdalom',
            'Térdkörüli izmok letapadása'
          ],
          causes: 'Ugrás, futás, combfeszítő izom túlfeszülése.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs (30–45 perc)'
        },
        {
          key: 'lab-vadli',
          name: 'Vádli (Lábszárizomzat)',
          pin: { x: 42, y: 64 },
          pinFemale: { x: 38, y: 64 },
          title: 'Vádligörcs & Lábszár Feszültség',
          latin: 'Musculus Gastrocnemius & Soleus',
          badge: 'Lábszár',
          symptoms: [
            'Éjszakai spontán vádligörcsök',
            'Kemény, feszes lábszárizomzat járás közben'
          ],
          causes: 'Állómunka, magassarkú cipő, keringési elégtelenség.',
          treatmentKey: 'nyirokmasszazs',
          treatmentName: 'Nyirokdrenázs / Gyógymasszázs (30–45 perc)'
        },
        {
          key: 'lab-achilles',
          name: 'Achilles-ín & Boka',
          pin: { x: 44, y: 88 },
          pinFemale: { x: 42, y: 88 },
          title: 'Achilles-ín Merevség & Boka Kötöttség',
          latin: 'Tendo Achillis & Articulatio talocruralis',
          badge: 'Boka & Ín',
          symptoms: [
            'Achilles-ín reggeli fájdalma és merevsége az első lépéseknél',
            'Boka mozgékonyság csökkenése'
          ],
          causes: 'Futás, kemény talajon járás, vádli lerövidülése.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs / Svédmasszázs (30–45 perc)'
        }
      ]
    },

    'hat': {
      name: 'Háti szakasz, Gerinc & Derék',
      img: 'assets/img/anatomy-region-back.webp',
      imgFemale: 'assets/img/anatomy-region-back-female.webp',
      title: 'Részletes Hát & Ágyéki Gerinc Anatómia',
      subHotspots: [
        {
          key: 'hat-trapez',
          name: 'Csuklyásizom / Nyaköv',
          pin: { x: 36, y: 22 },
          pinFemale: { x: 36, y: 18 },
          title: 'Nyak-Vállövi Feszültség & Csuklyásizom Görcs',
          latin: 'Musculus Trapezius pars descendens',
          badge: 'Vállöv',
          symptoms: [
            'Feszes, kemény "kötelek" a vállövben',
            'Nyakból vállba sugárzó nehéz nyomás'
          ],
          causes: 'Stressz miatti vállfelhúzás, monitornézés.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs (30–60 perc)'
        },
        {
          key: 'hat-lapocka',
          name: 'Lapockakörnyék (Rhomboideus)',
          pin: { x: 58, y: 36 },
          pinFemale: { x: 58, y: 32 },
          title: 'Lapockakörnyéki Izomcsomók',
          latin: 'Musculus Rhomboideus major & minor',
          badge: 'Felső hát',
          symptoms: [
            'Égő, szúró fájdalom a lapockák belső szélénél',
            'Mély izomcsomók (myogelosis) a háti szakaszon'
          ],
          causes: 'Görnyedt ülés, gyenge mélyhátizomzat.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs / Szegmentmasszázs (45–60 perc)'
        },
        {
          key: 'hat-lumbago',
          name: 'Derék & Ágyéki Gerinc (Lumbágó)',
          pin: { x: 50, y: 72 },
          pinFemale: { x: 50, y: 68 },
          title: 'Lumbágó & Ágyéki Derékfájdalom',
          latin: 'Lumbago & Erector spinae (Lumbalis)',
          badge: 'Alsó hát',
          symptoms: [
            'Éles derékfájdalom emelés vagy hajolás után',
            'Nehézkes felegyenesedés ülésből',
            'Feszes ágyéki fascia'
          ],
          causes: 'Nehéz súly emelése, hirtelen elmozdulás, rándulás.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs (60 perc)'
        },
        {
          key: 'hat-isiasz',
          name: 'Ülőideg (Isiász kisugárzás)',
          pin: { x: 50, y: 90 },
          pinFemale: { x: 50, y: 88 },
          title: 'Isiász & Ülőideg Zsába',
          latin: 'Ischias & Nervus ischiadicus',
          badge: 'Ágyék-csípő',
          symptoms: [
            'Deréktól a fenéken át combba vagy lábszárba sugárzó éles fájdalom',
            'Lábfej vagy ujjak zsibbadása'
          ],
          causes: 'Ülőideg nyomódása feszes derék- vagy farizmok által.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs / Szegmentmasszázs (60 perc)'
        }
      ]
    },

    'csipo': {
      name: 'Csípő, Medence & Farizom',
      img: 'assets/img/anatomy-region-csipo.webp',
      imgFemale: 'assets/img/anatomy-region-csipo-female.webp',
      title: 'Részletes Csípő, Medence & Farizom Anatómia',
      subHotspots: [
        {
          key: 'csipo-piriformis',
          name: 'Farizom & Piriformis (Piriformis szindróma)',
          pin: { x: 26, y: 58 },
          pinFemale: { x: 30, y: 55 },
          title: 'Piriformis Szindróma & Mély Farizom Kötöttség',
          latin: 'Musculus Piriformis & Gluteus maximus',
          badge: 'Farizomzat',
          symptoms: [
            'Mély fenékfájdalom, amely üléskor vagy autóvezetéskor fokozódik',
            'Comb hátsó részébe vagy lábszárba sugárzó nyilallás (ülésisiász)',
            'Farizom merevség és csípőforgatási nehézség felálláskor'
          ],
          causes: 'Tartós ülőmunka, futás, egyoldalú terhelés, feszes piriformis izom miatti ülőideg nyomás.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs / Svédmasszázs (45–60 perc)'
        },
        {
          key: 'csipo-iliopsoas',
          name: 'Csípőhorpasz & Medenceöv (SI Ízületi Blokk)',
          pin: { x: 42, y: 32 },
          pinFemale: { x: 49, y: 32 },
          title: 'Csípőhorpasz Letapadás & SI Ízületi Blokk',
          latin: 'Musculus Iliopsoas & Articulatio sacroiliaca',
          badge: 'Medenceöv / SI Ízület',
          symptoms: [
            'Keresztcsonti ízület (SI ízület) szúró fájdalma egyoldalú terheléskor',
            'Combhajlati és deréktáji merevség hosszas ülés utáni felegyenesedéskor',
            'Medence billenés miatti egyenlőtlen terhelés'
          ],
          causes: 'Monoton ülőéletmód miatti csípőhorpasz izomlerövidülés, keresztcsonti blokk.',
          treatmentKey: 'kotoszoveti',
          treatmentName: 'Kötőszöveti masszázs / Szegmentmasszázs (60 perc)'
        },
        {
          key: 'csipo-izulet',
          name: 'Csípőízület (Coxarthrosis)',
          pin: { x: 76, y: 62 },
          pinFemale: { x: 74, y: 56 },
          title: 'Csípőízületi Kopás & Csípőforgatási Kötöttség',
          latin: 'Articulatio coxae & Tensor fasciae latae',
          badge: 'Csípőízület',
          symptoms: [
            'Lépéskor fellépő csípőtáji kattogás vagy szúró érzés',
            'Csípő ki- és beforgatásának beszűkülése',
            'Comb külső oldalára sugárzó feszülés'
          ],
          causes: 'Csípőízületi letapadások, porckopásos folyamatok, combpólya feszültség.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs (45–60 perc)'
        }
      ]
    },

    'nyak': {
      name: 'Nyak & Tarkó',
      img: 'assets/img/anatomy-region-fej.webp',
      imgFemale: 'assets/img/anatomy-region-fej-female.webp',
      title: 'Részletes Nyak, Tarkó & Fejöv Anatómia',
      subHotspots: [
        {
          key: 'nyak-izom',
          name: 'Nyakizom (Sternocleidomastoideus)',
          pin: { x: 56, y: 64 },
          pinFemale: { x: 62, y: 72 },
          title: 'Nyaki Feszültség & Nyakmerevség',
          latin: 'Regio cervicalis & Musculus Sternocleidomastoideus',
          badge: 'Nyakizomzat',
          symptoms: ['Fejfordítási korlátozottság', 'Nyakoldali és kulcscsonti szúró fájdalom', 'Vállövbe sugárzó merevség'],
          causes: 'Huzat, rossz alvási pozíció, tech-neck (képernyőnézés).',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs (30–45 perc)'
        },
        {
          key: 'nyak-tarko',
          name: 'Tarkó & Koponyaalap',
          pin: { x: 68, y: 38 },
          pinFemale: { x: 74, y: 44 },
          title: 'Tarkótáji Tenziós Nyomás',
          latin: 'Pars descendens & Occiput',
          badge: 'Tarkó & Koponya',
          symptoms: ['Tarkóból koponyába sugárzó nyomó fejfájás', 'Szédülékenység és látási fáradtság érzése', 'Görnyedt tartás miatti nyak-koponya átmenti blokk'],
          causes: 'Stressz, nyaki gerinc alsó és felső szakaszának feszültsége.',
          treatmentKey: 'arcmasszazs',
          treatmentName: 'Arc- és nyakmasszázs — Gyógyászati reflexoldás (20–30 perc)'
        },
        {
          key: 'nyak-trapez',
          name: 'Csuklyásizom eredés (Trapezius)',
          pin: { x: 74, y: 84 },
          pinFemale: { x: 78, y: 80 },
          title: 'Vállöv-Nyaki Izomcsomó',
          latin: 'Musculus Trapezius pars superior',
          badge: 'Váll-Nyaköv',
          symptoms: ['Feszes izomkötél a nyak és váll találkozásánál', 'Vállfelhúzás miatti fáradtság'],
          causes: 'Ülőmunka, stressz, nehéz táska hordása.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs (30–60 perc)'
        }
      ]
    },

    'fej': {
      name: 'Arc, Állkapocs & Fej',
      img: 'assets/img/anatomy-region-fej.webp',
      imgFemale: 'assets/img/anatomy-region-fej-female.webp',
      title: 'Részletes Arc & Fejöv Anatómia',
      subHotspots: [
        {
          key: 'fej-tenzios',
          name: 'Halánték & Homlok',
          pin: { x: 45, y: 15 },
          pinFemale: { x: 55, y: 15 },
          title: 'Tenziós Fejfájás & Homloki Feszültség',
          latin: 'Musculus Temporalis & Frontalis',
          badge: 'Koponya-halánték',
          symptoms: ['Abroncsszerű szorító fejfájás a halántéknál', 'Szem körüli feszülés és nyomás'],
          causes: 'Krónikus stressz, szellemi kimerültség, képernyőhasználat.',
          treatmentKey: 'arcmasszazs',
          treatmentName: 'Arcmasszázs — Gyógyászati reflexoldás (20–30 perc)'
        },
        {
          key: 'fej-ragoizom',
          name: 'Állkapocs & Rágóizom',
          pin: { x: 38, y: 44 },
          pinFemale: { x: 52, y: 44 },
          title: 'Rágóizom Görcs & Bruxizmus (Fogszorítás)',
          latin: 'Musculus Masseter & Temporalis',
          badge: 'Állkapocs',
          symptoms: ['Éjszakai fogszorítás, fogcsikorgatás', 'Kattogó állkapocsízület felébredéskor', 'Fül mögé sugárzó rágóizom merevség'],
          causes: 'Stressz, állkapocsízület túlterhelése.',
          treatmentKey: 'arcmasszazs',
          treatmentName: 'Arcmasszázs — Gyógyászati reflexoldás (20–30 perc)'
        }
      ]
    },

    'torzs': {
      name: 'Mellkas & Has',
      img: 'assets/img/anatomy-region-torzs.webp',
      imgFemale: 'assets/img/anatomy-region-torzs-female.webp',
      title: 'Részletes Mellkas & Has Anatómia',
      subHotspots: [
        {
          key: 'torzs-mell',
          name: 'Nagy Mellizom (Pectoralis)',
          pin: { x: 34, y: 24 },
          pinFemale: { x: 35, y: 22 },
          title: 'Mellizom Rövidülés & Vállelőreesés',
          latin: 'Musculus Pectoralis major & minor',
          badge: 'Mellkas',
          symptoms: ['Előreeső vállak és görnyedt tartás', 'Beszűkült mellkasi légzés', 'Mellkas előoldali feszülése'],
          causes: 'Görnyedt ülőmunka, számítógépezés.',
          treatmentKey: 'kotoszoveti',
          treatmentName: 'Kötőszöveti masszázs (60 perc)'
        },
        {
          key: 'torzs-borda',
          name: 'Bordaközi izmok (Intercostalis)',
          pin: { x: 72, y: 44 },
          pinFemale: { x: 68, y: 48 },
          title: 'Bordaközi Izomfeszültség',
          latin: 'Musculi intercostales',
          badge: 'Bordakosár',
          symptoms: ['Mély belégzéskor fellépő bordaközi szúrás', 'Mellkasi szorító érzet (kivizsgált esetekben)'],
          causes: 'Stresszes felületes légzés, bordaközi húzódás.',
          treatmentKey: 'szegmentmasszazs',
          treatmentName: 'Szegmentmasszázs (60 perc)'
        },
        {
          key: 'torzs-has',
          name: 'Egyenes Hasizom (Rectus abdominis)',
          pin: { x: 50, y: 62 },
          pinFemale: { x: 50, y: 64 },
          title: 'Hasi Feszültség & Visceralis Görcs',
          latin: 'Musculus Rectus abdominis',
          badge: 'Törzs / Hasfal',
          symptoms: ['Hasi feszülés és puffadásos nyomás', 'Gyomorszáj körüli stresszes görcsösség'],
          causes: 'Stressz, emésztési nyomás, kevés mozgás.',
          treatmentKey: 'szegmentmasszazs',
          treatmentName: 'Szegmentmasszázs / Gyógymasszázs (60 perc)'
        },
        {
          key: 'torzs-ferde',
          name: 'Ferde Hasizom (Obliquus)',
          pin: { x: 70, y: 76 },
          pinFemale: { x: 68, y: 76 },
          title: 'Törzsforgatási Kötöttség & Csípőfeletti Feszülés',
          latin: 'Musculus Obliquus externus abdominis',
          badge: 'Oldalsó törzs',
          symptoms: ['Törzsforgatáskor fellépő oldalsó feszülés', 'Csípőfeletti izomkötöttség'],
          causes: 'Egyoldalú terhelés, rotációs mozdulatok.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs (45–60 perc)'
        }
      ]
    },

    'talp': {
      name: 'Boka, Sarok & Talp',
      img: 'assets/img/anatomy-region-talp.webp',
      imgFemale: 'assets/img/anatomy-region-talp-female.webp',
      title: 'Részletes Boka, Sarok & Talp Anatómia',
      subHotspots: [
        {
          key: 'talp-achilles',
          name: 'Achilles-ín',
          pin: { x: 21, y: 46 },
          pinFemale: { x: 20, y: 44 },
          title: 'Achilles-ín Merevség & Feszülés',
          latin: 'Tendo Achillis & Peritendinitis',
          badge: 'Achilles-ín',
          symptoms: [
            'Achilles-ín húzódása és merevsége lépcsőzéskor vagy futáskor',
            'Feszülő, csomós érzet a sarokcsont feletti ín szakaszon',
            'Reggeli indítási merevség és fájdalom az első lépéseknél'
          ],
          causes: 'Vádliizomzat túlfeszülése, sportolás előtti nyújtás hiánya, merev cipőviselet, futóterhelés.',
          treatmentKey: 'gyogymasszazs',
          treatmentName: 'Gyógymasszázs / Svédmasszázs (30–45 perc)'
        },
        {
          key: 'talp-boka',
          name: 'Boka & Szalagok',
          pin: { x: 58, y: 52 },
          pinFemale: { x: 59, y: 52 },
          title: 'Bokaízületi Kötöttség & Szalaghúzódás Utókezelése',
          latin: 'Articulatio talocruralis & Ligamentum talofibulare',
          badge: 'Bokaízület',
          symptoms: [
            'Boka körüli tompa feszülés vagy mozgásbeszűkülés lépéskor',
            'Korábbi bokaficam vagy szalaghúzódás utáni krónikus letapadás',
            'Boka körüli keringési nehézség, nehézláb-érzet'
          ],
          causes: 'Korábbi rándulás, instabil bokaízület, tartós állómunka, nyirokkeringési lassulás.',
          treatmentKey: 'nyirokmasszazs',
          treatmentName: 'Nyirokmasszázs / Gyógymasszázs (30–45 perc)'
        },
        {
          key: 'talp-sarok',
          name: 'Sarokcsont & Sarkantyú',
          pin: { x: 22, y: 84 },
          pinFemale: { x: 22, y: 82 },
          title: 'Sarokcsonti Fájdalom & Saroktövis (Sarkantyú)',
          latin: 'Calcar calcanei & Tuber calcanei',
          badge: 'Sarokcsont & Ín',
          symptoms: [
            'Szúró, éles fájdalom a sarok talpi vagy hátsó részén testsúlyterheléskor',
            'Nehézkes testsúlyráhelyezés lépéskor, sarokfájdalom reggel',
            'Sarokcsont körüli gyulladásos kötöttség és nyomásérzékenység'
          ],
          causes: 'Tartós túlterhelés, sarokcsonti csontlerakódás, vádli és Achilles-ín megrövidülése.',
          treatmentKey: 'talpmasszazs',
          treatmentName: 'Gyógyászati Talpmasszázs / Gyógymasszázs (30–45 perc)'
        },
        {
          key: 'talp-fascia',
          name: 'Talpi Bőnye & Boltozat',
          pin: { x: 64, y: 85 },
          pinFemale: { x: 65, y: 84 },
          title: 'Talpi Bőnyegyulladás (Plantar Fasciitis) & Boltozati Fájdalom',
          latin: 'Fasciitis plantaris & Aponeurosis plantaris',
          badge: 'Talpi Fascia & Boltozat',
          symptoms: [
            'Reggeli első lépéseknél jelentkező éles, szúró talpfájdalom',
            'Hosszabb állás vagy séta után égő feszülés a talp hosszanti vagy harántboltozatában',
            'Feszes, letapadt talpi kötőszövet és fáradékony lábfej'
          ],
          causes: 'Lúdtalp, harántsüllyedés, kemény talajon járás, nem megfelelő lábbeli, tartós túlterhelés.',
          treatmentKey: 'talpmasszazs',
          treatmentName: 'Gyógyászati Talpmasszázs / Kötőszöveti masszázs (30–40 perc)'
        }
      ]
    }
  };

  var anatomyState = {
    gender: 'female',
    view: 'front',
    level: 1, // 1: Full body, 2: Region Zoom
    currentRegionGroupKey: null,
    selectedSubSpot: null
  };

  var anatomyImg = $('#anatomy-img');
  var anatomySvg = $('#anatomy-svg');
  var anatomyHotspotsLayer = $('#anatomy-hotspots-layer');
  var anatomyPillsContainer = $('#anatomy-pills');
  var anatomyBackBtn = $('#anatomy-back-btn');
  var anatomyStageTitle = $('#anatomy-stage-title');
  var acRegionBadge = $('#ac-region-badge');
  var acTitle = $('#ac-title');
  var acLatin = $('#ac-latin');
  var acBody = $('#ac-body');
  var acFooter = $('#ac-footer');
  var acBookBtn = $('#ac-book-btn');
  var resetViewBtn = $('#anatomy-reset-view');

  var acHeader = $('.anatomy-card__header');

  function updateAnatomyImgSrc(targetSrc) {
    if (!anatomyImg) return;
    if (anatomyImg.getAttribute('data-active-src') === targetSrc) return;

    anatomyImg.setAttribute('data-active-src', targetSrc);
    anatomyImg.classList.add('is-changing');

    var temp = new Image();
    temp.onload = function () {
      anatomyImg.src = targetSrc;
      requestAnimationFrame(function () {
        setTimeout(function () {
          anatomyImg.classList.remove('is-changing');
        }, 30);
      });
    };
    temp.src = targetSrc;
  }

  function triggerCardAnimation() {
    if (acBody) {
      acBody.classList.remove('is-animating');
      void acBody.offsetWidth;
      acBody.classList.add('is-animating');
    }
    if (acHeader) {
      acHeader.classList.remove('is-animating');
      void acHeader.offsetWidth;
      acHeader.classList.add('is-animating');
    }
  }

  function renderAnatomyView() {
    if (!anatomyImg || !anatomySvg || !anatomyHotspotsLayer) return;

    anatomySvg.innerHTML = '';
    anatomyHotspotsLayer.innerHTML = '';

    if (anatomyPillsContainer) anatomyPillsContainer.innerHTML = '';

    if (anatomyState.level === 1) {
      // LEVEL 1: Teljes test nézet
      if (anatomyBackBtn) {
        anatomyBackBtn.hidden = true;
        anatomyBackBtn.style.display = 'none';
      }
      if (anatomyStageTitle) anatomyStageTitle.textContent = 'Teljes test izomanatómia';

      var imgSrc = 'assets/img/anatomy-' + anatomyState.gender + '-' + anatomyState.view + '.webp';
      updateAnatomyImgSrc(imgSrc);

      // Filter main region keys for current view
      var mainKeys = Object.keys(FULL_BODY_MAIN_REGIONS).filter(function (key) {
        return FULL_BODY_MAIN_REGIONS[key].view === anatomyState.view;
      });

      mainKeys.forEach(function (key, idx) {
        var regionDef = FULL_BODY_MAIN_REGIONS[key];
        var targetGroupKey = regionDef.groupKey || key;
        var animDelay = (idx * 50) + 'ms';

        // Leader line SVG path
        var path = null;
        if (regionDef.svgPath) {
          path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', regionDef.svgPath);
          path.setAttribute('class', 'leader-line');
          path.setAttribute('data-key', key);
          path.style.animationDelay = animDelay;
          path.addEventListener('click', function () { enterRegionGroup(targetGroupKey); });
          anatomySvg.appendChild(path);
        }

        // Target dot SVG circle
        var dot = null;
        if (regionDef.target) {
          dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('cx', regionDef.target.x);
          dot.setAttribute('cy', regionDef.target.y);
          dot.setAttribute('r', '6');
          dot.setAttribute('class', 'leader-dot');
          dot.setAttribute('data-key', key);
          dot.style.animationDelay = animDelay;
          dot.addEventListener('click', function () { enterRegionGroup(targetGroupKey); });
          anatomySvg.appendChild(dot);
        }

        // Callout Pin Button on Outer Margin (Left/Right)
        if (regionDef.label) {
          var pin = document.createElement('button');
          pin.type = 'button';
          pin.className = 'anatomy-pin anatomy-pin--' + regionDef.side;
          pin.style.left = (regionDef.label.x / 800 * 100) + '%';
          pin.style.top = (regionDef.label.y / 900 * 100) + '%';
          pin.style.animationDelay = animDelay;
          pin.textContent = regionDef.name;
          pin.setAttribute('data-key', key);

          // Synchronized hover effects
          pin.addEventListener('mouseenter', function () {
            if (path) path.classList.add('is-active');
            if (dot) dot.classList.add('is-active');
          });
          pin.addEventListener('mouseleave', function () {
            if (path) path.classList.remove('is-active');
            if (dot) dot.classList.remove('is-active');
          });

          if (path) {
            path.addEventListener('mouseenter', function () {
              pin.classList.add('is-active');
              if (dot) dot.classList.add('is-active');
            });
            path.addEventListener('mouseleave', function () {
              pin.classList.remove('is-active');
              if (dot) dot.classList.remove('is-active');
            });
          }

          pin.addEventListener('click', function () { enterRegionGroup(targetGroupKey); });
          anatomyHotspotsLayer.appendChild(pin);
        }

        // Pill Button
        if (anatomyPillsContainer) {
          var pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'anatomy-pill';
          pill.textContent = regionDef.name;
          pill.addEventListener('click', function () { enterRegionGroup(targetGroupKey); });
          anatomyPillsContainer.appendChild(pill);
        }
      });

    } else if (anatomyState.level === 2) {
      // LEVEL 2: Részletes Régió Nézet (Zoom)
      if (anatomyBackBtn) {
        anatomyBackBtn.hidden = false;
        anatomyBackBtn.style.display = 'inline-flex';
      }

      var groupDef = REGION_GROUPS[anatomyState.currentRegionGroupKey];
      if (!groupDef) { resetToFullBody(); return; }

      if (anatomyStageTitle) anatomyStageTitle.textContent = groupDef.title;
      var regionImgSrc = (anatomyState.gender === 'female' && groupDef.imgFemale) ? groupDef.imgFemale : groupDef.img;
      updateAnatomyImgSrc(regionImgSrc);

      // Render Sub-Hotspots / Sub-Pins
      groupDef.subHotspots.forEach(function (subItem, idx) {
        var isSelected = (anatomyState.selectedSubSpot && anatomyState.selectedSubSpot.key === subItem.key);

        var pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'anatomy-pin' + (isSelected ? ' is-active' : '');
        var pinPos = (anatomyState.gender === 'female' && subItem.pinFemale) ? subItem.pinFemale : subItem.pin;
        pin.style.left = pinPos.x + '%';
        pin.style.top = pinPos.y + '%';
        pin.style.animationDelay = (idx * 65) + 'ms';
        pin.textContent = subItem.name;
        pin.addEventListener('click', function () { selectSubSpot(subItem); });
        anatomyHotspotsLayer.appendChild(pin);

        if (anatomyPillsContainer) {
          var pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'anatomy-pill' + (isSelected ? ' is-active' : '');
          pill.textContent = subItem.name;
          pill.addEventListener('click', function () { selectSubSpot(subItem); });
          anatomyPillsContainer.appendChild(pill);
        }
      });
    }
  }

  function enterRegionGroup(groupKey) {
    var groupDef = REGION_GROUPS[groupKey];
    if (!groupDef) return;

    anatomyState.level = 2;
    anatomyState.currentRegionGroupKey = groupKey;
    anatomyState.selectedSubSpot = null;

    // Set Card UI for Region Overview
    if (acRegionBadge) acRegionBadge.textContent = 'Részletes Nézet: ' + groupDef.name;
    if (acTitle) acTitle.textContent = groupDef.title;
    if (acLatin) acLatin.textContent = 'Válassza ki a pontos fájdalmas vagy kötött pontot!';

    if (acBody) {
      acBody.innerHTML = '<div class="anatomy-placeholder">' +
        '<div class="anatomy-placeholder__icon"><svg viewBox="0 0 44 44" fill="none"><circle cx="22" cy="22" r="20" stroke="currentColor" stroke-opacity=".28"/><path d="M22 35V13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M22 16.5c-1.2-3.4-3.4-5-6.6-4.9.1 3.4 2.3 5.3 6.6 4.9Z" fill="currentColor" fill-opacity=".9"/><path d="M22 22c-1.4-3.9-3.9-5.8-7.5-5.6.1 3.9 2.6 6 7.5 5.6Z" fill="currentColor" fill-opacity=".65"/></svg></div>' +
        '<p class="anatomy-placeholder__text">Kattintson a részletes ábrán lévő pontokra (pl. ' + groupDef.subHotspots.map(function (s) { return s.name; }).join(', ') + ') a specifikus orvosi panasz leírásáért!</p>' +
        '</div>';
    }

    if (acFooter) acFooter.hidden = true;
    triggerCardAnimation();
    renderAnatomyView();
  }

  var COMPLAINT_BADGES = {
    'kar-vall': 'Lehetséges panaszok a vállnál:',
    'kar-felkar': 'Lehetséges panaszok a felkarnál:',
    'kar-konyok': 'Lehetséges panaszok a könyöknél:',
    'kar-alkar': 'Lehetséges panaszok az alkarnál és kézfejnél:',
    'lab-comb': 'Lehetséges panaszok a combnál:',
    'lab-terd': 'Lehetséges panaszok a térdnél:',
    'lab-vadli': 'Lehetséges panaszok a lábszárnál (vádlinál):',
    'lab-achilles': 'Lehetséges panaszok a bokánál és Achilles-ínnál:',
    'hat-trapez': 'Lehetséges panaszok a váll- és nyakövnél:',
    'hat-lapocka': 'Lehetséges panaszok a felső hátnál és lapockánál:',
    'hat-lumbago': 'Lehetséges panaszok az alsó hátnál (deréknál):',
    'hat-isiasz': 'Lehetséges panaszok az ágyéki szakasznál és ülőidegnél:',
    'csipo-piriformis': 'Lehetséges panaszok a farizomnál:',
    'csipo-iliopsoas': 'Lehetséges panaszok a medencénél és SI ízületnél:',
    'csipo-izulet': 'Lehetséges panaszok a csípőízületnél:',
    'nyak-izom': 'Lehetséges panaszok a nyaknál:',
    'nyak-tarko': 'Lehetséges panaszok a tarkónál és koponyánál:',
    'nyak-trapez': 'Lehetséges panaszok a váll- és nyakövnél:',
    'fej-tenzios': 'Lehetséges panaszok a halántéknál és homloknál:',
    'fej-ragoizom': 'Lehetséges panaszok az állkapocsnál:',
    'torzs-mell': 'Lehetséges panaszok a mellkasnál:',
    'torzs-borda': 'Lehetséges panaszok a bordakosárnál:',
    'torzs-has': 'Lehetséges panaszok a hasfalnál és törzsnél:',
    'torzs-ferde': 'Lehetséges panaszok az oldalsó törzsnél:',
    'talp-achilles': 'Lehetséges panaszok az Achilles-ínnál:',
    'talp-boka': 'Lehetséges panaszok a bokaízületnél:',
    'talp-sarok': 'Lehetséges panaszok a saroknál és sarkantyúnál:',
    'talp-fascia': 'Lehetséges panaszok a talpnál és boltozatnál:'
  };

  function selectSubSpot(subItem) {
    anatomyState.selectedSubSpot = subItem;

    // Update Card UI
    var badgeText = (subItem.key && COMPLAINT_BADGES[subItem.key]) ? COMPLAINT_BADGES[subItem.key] : ('Lehetséges panaszok a(z) ' + (subItem.badge || subItem.name) + ' helyen:');
    if (acRegionBadge) acRegionBadge.textContent = badgeText;
    if (acTitle) acTitle.textContent = subItem.title;
    if (acLatin) acLatin.textContent = subItem.latin;

    if (acBody) {
      var html = '<div class="anatomy-info-group">' +
        '<p class="anatomy-info-label"><svg class="ico ico--xs" aria-hidden="true"><use href="#ico-warn"></use></svg> Jellemző tünetek és panaszok</p>' +
        '<ul class="anatomy-symptoms-list">' +
        subItem.symptoms.map(function (s) { return '<li>' + s + '</li>'; }).join('') +
        '</ul></div>' +
        '<div class="anatomy-info-group">' +
        '<p class="anatomy-info-label"><svg class="ico ico--xs" aria-hidden="true"><use href="#ico-doc"></use></svg> Kiváltó okok</p>' +
        '<p class="anatomy-info-text">' + subItem.causes + '</p>' +
        '</div>' +
        '<div class="anatomy-info-group">' +
        '<p class="anatomy-info-label"><svg class="ico ico--xs" aria-hidden="true"><use href="#ico-check"></use></svg> Javasolt gyógymasszázs kezelés</p>' +
        '<span class="anatomy-treatment-chip"><svg class="ico ico--xs" aria-hidden="true"><use href="#ico-gyogy"></use></svg> ' + subItem.treatmentName + '</span>' +
        '</div>';
      acBody.innerHTML = html;
    }

    if (acFooter) acFooter.hidden = false;
    triggerCardAnimation();
    renderAnatomyView();
  }

  function resetToFullBody() {
    anatomyState.level = 1;
    anatomyState.currentRegionGroupKey = null;
    anatomyState.selectedSubSpot = null;

    if (acRegionBadge) acRegionBadge.textContent = 'Lehetséges panaszok az érintett területen:';
    if (acTitle) acTitle.textContent = 'Kattintson egy izomcsoportra';
    if (acLatin) acLatin.textContent = 'Anatomia musculorum';
    if (acBody) {
      acBody.innerHTML = '<div class="anatomy-placeholder">' +
        '<div class="anatomy-placeholder__icon"><svg viewBox="0 0 44 44" fill="none"><circle cx="22" cy="22" r="20" stroke="currentColor" stroke-opacity=".28"/><path d="M22 35V13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M22 16.5c-1.2-3.4-3.4-5-6.6-4.9.1 3.4 2.3 5.3 6.6 4.9Z" fill="currentColor" fill-opacity=".9"/><path d="M22 22c-1.4-3.9-3.9-5.8-7.5-5.6.1 3.9 2.6 6 7.5 5.6Z" fill="currentColor" fill-opacity=".65"/></svg></div>' +
        '<p class="anatomy-placeholder__text">Kattintson a teljes ábrán látható gombokra (pl. Kar, Nyak, Hát, Láb, Csípő, Talp) a részletes izomanatómia megnyitásához!</p>' +
        '</div>';
    }
    if (acFooter) acFooter.hidden = true;
    triggerCardAnimation();
    renderAnatomyView();
  }

  // Gender & View toggle buttons
  $$('.anatomy-btn[data-gender]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $$('.anatomy-btn[data-gender]').forEach(function (b) {
        b.classList.remove('is-active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', 'true');
      anatomyState.gender = btn.getAttribute('data-gender');
      renderAnatomyView();
    });
  });

  $$('.anatomy-btn[data-view]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $$('.anatomy-btn[data-view]').forEach(function (b) {
        b.classList.remove('is-active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', 'true');
      anatomyState.view = btn.getAttribute('data-view');
      renderAnatomyView();
    });
  });

  if (anatomyBackBtn) {
    anatomyBackBtn.addEventListener('click', resetToFullBody);
  }

  if (resetViewBtn) {
    resetViewBtn.addEventListener('click', resetToFullBody);
  }

  // Booking button inside anatomy card
  if (acBookBtn) {
    acBookBtn.addEventListener('click', function () {
      if (!anatomyState.selectedSubSpot) return;
      var item = anatomyState.selectedSubSpot;

      if (form && form.hidden && result) {
        result.hidden = true;
        form.hidden = false;
      }

      if (treatmentSel && TREATMENTS[item.treatmentKey]) {
        treatmentSel.value = item.treatmentKey;
        fillDurations(item.treatmentKey, false);
        clearError(treatmentSel);
      }

      var msgInput = $('#f-message');
      if (msgInput) {
        var note = 'Érintett terület / panasz: ' + item.name + ' — ' + item.title + ' (' + item.latin + ')';
        if (msgInput.value.indexOf(item.name) === -1) {
          msgInput.value = msgInput.value ? msgInput.value + '\n\n' + note : note;
        }
      }

      var target = $('#idopontfoglalas');
      if (target) {
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }

      window.setTimeout(function () {
        var nameField = $('#f-name');
        if (nameField && !nameField.value) nameField.focus({ preventScroll: true });
        else if (durationSel && !durationSel.disabled) durationSel.focus({ preventScroll: true });
      }, reduceMotion ? 0 : 650);
    });
  }

  /* ── 11. ÁRLISTA A KISZOLGÁLÓRÓL ──────────────────────────────────────────
     Az „Áraink” táblázat a `/api/prices` válaszából épül újra, hogy az admin
     felületen átírt összegek azonnal itt legyenek. A HTML-ben lévő táblázat
     TARTALÉK: azt látja, akinél nem fut a JavaScript, és az marad a képernyőn,
     ha a kiszolgáló nem válaszol.

     Ugyanez az adat állítja be a foglalási űrlap választható hosszait is.
     Korábban ez a lista két helyen élt (a táblázatban és a TREATMENTS
     konstansban), és külön kellett karbantartani őket — ami előbb-utóbb azt
     jelentette volna, hogy a vendég olyan hosszt választ, aminek nincs ára. */

  /* „8900” → „8 900 Ft”. A hármas csoportok között nem törhető szóköz áll,
     hogy az összeg soha ne szakadjon két sorba. */
  function formatFt(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ft';
  }

  function priceCell(value) {
    var td = document.createElement('td');
    if (value == null) {
      td.className = 'na';
      td.setAttribute('aria-label', 'nem elérhető');
      td.textContent = '—';
    } else {
      td.textContent = formatFt(value);
    }
    return td;
  }

  function renderPriceTable(data) {
    var table = $('.price-table');
    if (!table) return;

    var thead = table.tHead;
    var tbody = table.tBodies[0];
    if (!thead || !tbody) return;

    /* ── Fejléc ── */
    thead.textContent = '';
    var headRow = document.createElement('tr');

    var nameHead = document.createElement('th');
    nameHead.scope = 'col';
    nameHead.className = 'price-table__name';
    nameHead.textContent = 'Kezelés';
    headRow.appendChild(nameHead);

    data.durations.forEach(function (min) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = min + ' perc';
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    /* ── Sorok ── */
    tbody.textContent = '';
    data.treatments.forEach(function (treatment) {
      var tr = document.createElement('tr');

      var rowHead = document.createElement('th');
      rowHead.scope = 'row';

      /* A kezelés neve a saját szakaszára ugrik, ha van hozzá horgony. */
      var label = treatment.anchor
        ? document.createElement('a')
        : document.createElement('span');
      if (treatment.anchor) label.href = '#' + treatment.anchor;
      label.textContent = treatment.name;

      if (treatment.footnote) {
        var mark = document.createElement('span');
        mark.className = 'price-table__mark';
        mark.textContent = '*';
        label.appendChild(mark);
      }
      rowHead.appendChild(label);
      tr.appendChild(rowHead);

      data.durations.forEach(function (min) {
        tr.appendChild(priceCell(treatment.prices[min]));
      });
      tbody.appendChild(tr);
    });

    /* ── Megjegyzések a táblázat alatt ── */
    var notes = $('.price-notes');
    if (notes) {
      notes.textContent = '';
      data.notes.forEach(function (note) {
        var li = document.createElement('li');
        if (note.mark) {
          var star = document.createElement('span');
          star.className = 'price-table__mark';
          star.textContent = '*';
          li.appendChild(star);
          li.appendChild(document.createTextNode(' '));
        }
        li.appendChild(document.createTextNode(note.text));
        notes.appendChild(li);
      });
      notes.hidden = data.notes.length === 0;
    }
  }

  /* ── A foglalási űrlap kínálata ─────────────────────────────────────────
     Egy kezeléshez pontosan azok a hosszak kérhetők, amelyekhez ár tartozik
     — és csak azok a kezelések jelennek meg, amelyek egyáltalán szerepelnek
     az árlistában. Ezt a listát a kiszolgáló állítja össze
     (`/api/booking/options`), ugyanabból az adatból, amiből a foglalást is
     ellenőrzi. Korábban a `TREATMENTS` állandó és az árlista két külön
     karbantartott lista volt: előbb-utóbb olyan kezelést kínált volna az
     űrlap, amit a naptár nem fogad el. */
  function applyServices(services) {
    var byKey = {};
    services.forEach(function (service) {
      byKey[service.key] = {
        name: service.name,
        durations: service.durations.slice(),
        prices: service.prices || null
      };
    });

    /* A régi kulcsokat is eldobjuk: ami már nincs az árlistában, az ne
       maradjon ott a listában sem. */
    Object.keys(TREATMENTS).forEach(function (key) { delete TREATMENTS[key]; });
    Object.keys(byKey).forEach(function (key) { TREATMENTS[key] = byKey[key]; });

    if (!treatmentSel) return;

    /* A kezelésválasztó újraépítése. A látogató esetleges választását
       megtartjuk, ha még mindig létezik. */
    var previous = treatmentSel.value;
    treatmentSel.innerHTML = '';
    treatmentSel.appendChild(new Option('Válasszon kezelést…', ''));
    services.forEach(function (service) {
      treatmentSel.appendChild(new Option(service.name, service.key));
    });

    treatmentSel.value = previous;
    if (treatmentSel.selectedIndex < 0) treatmentSel.value = '';
    fillDurations(treatmentSel.value, true);
  }

  function loadBookingOptions() {
    if (!window.fetch) return;
    fetch('/api/booking/options?site=masszazs', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!data || !data.ok || !Array.isArray(data.services) || !data.services.length) return;
        applyServices(data.services);

        /* Meddig lehet előre foglalni — a kiszolgáló mondja meg. */
        if (dateInput && data.horizonDays) {
          dateInput.max = isoDay(new Date(Date.now() + data.horizonDays * 86400000));
        }
      })
      .catch(function () {
        /* Nincs kiszolgáló: marad a HTML-ben lévő lista és a beépített
           hosszak. Foglalni ilyenkor úgysem lehet — a beküldés az
           e-mailes útra vált, és ezt meg is mondja a látogatónak. */
      });
  }

  function loadPrices() {
    if (!window.fetch) return;
    fetch('/api/prices', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!data || !data.ok || !Array.isArray(data.treatments) || !data.treatments.length) return;
        renderPriceTable(data);
      })
      .catch(function () {
        /* Nincs kiszolgáló vagy nincs hálózat — a HTML-ben lévő tartalék
           táblázat marad. A látogató szempontjából az oldal működik. */
      });
  }

  loadBookingOptions();
  loadPrices();

  // Initialize Anatomy Module
  renderAnatomyView();
})();


