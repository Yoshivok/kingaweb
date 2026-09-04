/* ═══════════════════════════════════════════════════════════════════════════
   MANULA-OPTIC MED. — összekötő oldal vezérlése
   ─────────────────────────────────────────────────────────────────────────
   Ez a fájl korábban több mint ezer sor volt. Nem azért, mert a választó
   bonyolult — hanem mert mindkét teljes weboldalt <iframe>-ben futtatta egy
   háromsávos keretben, és ezt kellett életben tartania: panelparkolás,
   postMessage-hidak oda-vissza, Escape- és görgetésátvezetés, hero-pozíció
   jelzés, előtöltés-ütemezés, három teljesítményszint, képkocka-mérés és
   önszabályozás. Az akadások és a hibák ebből a gépezetből jöttek, nem a
   látványból.

   Most a két oldal SAJÁT lapként nyílik meg. Ami maradt:

     • belépő animáció (osztálycsere, a többi a stíluslapé)
     • egérkövető parallax három rétegen
     • a fél fölé érve: előtöltés `prefetch`-csel és hover-állapot
     • kattintásra: a lapváltást a böngésző úsztatja át (View Transitions),
       ahol pedig ezt nem ismeri, marad a saját kicsúszó animáció

   Egyetlen képkockánként futó hurok sincs benne. Minden mozgást a stíluslap
   ír le, azt pedig a compositor rajzolja — a fő szálon képkockánként nulla
   munka történik. Ezért nem tud akadni.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var body = document.body;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── DÍSZSZINT ────────────────────────────────────────────────────────────
     Egyszer dől el, induláskor, a gép bevallott adottságaiból — és utána soha
     nem változik. A korábbi változat képkockaidőt mért ablakokra bontva, és
     menet közben kapcsolgatott szintet: ez maga is költség volt, ráadásul épp
     a legterheltebb pillanatban mért, tehát rendszeresen rosszul döntött.
     Egy statikus, olcsó döntés megbízhatóbb. */
  function lowPower() {
    var cores = navigator.hardwareConcurrency || 0;
    var mem = navigator.deviceMemory || 0;      /* csak Chromiumban van */
    return (cores > 0 && cores <= 2) || (mem > 0 && mem <= 2);
  }

  if (lowPower()) body.classList.add('is-lowfx');
  else if (!reduced) body.classList.add('fx-high');

  /* ── BELÉPŐ ANIMÁCIÓ ─────────────────────────────────────────────────────
     Két képkocka után vesszük le az `is-booting`-ot: az első kirajzolás így
     még a kiindulási állapottal történik meg, és nem villan be a kész kép.
     Az `is-live` a hosszú belépő után jön; onnantól élnek a rövidebb,
     mozgékonyabb átmenetek. */
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { body.classList.remove('is-booting'); });
  });
  setTimeout(function () { body.classList.add('is-live'); }, reduced ? 0 : 2400);

  var halves = Array.prototype.slice.call(document.querySelectorAll('.half'));

  /* ── EGÉRKÖVETŐ PARALLAX ─────────────────────────────────────────────────
     A `--px/--py` értéket pontosan az a három réteg kapja meg, amelyik mozog
     tőle. Szándékosan NEM a közös szülő: egy egyéni tulajdonság megváltoztatása
     a teljes részfa stílusát újraszámoltatja, ami itt hatvan elemet jelentene
     minden egérmozdulatnál. A stíluslap `@property` deklarációja
     (`inherits: false`) zárja ki, hogy a gyerekekre is átterjedjen. */
  if (!reduced && !body.classList.contains('is-lowfx')
      && window.matchMedia('(hover: hover)').matches) {

    var layers = [];
    ['.orn--left', '.orn--right', '.medallion'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) layers.push(el);
    });

    var parX = 0, parY = 0, parRaf = null;

    var applyPar = function () {
      parRaf = null;
      for (var i = 0; i < layers.length; i++) {
        layers[i].style.setProperty('--px', parX);
        layers[i].style.setProperty('--py', parY);
      }
    };

    /* A mutató helyét csak eltároljuk; az írás képkockánként egyszer történik,
       nem minden egérmozgás-eseménynél. */
    document.addEventListener('pointermove', function (e) {
      parX = ((e.clientX / window.innerWidth) - 0.5).toFixed(4);
      parY = ((e.clientY / window.innerHeight) - 0.5).toFixed(4);
      if (!parRaf) parRaf = requestAnimationFrame(applyPar);
    }, { passive: true });

    document.addEventListener('pointerleave', function () {
      parX = 0; parY = 0;
      if (!parRaf) parRaf = requestAnimationFrame(applyPar);
    });
  }

  /* ── ELŐTÖLTÉS ───────────────────────────────────────────────────────────
     A régi felépítés azért töltötte be előre MINDKÉT weboldalt, hogy a váltás
     azonnali legyen — és épp ezzel lassította el a választót. A `prefetch`
     ugyanezt adja a töredékéért: a böngésző alacsony prioritással hozza le azt
     az EGYET, amelyik fölé a látogató ért. Nem futtatja, nem rajzolja, nem
     tart életben semmit — csak a gyorsítótárba teszi, hogy a kattintás után
     már ne kelljen hálózatra menni. */
  var prefetched = {};

  function prefetch(href) {
    if (!href || prefetched[href]) return;
    prefetched[href] = true;
    var link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = href;
    document.head.appendChild(link);
  }

  var canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  halves.forEach(function (half) {
    var target = half.getAttribute('data-target');
    var href = half.href || half.getAttribute('href');

    /* Egérrel rendelkező eszközökön: lebegés jelzése és előtöltés.
       Érintőkijelzőkön (telefon, tablet) szándékosan NEM figyelünk pointerenter-re,
       hogy a mobil Safari / Chrome soha ne kezelhesse lebegtetésként az érintést. */
    if (canHover) {
      ['pointerenter', 'focus'].forEach(function (evt) {
        half.addEventListener(evt, function () {
          prefetch(href);
          body.dataset.hover = target;
        });
      });

      ['pointerleave', 'blur'].forEach(function (evt) {
        half.addEventListener(evt, function () { delete body.dataset.hover; });
      });
    } else {
      /* Érintőkijelzőn az ujj hozzáérésekor azonnal indul a háttérbeli prefetch */
      half.addEventListener('touchstart', function () {
        prefetch(href);
      }, { passive: true });
    }

    /* Kattintáskor / koppintáskor azonnali vizuális visszajelzés.
       SZÁNDÉKOSAN NINCS e.preventDefault()!
       A böngésző natívan, megbízhatóan és azonnal követi a hivatkozást (<a href="...">),
       így semmilyen időzítő, in-app webview vagy felugró-védelem nem akaszthatja meg. */
    half.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      body.dataset.dir = (target === 'optika') ? 'left' : 'right';
      body.dataset.view = target;
      body.classList.add('is-moving');
    });
  });

  /* ── BILLENTYŰZET ────────────────────────────────────────────────────────
     A két fél sima hivatkozás, tehát Tabbal és Enterrel eleve működik. A
     nyilak kényelmi kiegészítés: a választón egyértelmű, mit jelent a „balra”
     és a „jobbra”. */
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || leaving) return;
    var i = e.key === 'ArrowLeft' ? 0 : e.key === 'ArrowRight' ? 1 : -1;
    if (i < 0 || !halves[i]) return;
    e.preventDefault();
    halves[i].focus();
  });

  /* A böngésző vissza gombjával a lap a gyorsítótárból jöhet elő, benne a
     kicsúszott állapottal — a látogató üres képernyőt látna. */
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    leaving = false;
    body.classList.remove('is-moving');
    body.dataset.view = 'chooser';
    delete body.dataset.dir;
    delete body.dataset.hover;
  });
})();
