/* ==========================================================================
   Lumina Optika — Kliensoldali Interaktivitás
   ========================================================================== */

/* ==========================================================================
   0. Keretben futás: mozgás felfüggesztése
   --------------------------------------------------------------------------
   Az összekötő oldal mindkét weboldalt egyszerre tartja betöltve, egymás
   melletti iframe-ekben. A képen kívüli panel `visibility: hidden`, de ez a
   GYERMEK dokumentumot nem állítja meg: a `document.hidden` ott továbbra is
   hamis, az IntersectionObserver pedig az iframe saját nézetmezejét figyeli —
   így a hero canvas a háttérben is végig 60 kép/mp-en futna. Két sötét,
   egész képernyős hero egyszerre annyi réteget tart a GPU-n, hogy a
   kompozitor időnként eldobja és újraépíti a felületet: ez a hero-n fekete
   villanásként látszik. A keret ezért üzen, ha ez a panel nincs a képen.
   ========================================================================== */
const frameMotion = {
  // A keret már a szkript indulása előtt ráteheti az osztályt a <html>-re,
  // ezért onnan olvassuk ki a kezdőállapotot. Önállóan megnyitva mindig aktív.
  active: !document.documentElement.classList.contains('is-frame-idle'),
  hooks: []
};

window.addEventListener('message', (ev) => {
  // Csak a beágyazó keret szólhat bele (a jelzés önmagában ártalmatlan)
  if (window.parent === window || ev.source !== window.parent) return;
  const data = ev.data;
  if (!data || data.type !== 'mom:motion') return;
  if (frameMotion.active === !!data.active) return;
  frameMotion.active = !!data.active;
  document.documentElement.classList.toggle('is-frame-idle', !frameMotion.active);
  frameMotion.hooks.forEach((fn) => fn());
});

/* Igaz, ha a látogató ténylegesen látja ezt az oldalt. */
function isPageLive() {
  return frameMotion.active && !document.hidden;
}

/* ==========================================================================
   0/b. Hero-pozíció jelzése a keretnek
   --------------------------------------------------------------------------
   Az összekötő oldal „Választó” füle csak addig látszik, amíg a látogató az
   oldal tetején, a hero szakaszon van. A görgetés viszont ITT, a beágyazott
   dokumentumban történik, a fül pedig a keretben ül — és `file://` alól a
   keret nem olvashatja ki ezt a dokumentumot (eltérő eredetnek számít).
   Ezért innen szólunk ki. Önállóan megnyitva nincs kinek: ilyenkor kilép.
   ========================================================================== */
(function reportHeroPosition() {
  if (window.parent === window) return;

  let lastAtTop = null;

  function threshold() {
    const hero = document.getElementById('hero-section');
    const h = hero ? hero.getBoundingClientRect().height : 0;
    // A fül már a hero vége előtt tűnjön el, ne a legutolsó képponton
    return Math.max(120, (h || document.documentElement.clientHeight || 600) - 100);
  }

  function report(force) {
    const y = window.pageYOffset || document.documentElement.scrollTop || 0;
    const atTop = y <= threshold();
    if (!force && atTop === lastAtTop) return;
    lastAtTop = atTop;
    try {
      window.parent.postMessage({ type: 'mom:hero', atTop }, '*');
    } catch (err) { /* a keret még nem fogad: a következő görgetés újrapróbálja */ }
  }

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      report(false);
    });
  }, { passive: true });

  // A hero magassága a betűtípusok és képek megérkezésével még változhat
  window.addEventListener('resize', () => report(true), { passive: true });
  window.addEventListener('load', () => report(true));
  report(true);
})();

document.addEventListener('DOMContentLoaded', () => {
  // A hero háttér azonnal induljon, de a többi (nem azonnal látható) inicializálást
  // az első kirajzolás utánra halasztjuk. Így a cím/alcím belépő animációja nem
  // versenyez a fő szálon a sok szinkron DOM-művelettel, és akadásmentesen indul.
  initHeroCanvas();

  const deferredInit = () => {
    initMobileMenu();
    initProductFilters();
    initProductCatalog();
    initProduct3DTilt();
    initVisionSimulator();
    initEyeAnatomy();
    initColorBlindnessTest();
    initServiceDetails();
    initBookingSystem();
    initScrollAnimationsFallback();
    initDialogDismissFallback();
    checkExistingBooking();
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(deferredInit, { timeout: 800 });
  } else {
    // Két képkocka után fut le, hogy a belépő animáció első kockái simán menjenek
    requestAnimationFrame(() => requestAnimationFrame(deferredInit));
  }
});

/* ==========================================================================
   1. Canvas Fényrefrakciós Hero Animáció
   ========================================================================== */
function initHeroCanvas() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;

  const heroContent = document.querySelector('.hero-content');
  const ctx = canvas.getContext('2d');
  let width, height;
  let mouseX = null;
  let mouseY = null;
  let targetMouseX = null;
  let targetMouseY = null;
  let animationFrameId = 0;
  let isRunning = false;              // Egyszerre pontosan egy rAF-hurok futhat
  let isCanvasVisible = false;
  let canvasRect = null;
  let lastScrollY = -1;
  let entranceDone = false;

  const bookingDialog = document.getElementById('booking-dialog');

  // Szabad-e most rajzolni? Minden feltétel egy helyen, hogy ne indulhasson
  // két párhuzamos hurok (az duplázta a CPU-terhelést és képkockákat dobott).
  function shouldAnimate() {
    return isCanvasVisible && isPageLive() && !(bookingDialog && bookingDialog.open);
  }

  function startLoop() {
    if (isRunning || !shouldAnimate()) return;
    isRunning = true;
    animationFrameId = requestAnimationFrame(animate);
  }

  function stopLoop() {
    if (!isRunning) return;
    isRunning = false;
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }

  if (bookingDialog) {
    // Nyitott foglalási ablak alatt nem pazarolunk CPU-t a háttéranimációra
    bookingDialog.addEventListener('close', startLoop);
  }

  // A fül háttérbe kerülésekor, illetve amikor az összekötő oldal elcsúsztatja
  // ezt a panelt, teljesen leáll a hurok.
  document.addEventListener('visibilitychange', () => {
    if (isPageLive()) startLoop(); else stopLoop();
  });
  frameMotion.hooks.push(() => {
    if (isPageLive()) startLoop(); else stopLoop();
  });

  // Csökkentett mozgás igény tiszteletben tartása (akadálymentesség + alacsony teljesítményű eszközök)
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Caching variables for lens and gradients
  let lensX, lensY, lensR;
  let lensGrad = null;
  let glareGrad = null;

  // Méretezés (felbontás maximalizálása a fill-rate csökkentéséhez nagy képernyőkön)
  //
  // A `canvas.width` írása MINDIG kiüríti a vásznat — ezért csak akkor
  // méretezünk újra, ha a doboz tényleges mérete változott. Mobilon a
  // címsáv ki-be úszása képkockánként `resize`-t lő el változatlan méret
  // mellett; enélkül a hero minden ilyenkor egy képkockára feketére ürült.
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;   // rejtett elem: NaN méret ellen

    const nextWidth = Math.round(Math.min(1200, rect.width));
    const nextHeight = Math.round((rect.height / rect.width) * nextWidth);

    canvasRect = rect; // Eltároljuk a méreteket a forced-reflow elkerülésére
    if (nextWidth === width && nextHeight === height) return;

    width = canvas.width = nextWidth;
    height = canvas.height = nextHeight;

    lensX = width / 2;
    lensY = height / 2;
    lensR = Math.min(240, Math.max(165, height * 0.38));

    // Cache gradients to avoid re-creation on every frame
    // (A háttér gradienst a .hero-canvas CSS háttere adja, így keretenként nem kell újrarajzolni)
    lensGrad = ctx.createRadialGradient(lensX - 40, lensY - 40, 0, lensX, lensY, lensR);
    lensGrad.addColorStop(0, 'rgba(255, 255, 255, 0.03)');
    lensGrad.addColorStop(0.7, 'rgba(214, 123, 75, 0.02)'); // Finom terracotta beütés
    lensGrad.addColorStop(0.95, 'rgba(91, 150, 160, 0.06)'); // Prémium kékeszöld tükröződésgátló bevonat hatás
    lensGrad.addColorStop(1, 'rgba(214, 123, 75, 0.08)');

    glareGrad = ctx.createLinearGradient(lensX - lensR * 0.7, lensY - lensR * 0.7, lensX + lensR * 0.3, lensY + lensR * 0.3);
    glareGrad.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
    glareGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.04)');
    glareGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.005)');
    glareGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  }
  resize();

  // A `resize` sorozatban érkezik (ablakhúzás, címsáv). Képkockánként egyszer
  // mérünk, így nem halmozódik a kényszerített újratördelés (forced reflow).
  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      const prevWidth = width;
      const prevHeight = height;
      resize();
      // Ha a hurok épp áll (statikus kocka), a méretezés kiürítette a vásznat —
      // rajzoljunk egy pótkockát, hogy ne maradjon üresen.
      if (!isRunning && (width !== prevWidth || height !== prevHeight)) {
        drawFrame();
      }
    });
  });

  // Egér követése
  const heroSection = document.getElementById('hero-section');

  heroSection.addEventListener('mousemove', (e) => {
    if (!canvasRect) {
      canvasRect = canvas.getBoundingClientRect();
    }
    // Finom egérpozíció számítás
    targetMouseX = ((e.clientX - canvasRect.left) / canvasRect.width) * width;
    targetMouseY = ((e.clientY - canvasRect.top) / canvasRect.height) * height;
  });

  heroSection.addEventListener('mouseenter', () => {
    canvasRect = canvas.getBoundingClientRect();
  });

  heroSection.addEventListener('mouseleave', () => {
    targetMouseX = null;
    targetMouseY = null;
  });

  // A belépő animáció (fade-in-up) fill-mode: both miatt felülírná a görgetéskor
  // beállított inline transform/opacity értékeket, ezért a befejezése után levesszük,
  // és innentől a JS vezérli a görgetési effektet.
  if (heroContent) {
    heroContent.addEventListener('animationend', () => {
      heroContent.style.animation = 'none';
      entranceDone = true;
    }, { once: true });
  }

  // Színpaletta terrakotta, meleg homok, bronz és meleg fehér árnyalatokkal
  const colors = [
    'rgba(214, 123, 75, ',  // Terracotta clay (#d67b4b)
    'rgba(235, 194, 150, ', // Warm sand / light gold (#ebc296)
    'rgba(186, 107, 72, ',  // Deep copper / bronze (#ba6b48)
    'rgba(255, 245, 235, '  // Warm off-white
  ];

  // Offscreen canvas gyorsítótár létrehozása a bokeh fényekhez a drága színátmenetek kiváltására
  const offscreenCanvases = colors.map(color => {
    const offCanvas = document.createElement('canvas');
    offCanvas.width = 200;
    offCanvas.height = 200;
    const offCtx = offCanvas.getContext('2d');

    // Színátmenet rajzolása a kis canvas közepére 1.0 alapértelmezett átlátszósággal
    const grad = offCtx.createRadialGradient(100, 100, 0, 100, 100, 100);
    grad.addColorStop(0, color + '1.0)');
    grad.addColorStop(0.5, color + '0.45)');
    grad.addColorStop(1, color + '0.0)');

    offCtx.fillStyle = grad;
    offCtx.beginPath();
    offCtx.arc(100, 100, 100, 0, Math.PI * 2);
    offCtx.fill();

    return offCanvas;
  });

  // Részecskeszám a képernyőmérethez igazítva (mobilon kevesebb a sima futásért)
  const isSmallScreen = window.innerWidth < 768;

  // Bokeh körök inicializálása
  const bokehLights = [];
  const numBokeh = isSmallScreen ? 8 : 16;
  for (let i = 0; i < numBokeh; i++) {
    const colorIndex = Math.floor(Math.random() * colors.length);
    bokehLights.push({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: 55 + Math.random() * 95,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -(0.1 + Math.random() * 0.25), // Lassan lebegnek
      colorIndex: colorIndex,
      alpha: 0.03 + Math.random() * 0.07,
      pulseSpeed: 0.003 + Math.random() * 0.007,
      pulsePhase: Math.random() * Math.PI * 2,
      parallaxFactor: 0.04 + Math.random() * 0.08
    });
  }

  // Apró csillámok (Magical Dust)
  const sparkles = [];
  const numSparkles = isSmallScreen ? 20 : 45;
  for (let i = 0; i < numSparkles; i++) {
    sparkles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 0.8 + Math.random() * 1.8,
      vy: -(0.2 + Math.random() * 0.4),
      vx: (Math.random() - 0.5) * 0.15,
      alpha: Math.random(),
      twinkleSpeed: 0.01 + Math.random() * 0.02,
      twinklePhase: Math.random() * Math.PI * 2,
      parallaxFactor: 0.12 + Math.random() * 0.12
    });
  }

  // Egyetlen képkocka kirajzolása. Külön van a huroktól, hogy álló hurok
  // mellett is lehessen pótkockát kérni (pl. átméretezés után).
  function drawFrame() {
    // Görgetési arány kiszámítása az elhomályosodáshoz
    const scrollY = window.scrollY || window.pageYOffset || 0;

    // Csak akkor frissítjük a DOM-ot, ha a görgetési pozíció ténylegesen változott (layout thrashing megelőzése)
    // és csak a belépő animáció lefutása után (különben a fill-mode felülírja az értékeket)
    if (scrollY !== lastScrollY && heroContent && entranceDone) {
      lastScrollY = scrollY;
      const maxScroll = window.innerHeight || height || 800; // A hero magassága (CSS px)
      const scrollPercent = Math.min(1, Math.max(0, scrollY / maxScroll));

      // Parallax elcsúszás + elhalványulás: transform és opacity GPU-n kompozitálódik,
      // így nem okoz újrarajzolást (repaint) görgetés közben.
      const translateY = scrollPercent * 50;
      const opacityAmount = Math.max(0, 1 - scrollPercent * 1.4); // Teljesen elhalványul kb. 70% görgetésnél
      heroContent.style.transform = `translate3d(0, ${translateY}px, 0)`;
      heroContent.style.opacity = `${opacityAmount}`;

      // Itt korábban `filter: blur(...)` is futott. A blur be- és kikapcsolása
      // egy egész képernyős, kompozitált rétegen arra kényszeríti a Chrome-ot,
      // hogy külön rajzfelületet (render surface) hozzon létre és dobjon el —
      // gyengébb/integrált GPU-n ez egy-egy fekete képkockaként villan be a
      // hero-n. A tartalom az `opacity` miatt úgyis eltűnik ~70% görgetésre,
      // ezért a blur elmarad: a parallax innentől tisztán transform + opacity,
      // amit a kompozitor újrarajzolás nélkül intéz.
    }

    // Egérmozgás finom csillapítása (Lerp)
    if (targetMouseX !== null && targetMouseY !== null) {
      if (mouseX === null) {
        mouseX = targetMouseX;
        mouseY = targetMouseY;
      } else {
        mouseX += (targetMouseX - mouseX) * 0.06;
        mouseY += (targetMouseY - mouseY) * 0.06;
      }
    } else {
      if (mouseX !== null) {
        // Visszaállás középre ha elhagyja az egeret
        mouseX += (width / 2 - mouseX) * 0.04;
        mouseY += (height / 2 - mouseY) * 0.04;
        if (Math.abs(mouseX - width / 2) < 1 && Math.abs(mouseY - height / 2) < 1) {
          mouseX = null;
          mouseY = null;
        }
      }
    }

    // Átlátszóra törlünk; a meleg sötét háttér gradienst a .hero-canvas CSS háttere
    // adja, így keretenként megspóroljuk a teljes képernyős gradiens kitöltést.
    ctx.clearRect(0, 0, width, height);

    // A lencse és elemei stabilak maradnak (nincs elhalványulás)
    const lensOpacity = 1.0;

    // 1. Bokeh fények kirajzolása
    bokehLights.forEach(b => {
      // Mozgás frissítése
      b.x += b.vx;
      b.y += b.vy;

      // Képernyő elhagyás kezelése (csomagolás)
      if (b.y < -b.radius) {
        b.y = height + b.radius;
        b.x = Math.random() * width;
      }
      if (b.x < -b.radius) b.x = width + b.radius;
      if (b.x > width + b.radius) b.x = -b.radius;

      // Parallaxis hatás egérmozgásra
      let displayX = b.x;
      let displayY = b.y;
      if (mouseX !== null && mouseY !== null) {
        displayX -= (mouseX - width / 2) * b.parallaxFactor;
        displayY -= (mouseY - height / 2) * b.parallaxFactor;
      }

      // Lencse refrakciós (fénytörés) torzítás
      const dx = displayX - lensX;
      const dy = displayY - lensY;
      const distSq = dx * dx + dy * dy;
      const lensRSq = lensR * lensR;

      if (distSq < lensRSq) {
        const dist = Math.sqrt(distSq);
        const factor = 1 + 0.22 * Math.pow(1 - dist / lensR, 1.8);
        displayX = lensX + dx * factor;
        displayY = lensY + dy * factor;
      }

      // Alpha pulzálás
      b.pulsePhase += b.pulseSpeed;
      let currentAlpha = b.alpha * (0.75 + Math.sin(b.pulsePhase) * 0.25);

      let renderRadius = b.radius;

      // Szupergyors offscreen canvas rajzolás (kép másolás) a CPU terhelés csökkentéséért
      const offCanvas = offscreenCanvases[b.colorIndex];
      ctx.globalAlpha = currentAlpha;
      ctx.drawImage(offCanvas, displayX - renderRadius, displayY - renderRadius, renderRadius * 2, renderRadius * 2);
      ctx.globalAlpha = 1.0;
    });

    // 2. Csillámok / Porcsomók kirajzolása
    sparkles.forEach(s => {
      s.x += s.vx;
      s.y += s.vy;

      if (s.y < -5) {
        s.y = height + 5;
        s.x = Math.random() * width;
      }
      if (s.x < -5) s.x = width + 5;
      if (s.x > width + 5) s.x = -5;

      let displayX = s.x;
      let displayY = s.y;
      if (mouseX !== null && mouseY !== null) {
        displayX -= (mouseX - width / 2) * s.parallaxFactor;
        displayY -= (mouseY - height / 2) * s.parallaxFactor;
      }

      // Lencse refrakció csillámokra is
      const dx = displayX - lensX;
      const dy = displayY - lensY;
      const distSq = dx * dx + dy * dy;
      const lensRSq = lensR * lensR;

      if (distSq < lensRSq) {
        const dist = Math.sqrt(distSq);
        const factor = 1 + 0.2 * Math.pow(1 - dist / lensR, 1.8);
        displayX = lensX + dx * factor;
        displayY = lensY + dy * factor;
      }

      // Csillogás (twinkle)
      s.twinklePhase += s.twinkleSpeed;
      let sparkleAlpha = Math.max(0.1, Math.min(1, s.alpha * (0.4 + Math.sin(s.twinklePhase) * 0.6)));

      let renderSize = s.size;

      // Szupergyors téglalap rajzolás arc() és path hívások helyett
      ctx.fillStyle = `rgba(255, 255, 255, ${sparkleAlpha})`;
      ctx.fillRect(displayX - renderSize, displayY - renderSize, renderSize * 2, renderSize * 2);
    });

    // 3. Központi lencse üvegtestének rajzolása (valósághű 3D szemüveg/kontaktlencse hatás)

    // Lencse belső finom színátmenete (enyhe visszatükröződés tükröződésgátló bevonattal) (cached)
    ctx.fillStyle = lensGrad;
    ctx.beginPath();
    ctx.arc(lensX, lensY, lensR, 0, Math.PI * 2);
    ctx.fill();

    // Lágy, átlós ablak-fényvetület / tükröződés söprés (cached)
    ctx.beginPath();
    ctx.fillStyle = glareGrad;
    ctx.arc(lensX, lensY, lensR - 5, 0, Math.PI * 2);
    ctx.fill();

    // Fazettázott élek (koncentrikus körök a lencse szélén, mint a csiszolt üveg/kontaktlencse szegély)
    ctx.lineWidth = 1;

    // Külső él gyűrű
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.15 * lensOpacity})`;
    ctx.beginPath();
    ctx.arc(lensX, lensY, lensR, 0, Math.PI * 2);
    ctx.stroke();

    // Második finom fazetta gyűrű
    ctx.strokeStyle = `rgba(214, 123, 75, ${0.08 * lensOpacity})`;
    ctx.beginPath();
    ctx.arc(lensX, lensY, lensR - 3, 0, Math.PI * 2);
    ctx.stroke();

    // Harmadik belső gyűrű a mélységért
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.06 * lensOpacity})`;
    ctx.beginPath();
    ctx.arc(lensX, lensY, lensR - 8, 0, Math.PI * 2);
    ctx.stroke();

    // 3D ÉLfények (Highlights)
    // 1. Fényes fehér élfény ív bal-felül
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.45 * lensOpacity})`;
    ctx.beginPath();
    ctx.arc(lensX, lensY, lensR - 1, 1.25 * Math.PI, 1.75 * Math.PI);
    ctx.stroke();

    // 2. Másodlagos gyengébb élfény ív bal-felül kicsit beljebb a 3D fénytörésért
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 * lensOpacity})`;
    ctx.beginPath();
    ctx.arc(lensX, lensY, lensR - 4, 1.28 * Math.PI, 1.72 * Math.PI);
    ctx.stroke();

    // 3. Ellen-árnyék élfény jobb-alul (terrakotta tónusú visszaverődés)
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(214, 123, 75, ${0.25 * lensOpacity})`;
    ctx.beginPath();
    ctx.arc(lensX, lensY, lensR - 1, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.stroke();
  }

  function animate() {
    // Bármelyik feltétel elesik (kigördült, más panel van a képen, fül a
    // háttérben, nyitott foglalási ablak) → a hurok tisztán leáll.
    if (!shouldAnimate()) {
      isRunning = false;
      animationFrameId = 0;
      return;
    }

    drawFrame();

    // Csökkentett mozgásnál csak egyetlen statikus képkockát rajzolunk
    if (reduceMotion) {
      isRunning = false;
      animationFrameId = 0;
      return;
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  // Csökkentett mozgás igény esetén egy statikus kockát rajzolunk és nem indítjuk az animációs loopot
  if (reduceMotion) {
    isCanvasVisible = true;
    drawFrame();
    return;
  }

  // Megállítjuk az animációt, ha a hero szekció kívül esik a képernyőn (Scroll Throttling)
  const observer = new IntersectionObserver((entries) => {
    isCanvasVisible = entries[0].isIntersecting;
    if (isCanvasVisible) startLoop(); else stopLoop();
  }, { threshold: 0.05 });

  observer.observe(heroSection);
}

/* ==========================================================================
   2. Mobil Hamburger Menü Kezelése
   ========================================================================= */
function initMobileMenu() {
  const toggleBtn = document.getElementById('mobile-nav-toggle');
  const overlay = document.getElementById('mobile-menu-overlay');
  const links = document.querySelectorAll('.mobile-nav-link');
  const bookBtn = document.getElementById('mobile-booking-btn');

  if (!toggleBtn || !overlay) return;

  function toggleMenu() {
    const isOpen = toggleBtn.classList.toggle('open');
    overlay.classList.toggle('open', isOpen);
    toggleBtn.setAttribute('aria-expanded', isOpen);
    overlay.setAttribute('aria-hidden', !isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }

  toggleBtn.addEventListener('click', toggleMenu);

  // Linkekre kattintás után bezáródik
  links.forEach(link => {
    link.addEventListener('click', () => {
      if (toggleBtn.classList.contains('open')) toggleMenu();
    });
  });

  if (bookBtn) {
    bookBtn.addEventListener('click', () => {
      if (toggleBtn.classList.contains('open')) toggleMenu();
      const bookingDialog = document.getElementById('booking-dialog');
      if (bookingDialog) bookingDialog.showModal();
    });
  }
}

/* ==========================================================================
   3. Termékkatalógus — betöltés, szűrés, részletek
   --------------------------------------------------------------------------
   A rácsban induláskor négy, kézzel megírt kártya áll (`data-fallback="true"`).
   Ez a TARTALÉK: ezt látja, akinél nem fut a JavaScript, és ez marad, ha a
   kiszolgáló nem válaszol. Amint a /api/products megjön, az egész rács
   újraépül belőle — az adminban felvett, módosított vagy elrejtett termékek
   így kerülnek ki az oldalra.

   A kártyákat és a részletes nézetet az `assets/js/product-render.js` építi,
   kizárólag DOM-hívásokkal. Emiatt a szűrést és a 3D-billenést nem lehet
   egyetlen, induláskor elmentett listára kötni: minden újrarajzolás után
   frissen kell megkeresni a kártyákat. Ezért kapott mindkettő egy `refresh`
   belépési pontot.
   ========================================================================== */

/* A mindenkori kártyalista. A rács tartalma cserélődik, ezért nem tárolunk
   elemhivatkozásokat modul szinten — mindig a DOM aktuális állapotát kérdezzük. */
function currentProductCards() {
  const grid = document.getElementById('product-grid');
  return grid ? Array.from(grid.querySelectorAll('.product-card')) : [];
}

let activeProductFilter = 'all';

/* A szűrés kétütemű: a kártya előbb elhalványul, és csak 300 ms múlva tűnik el
   a rácsból (`display: none`) — különben a többi kártya azonnal odébb ugrana
   az átmenet alatt. Ez viszont csapda: ha a látogató időközben MÁSIK szűrőre
   vált, a korábbi rejtések időzítője akkor is lefut, és eltünteti azt, aminek
   most látszania kellene. A nemzedékszám ezt zárja ki: minden szűrés új számot
   kap, és az elavult időzítő magától kilép. */
let filterGeneration = 0;

function applyProductFilter(filterValue, animate) {
  activeProductFilter = filterValue;
  const generation = ++filterGeneration;
  const cards = currentProductCards();
  let visible = 0;

  cards.forEach(card => {
    const category = card.getAttribute('data-category');
    const show = filterValue === 'all' || category === filterValue;
    if (show) visible += 1;

    if (!animate) {
      card.style.display = show ? 'flex' : 'none';
      card.style.opacity = show ? '1' : '0';
      card.style.transform = show ? 'scale(1) translateY(0)' : '';
      return;
    }

    // Animált ki/beúszás
    if (show) {
      card.style.display = 'flex';
      // Egy pillanattal később, hogy az átmenetnek legyen honnan indulnia:
      // a `display` váltása és az `opacity` állítása egyetlen képkockában
      // nem ad átmenetet, csak ugrást.
      setTimeout(() => {
        if (generation !== filterGeneration) return;
        card.style.opacity = '1';
        card.style.transform = 'scale(1) translateY(0)';
      }, 50);
    } else {
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95) translateY(10px)';
      setTimeout(() => {
        if (generation !== filterGeneration) return;
        card.style.display = 'none';
      }, 300);
    }
  });

  const empty = document.getElementById('product-empty');
  if (empty) empty.hidden = visible > 0;
}

function initProductFilters() {
  const buttons = document.querySelectorAll('.filter-btn');
  if (buttons.length === 0) return;

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      applyProductFilter(btn.getAttribute('data-filter'), true);
    });
  });

  applyProductFilter(activeProductFilter, false);
}

/* ==========================================================================
   4. Termékkártyák 3D Hover Tilt Effektusa
   ========================================================================== */
function initProduct3DTilt() {
  // Csak asztali nézetben és egérrel fusson: érintőképernyőn a hover állapot
  // beragad, gyengébb gépen pedig fölösleges rajzolás.
  if (window.innerWidth < 768) return;
  if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  currentProductCards().forEach(card => {
    if (card.dataset.tiltBound === '1') return;   // ne kössük fel kétszer
    card.dataset.tiltBound = '1';

    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left; // Kurzor X a kártyán belül
      const y = e.clientY - rect.top;  // Kurzor Y a kártyán belül

      const width = rect.width;
      const height = rect.height;

      // Döntési szög kiszámítása (-10 és 10 fok között)
      const rotateY = ((x / width) - 0.5) * 12;
      const rotateX = (((y / height) - 0.5) * -12);

      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-5px) scale(1.01)`;
    });

    card.style.transition = 'transform 0.1s ease, box-shadow 0.3s ease';

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0) scale(1)';
      card.style.transition = 'transform 0.5s cubic-bezier(0.25, 0.8, 0.25, 1), box-shadow 0.3s ease';
    });
  });
}

/* ── A katalógus betöltése és a részletek ablaka ─────────────────────────── */
function initProductCatalog() {
  const grid = document.getElementById('product-grid');
  if (!grid || !window.LuminaProducts) return;

  const dialog = document.getElementById('product-dialog');
  const detailRoot = document.getElementById('product-detail-root');
  const closeBtn = document.getElementById('product-dialog-close-btn');

  function openDetail(product) {
    if (!dialog || !detailRoot) return;

    window.LuminaProducts.renderDetail(product, detailRoot, {
      titleId: 'product-dialog-title',
      onBook: () => {
        // A részletekből egyenesen az időpontfoglalásba lehet lépni.
        dialog.close();
        const booking = document.getElementById('booking-dialog');
        if (booking && typeof booking.showModal === 'function') booking.showModal();
      }
    });

    // A hosszú leírásnál a görgetés mindig elölről induljon
    const wrapper = dialog.querySelector('.dialog-wrapper');
    if (wrapper) wrapper.scrollTop = 0;

    if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  if (closeBtn && dialog) {
    closeBtn.addEventListener('click', () => dialog.close());
  }

  // A galéria billentyűvel is léptethető, amíg az ablak nyitva van
  if (dialog) {
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const selector = event.key === 'ArrowLeft' ? '.pd-nav--prev' : '.pd-nav--next';
      const button = dialog.querySelector(selector);
      if (button) { event.preventDefault(); button.click(); }
    });
  }

  function render(products) {
    grid.textContent = '';
    grid.removeAttribute('data-fallback');

    products.forEach(product => {
      grid.appendChild(window.LuminaProducts.createCard(product, { onDetails: openDetail }));
    });

    // A csere után a szűrő, a billenés és a beúszás új elemeket kapott
    applyProductFilter(activeProductFilter, false);
    initProduct3DTilt();
    revealProductCards();
  }

  // A tartalék kártyák „Érdekel” gombja addig is csináljon valamit: amíg a
  // katalógus meg nem érkezik, az időpontfoglalást nyitja.
  grid.querySelectorAll('.product-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const booking = document.getElementById('booking-dialog');
      if (booking && typeof booking.showModal === 'function') booking.showModal();
    });
  });

  fetch('/api/products', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(response => (response.ok ? response.json() : null))
    .then(data => {
      if (!data || !data.ok || !Array.isArray(data.products)) return;
      render(data.products);
    })
    .catch(() => {
      /* Nincs kiszolgáló vagy nincs hálózat — a tartalék kártyák maradnak.
         Nem írunk ki hibát: a látogató szempontjából az oldal működik. */
    });
}

/* A kártyák beúszása. Ha a böngésző tudja a görgetéshez kötött animációt,
   azt a CSS intézi; különben ez a megfigyelő. Újrarajzolás után is fut. */
function revealProductCards() {
  if (CSS.supports('(animation-timeline: view()) and (animation-range: entry)')) return;

  const cards = currentProductCards().filter(card => card.dataset.revealBound !== '1');
  if (!cards.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0) scale(1)';
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.15 });

  cards.forEach(card => {
    card.dataset.revealBound = '1';
    card.style.opacity = '0';
    card.style.transform = 'translateY(30px) scale(0.95)';
    card.style.transition = 'opacity 0.6s ease, transform 0.6s cubic-bezier(0.25, 0.8, 0.25, 1)';
    observer.observe(card);
  });
}

/* ==========================================================================
   5. Interaktív Látásszimulátor
   ========================================================================== */
function initVisionSimulator() {
  const viewport = document.getElementById('simulator-viewport');
  const imgContainer = document.getElementById('simulator-images');
  const baseLayer = document.getElementById('sim-layer-base');
  const effectLayer = document.getElementById('sim-layer-effect');
  const correctedLayer = document.getElementById('sim-layer-corrected');
  const glassIndicator = document.getElementById('lens-glass-indicator');

  const conditionButtons = document.querySelectorAll('.condition-btn');
  const infoCard = document.getElementById('simulator-info-card');
  const infoTitle = infoCard.querySelector('.info-card-title');
  const infoText = infoCard.querySelector('.info-card-text');

  const lensToggle = document.getElementById('lens-toggle');

  if (!viewport || !imgContainer || !baseLayer || !effectLayer || !correctedLayer) return;

  // Látáshibák leírásai és képei (mindegyik a book_in_hand képből dolgozik, eltérő réteg-effektekkel)
  const conditions = {
    normal: {
      title: 'Normál Látás',
      text: 'A fény sugarai pontosan a retinán fókuszálódnak, így a közeli és távoli tárgyak egyaránt tisztán, élesen és torzításmentesen látszódnak.',
      filter: 'filter-normal'
    },
    myopia: {
      title: 'Rövidlátás (Myopia)',
      text: 'A közeli tárgyak (mint a könyv lapjai) tiszták és élesek, de a távoli háttér (a nappali berendezése) homályos és életlen.',
      filter: 'filter-myopia'
    },
    hyperopia: {
      title: 'Távollátás (Hyperopia)',
      text: 'A távoli dolgok élesek, de a közeli tárgyak homályosak. A szem nem képes megfelelően fókuszálni a kezünkben tartott könyv betűire.',
      filter: 'filter-hyperopia'
    },
    astigmatism: {
      title: 'Asztigmia (Szemtengelyferdülés)',
      text: 'Minden távolságra életlen vagy kissé megnyúlt, kettőzött a kép, mert a szem szaruhártyája nem gömbszerű, hanem tojásdad alakú. Korrekciója: cilinderes lencse.',
      filter: 'filter-astigmatism'
    },
    farkasvaksag: {
      title: 'Farkasvakság (Nyctalopia)',
      text: 'A pálcikák működési zavara miatt a szem nem képes alkalmazkodni a sötétséghez. Szürkületben vagy éjszaka a látás jelentősen romlik, a környezet rendkívül sötétté és kontrasztszegénnyé válik, miközben nappal teljesen normális lehet. Különösen veszélyes éjszakai vezetéskor.',
      filter: 'filter-farkasvaksag'
    }
  };

  // Kezdő beállítások
  let activeCondition = 'normal';
  let simulatorVisible = false; // IntersectionObserver állítja, csak akkor renderel blur-t
  const allFilterClasses = Object.values(conditions).map(c => c.filter);
  updateSimulatorVisuals();

  // Kategória váltó gombok eseményei
  conditionButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      conditionButtons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-checked', 'true');

      activeCondition = btn.getAttribute('data-condition');

      // Kártya szöveg csere lágy áttűnéssel
      infoCard.style.opacity = '0';
      infoCard.style.transform = 'translateX(-10px)';

      setTimeout(() => {
        infoTitle.textContent = conditions[activeCondition].title;
        infoText.textContent = conditions[activeCondition].text;

        updateSimulatorVisuals();

        infoCard.style.opacity = '1';
        infoCard.style.transform = 'translateX(0)';
      }, 200);
    });
  });

  function updateSimulatorVisuals() {
    const cond = conditions[activeCondition];

    // Fókusz-keresés (zoom és vissza) animáció elindítása
    imgContainer.classList.remove('focus-hunting');
    void imgContainer.offsetWidth; // Force reflow
    imgContainer.classList.add('focus-hunting');

    // Határozzuk meg a megfelelő képet az aktív látáshiba alapján
    const bgImg = (activeCondition === 'myopia') ? "assets/myopia_skyscraper.webp" :
      (activeCondition === 'farkasvaksag') ? "assets/night_driving.webp" : "assets/book_in_hand.webp";

    // Alap háttérképek beállítása
    baseLayer.style.backgroundImage = `url('${bgImg}')`;
    effectLayer.style.backgroundImage = `url('${bgImg}')`;
    correctedLayer.style.backgroundImage = `url('${bgImg}')`;

    // Szűrőosztályok tisztítása
    baseLayer.className = 'sim-layer sim-layer-base';
    effectLayer.className = 'sim-layer sim-layer-effect';

    if (!simulatorVisible) return;

    // Réteg-logika látáshiba szerint
    if (activeCondition === 'normal') {
      baseLayer.classList.add('filter-normal');
      effectLayer.style.clipPath = 'polygon(0% 0%, 50% 0%, 100% 0%, 100% 100%, 50% 100%, 0% 100%)';
      effectLayer.style.opacity = '0';
    } else if (activeCondition === 'myopia') {
      // Rövidlátás: háttér (város) elmosódott (base), korlát és telefon éles (effect)
      baseLayer.classList.add('filter-myopia');
      effectLayer.classList.add('filter-normal');
      effectLayer.style.clipPath = 'polygon(0% 77.7%, 50% 77.7%, 100% 77.7%, 100% 100%, 50% 100%, 0% 100%)';
      effectLayer.style.opacity = '1';
    } else if (activeCondition === 'hyperopia') {
      // Távollátás: háttér (nappali) éles (base), könyv elmosódott (effect)
      baseLayer.classList.add('filter-normal');
      effectLayer.classList.add(cond.filter);
      effectLayer.style.clipPath = 'polygon(29% 28%, 50% 29%, 71% 28%, 71% 74%, 50% 74%, 29% 74%)';
      effectLayer.style.opacity = '1';
    } else if (activeCondition === 'astigmatism') {
      // Asztigmia: minden elmosódott/torzított (base)
      baseLayer.classList.add('filter-astigmatism');
      effectLayer.style.clipPath = 'polygon(0% 0%, 50% 0%, 100% 0%, 100% 100%, 50% 100%, 0% 100%)';
      effectLayer.style.opacity = '0';
    } else if (activeCondition === 'farkasvaksag') {
      // Farkasvakság: a háttér elsötétített (base), a kocsi belső tere éles/világos (effectLayer)
      baseLayer.classList.add('filter-farkasvaksag');
      effectLayer.classList.add('filter-normal');
      effectLayer.style.clipPath = 'polygon(0% 69.4%, 100% 69.4%, 100% 100%, 0% 100%)';
      effectLayer.style.opacity = '1';
    }
  }

  // A drága `filter: blur()` és a rétegfrissítés csak akkor fut le, ha a szekció látható
  const simObserver = new IntersectionObserver((entries) => {
    simulatorVisible = entries[0].isIntersecting;
    updateSimulatorVisuals();
  }, { threshold: 0.05 });
  simObserver.observe(viewport);

  // Lupé (Korrekciós lencse) pozicionálás egérmozgásra (gyorsítva, getBoundingClientRect cache-eléssel)
  let isMoving = false;
  let viewportRect = null;

  function updateLensPosition(e) {
    if (!viewportRect) {
      viewportRect = viewport.getBoundingClientRect();
    }

    if (isMoving) return;
    isMoving = true;

    requestAnimationFrame(() => {
      let x, y;

      if (e.type.startsWith('touch')) {
        x = e.touches[0].clientX - viewportRect.left;
        y = e.touches[0].clientY - viewportRect.top;
      } else {
        x = e.clientX - viewportRect.left;
        y = e.clientY - viewportRect.top;
      }

      // Százalékos koordináták kiszámítása elmentett adatokból (nincs forced reflow)
      const xPct = Math.max(0, Math.min(100, (x / viewportRect.width) * 100));
      const yPct = Math.max(0, Math.min(100, (y / viewportRect.height) * 100));

      // CSS változók frissítése
      imgContainer.style.setProperty('--lens-x', `${xPct}%`);
      imgContainer.style.setProperty('--lens-y', `${yPct}%`);

      isMoving = false;
    });
  }

  // Frissítjük a viewport méretét ha belép az egér, vagy megérinti, vagy átméretezik
  viewport.addEventListener('mouseenter', () => {
    viewportRect = viewport.getBoundingClientRect();
  });
  viewport.addEventListener('touchstart', () => {
    viewportRect = viewport.getBoundingClientRect();
  }, { passive: true });
  window.addEventListener('resize', () => {
    viewportRect = viewport.getBoundingClientRect();
  });

  // Eseménykezelők a viewport-ra
  viewport.addEventListener('mousemove', updateLensPosition);
  viewport.addEventListener('touchmove', updateLensPosition, { passive: true });

  // Lencse ki/bekapcsolása
  lensToggle.addEventListener('change', () => {
const isChecked = lensToggle.checked;

    if (isChecked) {
      imgContainer.style.setProperty('--lens-size', '100px');
      correctedLayer.style.opacity = '1';
      glassIndicator.style.opacity = '1';
    } else {
      imgContainer.style.setProperty('--lens-size', '0px');
      correctedLayer.style.opacity = '0';
      glassIndicator.style.opacity = '0';
    }
  });

  // Mobil kezdő pozíció és kezdeti beállítás
  imgContainer.style.setProperty('--lens-size', '100px');
}

/* ==========================================================================
   5. Interaktív Szemanatómia (Képes Anatómiai Illusztráció & Diagnosztika)
   ========================================================================== */

const EYE_PARTS = {
  cornea: {
    id: 'cornea',
    name: 'Szaruhártya',
    latin: 'Cornea',
    badge: 'Elülső fénytörő ablak',
    swatch: '#9bc2d4',
    intro: 'A szemgolyó elülső felszínén ülő, teljesen átlátszó, érmentes „óraüveg”. Öt rétegből épül fel, és mivel egyetlen ér sem futhat benne (az rontaná az átlátszóságát), tápanyagait kívülről a könnyfilmből, belülről a csarnokvízből kapja.',
    functions: [
      'A szem legerősebb fénytörő eleme: a teljes törőerő mintegy kétharmadát, kb. 40–43 dioptriát adja.',
      'Mechanikai és fertőzés elleni védőpajzs a szem belseje számára.',
      'A test legsűrűbben beidegzett szövete — ezért fáj már egy hajszálnyi porszemcse vagy karcolás is.'
    ],
    disorders: 'Ha görbülete nem szabályosan gömbszerű, hanem tojásdad, szemtengelyferdülés (asztigmia) alakul ki. Sérülése vagy gyulladása (keratitis) heves fájdalommal, könnyezéssel és fényérzékenységgel jár, hegesedése pedig maradandó homályt hagyhat. Alakja és görbülete határozza meg azt is, milyen típusú kontaktlencse illeszthető kényelmesen és biztonságosan.',
    exam: 'Réslámpás biomikroszkópia és szaruhártya-görbület digitális mérése (keratometria / topográfia)'
  },
  conjunctiva: {
    id: 'conjunctiva',
    name: 'Kötőhártya & Könnyfilm',
    latin: 'Tunica conjunctiva & Apparatus lacrimalis',
    badge: 'Védő- és nedvesítő réteg',
    swatch: '#e6988d',
    intro: 'Vékony, átlátszó, erekkel átszőtt nyálkahártya, amely a szemhéjak belső felszínét és az ínhártya elülső részét borítja. A felszínén eloszló mikroszkopikus háromrétegű könnyfilm folyamatosan nedvesen tartja, táplálja és tisztítja a szaruhártyát.',
    functions: [
      'Megvédi a szemet a kórokozóktól, porszemcséktől és a kiszáradástól.',
      'A pislogás során sima, súrlódásmentes csúszófelületet biztosít a szemhéjaknak.',
      'Az optikai képalkotáshoz elengedhetetlen, tükörsima fénytörő felületet képez a szaruhártyán.'
    ],
    disorders: 'Gyakori problémája a szárazszem-szindróma (égő, szúró érzés, homályosodó látás monitoros munka közben) és a kötőhártya-gyulladás (vörös szem, fokozott váladékozás). Célzott műkönny-terápiával és szemhéjhigiéniával kiválóan stabilizálható.',
    exam: 'Könnyfilm-felszakadási idő (TBUT) mérése, fluoreszcein festés és réslámpás vizsgálat'
  },
  aqueous: {
    id: 'aqueous',
    name: 'Csarnokvíz',
    latin: 'Humor aquosus',
    badge: 'Elülső és hátsó csarnok',
    swatch: '#a0d2db',
    intro: 'A szaruhártya és a szemlencse közötti tereket kitöltő, kristálytiszta folyadék. A sugártest termeli folyamatosan, a szem körkörös csarnokzugán (trabekuláris hálózat) át pedig felszívódik — ez az állandó mikrokeringés tartja egyensúlyban a szem belső környezetét.',
    functions: [
      'Táplálja az érmentes szaruhártyát és a szemlencsét, elszállítva a sejtanyagcsere végtermékeit.',
      'Fenntartja a szem belnyomását (normálértéke kb. 10–21 Hgmm), ami a szemgolyó feszes gömb alakjához szükséges.',
      'Átlátszó fénytörő közegként optikai utat biztosít a beeső fény számára.'
    ],
    disorders: 'Ha a folyadék elfolyása akadályozottá válik, a szem belnyomása megemelkedik: ez a zöldhályog (glaukóma). Alattomos betegség, mert sokáig teljesen tünetmentesen sorvasztja a látóideg rostjait, és az elveszett látótér már nem pótolható. Ezért elengedhetetlen a rendszeres szemnyomásmérés.',
    exam: 'Szemnyomásmérés (non-contact és applanációs tonometria), csarnokzug ellenőrzése'
  },
  iris: {
    id: 'iris',
    name: 'Szivárványhártya',
    latin: 'Iris',
    badge: 'A szem színes rekesze',
    swatch: '#4b7f94',
    intro: 'A szaruhártya mögött elhelyezkedő, finom izomrostokat tartalmazó színes lemez, amely a szem közepén szabályozható nyílást (a pupillát) hagy szabadon. Pigmenttartalma határozza meg a szem színét (a kevés festék kék, a sok barna), mintázata pedig egyedi, mint az ujjlenyomat.',
    functions: [
      'Két izma (a záró- és a tágítóizom) akaratlan reflexszel, a környező fényviszonyokhoz igazodva állítja a pupilla átmérőjét.',
      'Fényképezőgép blendéjeként szabályozza a retina felé jutó fény mennyiségét.',
      'Megakadályozza a szórt fény bejutását, így a kép a lencse optimális törőzónáján halad át.'
    ],
    disorders: 'Gyulladása (iritis / anterior uveitis) tompa szemfájdalommal, vörös szemmel és erős fényérzékenységgel jár, azonnali szakorvosi kezelést igényel. A két szem eltérő színe (heterochromia) vagy pupillareakciója neurológiai és belgyógyászati kivizsgálást tehet indokolttá.',
    exam: 'Réslámpás vizsgálat nagy nagyítással, direkt és konszenzuális pupillareakció ellenőrzése'
  },
  pupil: {
    id: 'pupil',
    name: 'Pupilla',
    latin: 'Pupilla',
    badge: 'A fény bemenete',
    swatch: '#1d1512',
    intro: 'A pupilla nem különálló szövet, hanem a szivárványhártya közepén lévő kerek nyílás. Azért látszik mélyfeketének, mert a rajta áthaladó fény a sötét szemfenéken szinte teljesen elnyelődik, és alig verődik vissza.',
    functions: [
      'Átmérője 2 és 8 mm között dinamikusan változik, így mintegy tizenhatszoros különbséget tud kompenzálni a megvilágításban.',
      'Szűkülése közelre nézéskor növeli a mélységélességet, elősegítve a fókuszálást.',
      'Fényre adott válasza idegrendszeri pályákon fut végig, így működése általános neurológiai állapotjelző.'
    ],
    disorders: 'A két szem eltérő pupillamérete (anisocoria), a renyhe fényreakció kivizsgálást igényel. Éjszaka vagy sötétben a pupilla kitágul, így a szem optikai szélei is részt vesznek a képalkotásban: ez felerősíti az éjszakai szürkületi homályt, a szellemképeket és a fényudvarokat.',
    exam: 'Digitális pupillometria, szürkületi látás- és fényérzékenység vizsgálat'
  },
  lens: {
    id: 'lens',
    name: 'Szemlencse',
    latin: 'Lens crystallina',
    badge: 'Az állítható fókusz',
    swatch: '#ebd9b2',
    intro: 'Rugalmas, tökéletesen átlátszó, kétdomború lencse a szivárványhártya mögött. Finom függesztőrostok (zonulák) tartják a helyén körben, mint egy trambulint a rugói. Életünk során folyamatosan új rétegek rakódnak rá, miközben lassanként veszít a rugalmasságából.',
    functions: [
      'Az alkalmazkodás (akkomodáció) szerve: domborulatának változtatásával kb. 15–20 dioptriányi dinamikus finomhangolást ad.',
      'Közelre tekintéskor gömbölyűbbé válik (erősebb törőerő), távolra nézve ellaposodik.',
      'Kiszűri a szembe érkező káros ultraibolya sugárzás jelentős részét, védve az érzékeny ideghártyát.'
    ],
    disorders: '40–45 éves kor körül rugalmassága annyira csökken, hogy az olvasási távolságra fókuszálás nehézzé válik: ez az öregszeműség (presbyopia), amit olvasó- vagy multifokális lencsével korrigálunk. Ha a lencse anyaga elhomályosodik, szürkehályogról (cataracta) beszélünk, amely rutinműtéttel (műlencse beültetésével) gyógyítható.',
    exam: 'Réslámpás átvilágítás tágított pupillában, szürkehályog- és akkomodáció-szűrés'
  },
  ciliary: {
    id: 'ciliary',
    name: 'Sugártest',
    latin: 'Corpus ciliare',
    badge: 'Fókuszmotor és folyadékforrás',
    swatch: '#a85e37',
    intro: 'Gyűrű alakú, simaizomból és mirigyes nyúlványokból álló képlet a szivárványhártya tövénél, a szemgolyó belső falán. Ehhez kapcsolódnak a szemlencsét rögzítő függesztőrostok, és felszíne termeli a tápláló csarnokvizet.',
    functions: [
      'Sugárizmának összehúzódása ellazítja a függesztőrostokat, így a lencse kidomborodik a közeli éleslátáshoz.',
      'Elernyedésekor a lencse ellaposodik a nyugalmi távoli látáshoz.',
      'Nyúlványai termelik az elülső szemszakaszt tápláló csarnokvizet.'
    ],
    disorders: 'Hosszan tartó közeli munka és képernyőhasználat esetén izomgörcs (akkomodációs spazmus) léphet fel: ilyenkor felpillantva percekig homályos a távol, és szem környéki vagy homloktáji fejfájás jelentkezik.',
    exam: 'Akkomodációs tartomány és konvergencia vizsgálata próbakerettel és foropterrel'
  },
  vitreous: {
    id: 'vitreous',
    name: 'Üvegtest',
    latin: 'Corpus vitreum',
    badge: 'A szem belső tere',
    swatch: '#d2e3e8',
    intro: 'A szemgolyó térfogatának mintegy 80%-át kitevő, átlátszó, kocsonyás gél a lencse és az ideghártya között. 99%-ban víz, amelyet finom kollagénrostok és hialuronsav hálózata tart feszes formában.',
    functions: [
      'Kitölti a szemgolyó belsejét, fenntartva a gömb alakot és a belső mechanikai stabilitást.',
      'Optikailag tiszta közeget biztosít a fény törésmentes továbbításához a retináig.',
      'Belülről finoman rásimítja és a helyén tartja a mögötte fekvő ideghártyát.'
    ],
    disorders: 'A kor előrehaladtával részben elfolyósodik, a rostok pedig apró csomókba állhatnak össze: ezek árnyékot vetnek a retinára, amit a látótérben úszkáló „legyekként” (mouches volantes) érzékelünk. Ha hirtelen sok új úszkáló folt, villanások vagy sötét kieső mező jelenik meg, az retina-szakadás gyanúja miatt azonnali szemészeti ellátást igényel.',
    exam: 'Szemfenéki átvilágítás réslámpával és Volk-lencsével'
  },
  sclera: {
    id: 'sclera',
    name: 'Ínhártya',
    latin: 'Sclera',
    badge: 'A szem szilárd váza',
    swatch: '#eae3d8',
    intro: 'A köznyelvben „szemfehérje”: vastag, rendkívül ellenálló, tömött rostos külső burok, amely a szemgolyó felszínének öt hatodát borítja. Elöl zökkenőmentesen folytatódik a kristálytiszta szaruhártyában.',
    functions: [
      'Megtartja a szemgolyó alakját és ellenáll a belső nyomásnak, mint egy védőburok.',
      'Megóvja a sérülékeny belső képleteket a külső mechanikai behatásoktól.',
      'Erre tapadnak a szemet mozgató külső szemizmok, lehetővé téve a precíz szemmozgásokat.'
    ],
    disorders: 'Gyulladása (episcleritis, scleritis) heves, tompa, éjszaka is sajgó fájdalommal és vörösséggel jár, gyakran autoimmun kórképekhez társulva. Kóros sárgás elszíneződése máj- és epeúti eltérések korai jele lehet.',
    exam: 'Külső megtekintés és réslámpás rétegvizsgálat természetes és diffúz fényben'
  },
  choroid: {
    id: 'choroid',
    name: 'Érhártya',
    latin: 'Choroidea',
    badge: 'A tápláló középső réteg',
    swatch: '#7e3824',
    intro: 'Az ínhártya és az ideghártya között fekvő, rendkívül sűrű érhálózattal és sötét pigmentsejtekkel teli réteg. Testünk egyik legnagyobb vérátáramlású szövete.',
    functions: [
      'Oxigénnel és tápanyagokkal látja el az ideghártya külső rétegeit és a fényérzékelő sejteket.',
      'Elvezeti a látás során keletkező hőt, hűtve a szemfenék kényes képleteit.',
      'Sötét melanintartalma elnyeli a felesleges fényt, megakadályozva a belső reflexiókat és növelve a képkontrasztot.'
    ],
    disorders: 'Keringési zavarai és az itt felhalmozódó anyagcseretermékek központi szerepet játszanak az időskori makuladegenerációban (AMD). Gyulladása (chorioiditis) foltos látótérkiesést okozhat.',
    exam: 'Digitális szemfenékfotózás (fundus kamera) és rétegvizsgálat'
  },
  retina: {
    id: 'retina',
    name: 'Ideghártya',
    latin: 'Retina',
    badge: 'A fényérzékelő receptorháló',
    swatch: '#cf7b56',
    intro: 'A szemgolyó hátsó belső falát borító, tíz mikroszkopikus rétegből álló magasan differenciált idegszövet. Kb. 120 millió pálcikát és 6 millió csapot tartalmaz, amelyek a fény fotonjait elektromos idegimpulzusokká alakítják át.',
    functions: [
      'A csapok a nappali, éles, részletgazdag és színes látásért felelnek, sűrűn tömörülve a sárgafoltban.',
      'A pálcikák a szürkületi és éjszakai látást, valamint a perifériás mozgásérzékelést biztosítják.',
      'Összetett idegsejt-hálózata már a szemben elkezdi a képi kontrasztok és mozgások előfeldolgozását.'
    ],
    disorders: 'Magas vérnyomás és cukorbetegség esetén a finom kapillárisok károsodnak (retinopathia), vérzéseket és ödémát okozva. Az ideghártya-leválás (ablatio retinae) fájdalmatlan sürgősségi kórkép, amelyet villanások és sötét függönyszerű látótérkiesés jelez.',
    exam: 'Pupillatágításos szemfenékvizsgálat, digitális nagy felbontású fundusfotó és OCT'
  },
  macula: {
    id: 'macula',
    name: 'Sárgafolt',
    latin: 'Macula lutea & fovea centralis',
    badge: 'Az éleslátás központja',
    swatch: '#a1502b',
    intro: 'Az ideghártya hátsó pólusán található, alig néhány milliméteres, lutein és zeaxantin festékanyagban gazdag terület. Közepén (fovea centralis) található a fényérzékelő csapok legsűrűbb koncentrációja az egész szervezetben.',
    functions: [
      'Biztosítja a látótér tűéles, maximális felbontású fókuszpontját: az olvasás, arcok felismerése és a vezetés mind innen ered.',
      'Sárgás pigmentjei természetes szűrőként elnyelik a káros nagy energiájú kék fényt, védve a fotoreceptorokat.',
      'A teljes látómező többi része ehhez képest alacsonyabb felbontású, tájékozódást segítő periféria.'
    ],
    disorders: 'Időskori sárgafolt-degeneráció (AMD) esetén a látótér közepe homályossá válik, a kontúrok és egyenes vonalak hullámzanak (metamorphopsia). Korai stádiumban Amsler-hálóval otthon is gyorsan ellenőrizhető.',
    exam: 'Amsler-rácsos látásteszt, fókuszált makulavizsgálat és optikai koherencia tomográfia'
  },
  optic: {
    id: 'optic',
    name: 'Látóideg',
    latin: 'Discus nervi optici & nervus opticus',
    badge: 'A látóidegfő és a fő adatkábel',
    swatch: '#e8dbca',
    intro: 'Az a terület a szemfenéken, ahol a retina mintegy 1,2 millió idegrostja egyetlen kötegbe szedődik össze, és a szemgolyót elhagyva az agy látókérge felé veszi az irányt. Mivel itt nincsenek fotoreceptorok, ez a látótér természetes élettani vakfoltja.',
    functions: [
      'A szemben keletkezett teljes képi információt másodpercenként gigabites sebességgel továbbítja az agyba.',
      'Itt lépnek be és ki a szemfenék fő erei (artéria és véna centralis retinae).',
      'Színe, formája, szélei és bemélyedése (excavatio) alapvető orvosi diagnosztikai támpontot nyújt.'
    ],
    disorders: 'A megemelkedett szemnyomás (glaukóma) lassanként elsorvasztja az idegrostokat, visszafordíthatatlan látótérszűkületet okozva. A látóideg gyulladása (neuritis optica) gyors látásromlással és szemmozgáskori fájdalommal hívja fel magára a figyelmet.',
    exam: 'Szemfenéki papillavizsgálat, látótérvizsgálat (perimetria) és szemnyomásmérés'
  }
};

const EYE_HOTSPOTS = [
  // ── BAL FELSŐ SAROK (Top-Left) ──────────────────────────
  {
    id: 'cornea',
    target: { x: 120, y: 460 },
    label: { x: 95, y: 45 },
    side: 'left',
    svgPath: 'M 195 45 L 85 45 L 85 460 L 120 460'
  },
  {
    id: 'ciliary',
    target: { x: 290, y: 310 },
    label: { x: 25, y: 130 },
    side: 'left',
    svgPath: 'M 145 130 L 220 130 L 290 310'
  },
  {
    id: 'aqueous',
    target: { x: 175, y: 430 },
    label: { x: 25, y: 215 },
    side: 'left',
    svgPath: 'M 150 215 L 205 215 L 175 430'
  },

  // ── BAL ALSÓ SAROK (Bottom-Left) ────────────────────────
  {
    id: 'iris',
    target: { x: 215, y: 395 },
    label: { x: 25, y: 755 },
    side: 'left',
    svgPath: 'M 185 755 L 220 755 L 215 395'
  },
  {
    id: 'pupil',
    target: { x: 245, y: 495 },
    label: { x: 25, y: 840 },
    side: 'left',
    svgPath: 'M 130 840 L 245 840 L 245 495'
  },
  {
    id: 'lens',
    target: { x: 335, y: 485 },
    label: { x: 105, y: 925 },
    side: 'left',
    svgPath: 'M 240 925 L 335 925 L 335 485'
  },

  // ── JOBB FELSŐ SAROK (Top-Right) ────────────────────────
  {
    id: 'sclera',
    target: { x: 530, y: 125 },
    label: { x: 895, y: 45 },
    side: 'right',
    svgPath: 'M 785 45 L 530 45 L 530 125'
  },
  {
    id: 'choroid',
    target: { x: 620, y: 220 },
    label: { x: 975, y: 130 },
    side: 'right',
    svgPath: 'M 870 130 L 710 130 L 620 220'
  },
  {
    id: 'retina',
    target: { x: 685, y: 300 },
    label: { x: 975, y: 215 },
    side: 'right',
    svgPath: 'M 855 215 L 760 215 L 685 300'
  },

  // ── JOBB ALSÓ SAROK (Bottom-Right) ──────────────────────
  {
    id: 'macula',
    target: { x: 720, y: 505 },
    label: { x: 975, y: 755 },
    side: 'right',
    svgPath: 'M 870 755 L 780 755 L 720 505'
  },
  {
    id: 'vitreous',
    target: { x: 500, y: 520 },
    label: { x: 975, y: 840 },
    side: 'right',
    svgPath: 'M 865 840 L 650 840 L 500 520'
  },
  {
    id: 'optic',
    target: { x: 840, y: 640 },
    label: { x: 885, y: 925 },
    side: 'right',
    svgPath: 'M 765 925 L 840 925 L 840 640'
  }
];

const EYE_ICONS = {
  what: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M10 8v5M10 5.5v.5"/></svg>',
  role: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="3"/><path d="M16.5 10c0 3.6-2.9 6.5-6.5 6.5S3.5 13.6 3.5 10 6.4 3.5 10 3.5s6.5 2.9 6.5 6.5z"/><path d="M10 1v2M10 17v2M1 10h2M17 10h2"/></svg>',
  risk: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.5 18.2 16.5H1.8L10 2.5z"/><path d="M10 8v4M10 14v.5"/></svg>',
  exam: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="1.5" fill="currentColor"/><path d="M10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5"/></svg>'
};

function initEyeAnatomy() {
  const imgEl = document.getElementById('eye-img');
  const svgEl = document.getElementById('eye-svg');
  const hotspotsLayer = document.getElementById('eye-hotspots-layer');
  const pillsBox = document.getElementById('eye-pills');
  const badgeEl = document.getElementById('eye-badge');
  const titleEl = document.getElementById('eye-title');
  const latinEl = document.getElementById('eye-latin');
  const bodyEl = document.getElementById('eye-body');
  const resetBtn = document.getElementById('eye-reset-btn');

  if (!svgEl || !hotspotsLayer || !bodyEl) return;

  let selectedPartId = null;

  function triggerCardAnimation() {
    if (bodyEl) {
      bodyEl.classList.remove('is-animating');
      void bodyEl.offsetWidth;
      bodyEl.classList.add('is-animating');
    }
    const cardHeader = document.querySelector('.eye-card__header');
    if (cardHeader) {
      cardHeader.classList.remove('is-animating');
      void cardHeader.offsetWidth;
      cardHeader.classList.add('is-animating');
    }
  }

  function renderPlaceholder() {
    badgeEl.textContent = 'Interaktív szemanatómia';
    titleEl.textContent = 'Válasszon egy szemrészletet';
    latinEl.textContent = 'Anatomia oculi humani';

    bodyEl.innerHTML =
      '<div class="eye-placeholder">' +
      '<span class="eye-placeholder__icon">' + EYE_ICONS.role + '</span>' +
      '<p class="eye-placeholder__text">Kattintson az ábrán látható pontokra vagy a feliratokra a szem egyes részeinek megismeréséhez. Minden képlethez részletes orvosi és optometriai leírás tartozik.</p>' +
      '</div>';
  }

  function renderCard(partId) {
    const part = EYE_PARTS[partId];
    if (!part) {
      renderPlaceholder();
      return;
    }

    badgeEl.textContent = part.badge;
    titleEl.textContent = part.name;
    latinEl.textContent = part.latin;

    bodyEl.innerHTML =
      '<div class="eye-info-group">' +
      '<p class="eye-info-label">' + EYE_ICONS.what + ' Mi ez?</p>' +
      '<p class="eye-info-text">' + part.intro + '</p>' +
      '</div>' +

      '<div class="eye-info-group">' +
      '<p class="eye-info-label">' + EYE_ICONS.role + ' Mi a feladata?</p>' +
      '<ul class="eye-info-list">' +
      part.functions.map(f => '<li>' + f + '</li>').join('') +
      '</ul>' +
      '</div>' +

      '<div class="eye-info-group">' +
      '<p class="eye-info-label">' + EYE_ICONS.risk + ' Ha nem működik jól / Elváltozások</p>' +
      '<p class="eye-info-text">' + part.disorders + '</p>' +
      '</div>' +

      '<div class="eye-info-group">' +
      '<p class="eye-info-label">' + EYE_ICONS.exam + ' Így vizsgáljuk az Optikában</p>' +
      '<span class="eye-exam-chip">' + part.exam + '</span>' +
      '</div>';

    triggerCardAnimation();
  }

  function selectPart(partId, triggerScroll = false) {
    selectedPartId = partId;

    // Synchronize UI active states
    svgEl.querySelectorAll('.leader-line').forEach(line => {
      const active = line.getAttribute('data-part') === partId;
      line.classList.toggle('is-active', active);
    });

    svgEl.querySelectorAll('.leader-dot').forEach(dot => {
      const active = dot.getAttribute('data-part') === partId;
      dot.classList.toggle('is-active', active);
    });

    hotspotsLayer.querySelectorAll('.eye-pin').forEach(pin => {
      const active = pin.getAttribute('data-part') === partId;
      pin.classList.toggle('is-active', active);
      pin.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    if (pillsBox) {
      pillsBox.querySelectorAll('.eye-pill').forEach(pill => {
        const active = pill.getAttribute('data-part') === partId;
        pill.classList.toggle('is-active', active);
        pill.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    if (partId) {
      renderCard(partId);
      if (triggerScroll && window.innerWidth < 960) {
        const cardEl = document.getElementById('eye-card');
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    } else {
      renderPlaceholder();
    }
  }

  function renderHotspotsAndPills() {
    svgEl.innerHTML = '';
    hotspotsLayer.innerHTML = '';
    if (pillsBox) pillsBox.innerHTML = '';

    EYE_HOTSPOTS.forEach((item, idx) => {
      const part = EYE_PARTS[item.id];
      if (!part) return;

      const animDelay = (idx * 40) + 'ms';
      const isSelected = selectedPartId === item.id;

      // 1. Leader Line
      let path = null;
      if (item.svgPath) {
        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', item.svgPath);
        path.setAttribute('class', 'leader-line' + (isSelected ? ' is-active' : ''));
        path.setAttribute('data-part', item.id);
        path.style.animationDelay = animDelay;
        path.addEventListener('click', () => selectPart(item.id, true));
        svgEl.appendChild(path);
      }

      // 2. Target Dot
      let dot = null;
      if (item.target) {
        dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', item.target.x);
        dot.setAttribute('cy', item.target.y);
        dot.setAttribute('r', '6.5');
        dot.setAttribute('class', 'leader-dot' + (isSelected ? ' is-active' : ''));
        dot.setAttribute('data-part', item.id);
        dot.style.animationDelay = animDelay;
        dot.addEventListener('click', () => selectPart(item.id, true));
        svgEl.appendChild(dot);
      }

      // 3. Callout Pin Button
      if (item.label) {
        const pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'eye-pin' + (item.side ? ' eye-pin--' + item.side : '') + (isSelected ? ' is-active' : '');
        pin.style.left = (item.label.x / 1000 * 100) + '%';
        pin.style.top = (item.label.y / 1000 * 100) + '%';
        pin.style.animationDelay = animDelay;
        pin.textContent = part.name;
        pin.setAttribute('data-part', item.id);
        pin.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

        // Hover synchronization
        pin.addEventListener('mouseenter', () => {
          if (path) path.classList.add('is-active');
          if (dot) dot.classList.add('is-active');
        });
        pin.addEventListener('mouseleave', () => {
          if (selectedPartId !== item.id) {
            if (path) path.classList.remove('is-active');
            if (dot) dot.classList.remove('is-active');
          }
        });

        if (path) {
          path.addEventListener('mouseenter', () => {
            pin.classList.add('is-active');
            if (dot) dot.classList.add('is-active');
          });
          path.addEventListener('mouseleave', () => {
            if (selectedPartId !== item.id) {
              pin.classList.remove('is-active');
              if (dot) dot.classList.remove('is-active');
            }
          });
        }

        pin.addEventListener('click', () => selectPart(item.id, true));
        hotspotsLayer.appendChild(pin);
      }

      // 4. Quick filter Pill Button (ha létezik a konténer)
      if (pillsBox) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'eye-pill' + (isSelected ? ' is-active' : '');
        pill.setAttribute('data-part', item.id);
        pill.setAttribute('role', 'tab');
        pill.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        pill.style.animationDelay = (idx * 30) + 'ms';
        pill.innerHTML = '<span class="eye-pill__swatch" style="background:' + part.swatch + '"></span>' + part.name;

        pill.addEventListener('click', () => selectPart(item.id, true));
        pillsBox.appendChild(pill);
      }
    });

    if (selectedPartId) {
      renderCard(selectedPartId);
    } else {
      renderPlaceholder();
    }
  }

  // Reset button listener
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      selectPart(null);
    });
  }

  // Initial render
  renderHotspotsAndPills();
}

/* ==========================================================================
   5.5. Interaktív Színlátás Teszt (Ishihara-módszer)
   ========================================================================== */

/* ==========================================================================
   5.5. Interaktív Színlátás Teszt (Ishihara-módszer)
   ========================================================================== */

const COLORBLIND_PLATES_POOL = [
  {
    id: 'p12',
    name: 'Kontroll tesztábra',
    image: 'assets/ishihara/plate-12.webp',
    correct: '12',
    distractors: ['72', '18', '21', '13', '70', '15', '24'],
    type: 'control',
    clinical: 'Minden ember (ép színlátó és színtévesztő is) látja a 12-es számot.'
  },
  {
    id: 'p74',
    name: 'Vörös-zöld tesztábra',
    image: 'assets/ishihara/plate-74.webp',
    correct: '74',
    deutanIllusion: '21',
    distractors: ['21', '71', '47', '24', '77', '14'],
    type: 'red-green',
    clinical: 'Ép színlátással 74-es, vörös-zöld színtévesztéssel 21-es vagy nem kivehető.'
  },
  {
    id: 'p35',
    name: 'Vörös-zöld tesztábra',
    image: 'assets/ishihara/plate-35.webp',
    correct: '35',
    deutanIllusion: '53',
    distractors: ['53', '36', '85', '38', '95', '25'],
    type: 'red-green',
    clinical: 'Ép színlátással tisztán kivehető a 35-ös számjegy.'
  },
  {
    id: 'p42',
    name: 'Transzformációs tesztábra',
    image: 'assets/ishihara/plate-42.webp',
    correct: '42',
    deutanIllusion: '2',
    protanIllusion: '4',
    distractors: ['24', '48', '12', '45', '72', '32'],
    type: 'transformation',
    clinical: 'Ép színlátással 42-es, színtévesztéssel leggyakrabban csak a 2-es vagy 4-es kivehető.'
  },
  {
    id: 'p29',
    name: 'Vörös-zöld tesztábra',
    image: 'assets/ishihara/plate-29.webp',
    correct: '29',
    deutanIllusion: '70',
    distractors: ['70', '28', '79', '20', '92', '26'],
    type: 'red-green',
    clinical: 'Ép színlátással 29-es, vörös-zöld színtévesztéssel 70-es vagy nem kivehető.'
  },
  {
    id: 'p52',
    name: 'Finom árnyalat tesztábra',
    image: 'assets/ishihara/plate-52.webp',
    correct: '52',
    distractors: ['25', '62', '58', '32', '57', '82'],
    type: 'fine-color',
    clinical: 'Ép színlátással tisztán látható az 52-es számjegy.'
  },
  {
    id: 'p4',
    name: 'Finom kontraszt (HRR) tesztábra',
    image: 'assets/ishihara/plate-4.webp',
    correct: '4',
    distractors: ['1', '7', '9', '6', '5', '8', '3'],
    type: 'fine-contrast',
    clinical: 'Szürke alapon halvány zöldes-türkiz 4-es számjegy a finom színkontraszt vizsgálatára.'
  },
  {
    id: 'p16',
    name: 'Vörös-zöld tesztábra',
    image: 'assets/ishihara/plate-16.webp',
    correct: '16',
    distractors: ['18', '76', '10', '15', '61', '19'],
    type: 'red-green',
    clinical: 'Ép színlátással 16-os, színtévesztéssel nem kivehető.'
  },
  {
    id: 'p73',
    name: 'Kék-sárga (Tritan) tesztábra',
    image: 'assets/ishihara/plate-73.webp',
    correct: '73',
    distractors: ['37', '78', '13', '79', '23', '75'],
    type: 'tritan',
    clinical: 'Sárgás-borostyán alapon indigókék/lila 73-as számjegy a ritkább kék-sárga (tritán) és finom színkontraszt vizsgálatára.'
  },
  {
    id: 'p7',
    name: 'Vörös-zöld eltűnő (vanishing) tesztábra',
    image: 'assets/ishihara/plate-7.webp',
    correct: '7',
    distractors: ['1', '4', '2', '9', '8', '3'],
    type: 'vanishing',
    clinical: 'Ép színlátással tisztán 7-es; színtévesztéssel elmosódik a háttérben.'
  }
];

function initColorBlindnessTest() {
  const quizEl = document.getElementById('cb-quiz');
  const resultEl = document.getElementById('cb-result');
  const plateImg = document.getElementById('cb-plate-img');
  const stepBadge = document.getElementById('cb-step-badge');
  const plateName = document.getElementById('cb-plate-name');
  const progressFill = document.getElementById('cb-progress-fill');
  const optionsGrid = document.getElementById('cb-options-grid');

  if (!quizEl || !resultEl || !plateImg || !optionsGrid) return;

  let currentStep = 0;
  let activePlates = [];
  const userAnswers = [];

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startQuiz() {
    currentStep = 0;
    userAnswers.length = 0;

    // Az ÖSSZES (mind a 10) ábra teljesen véletlenszerű sorrendben jelenik meg minden tesztindításkor
    activePlates = shuffle(COLORBLIND_PLATES_POOL);

    quizEl.hidden = false;
    resultEl.hidden = true;
    loadStep(0);
  }

  function generateRandomOptions(plate) {
    const correct = String(plate.correct);
    const isSingleDigit = correct.length === 1;
    const poolSet = new Set();

    // 1. Speciális színtévesztő illúziók hozzáadása
    if (plate.deutanIllusion && plate.deutanIllusion !== correct) {
      poolSet.add(String(plate.deutanIllusion));
    }
    if (plate.protanIllusion && plate.protanIllusion !== correct) {
      poolSet.add(String(plate.protanIllusion));
    }

    // 2. Beépített hiteles alternatívák hozzáadása
    if (Array.isArray(plate.distractors)) {
      plate.distractors.forEach(d => {
        if (String(d) !== correct) poolSet.add(String(d));
      });
    }

    // 3. Dinamikusan generált random számok hozzáadása a gazdag választékért
    if (isSingleDigit) {
      const singleDigits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
      singleDigits.forEach(n => {
        if (n !== correct) poolSet.add(n);
      });
    } else {
      const num = parseInt(correct, 10);
      // Fordított számjegyek (pl. 74 -> 47)
      const reversed = correct.split('').reverse().join('');
      if (reversed !== correct && reversed.length === 2 && !reversed.startsWith('0')) {
        poolSet.add(reversed);
      }
      // Közeli és random 2-jegyű számok
      [-10, -5, -2, -1, 1, 2, 5, 10].forEach(offset => {
        const val = num + offset;
        if (val >= 10 && val <= 99 && String(val) !== correct) {
          poolSet.add(String(val));
        }
      });
      while (poolSet.size < 12) {
        const rnd = String(Math.floor(Math.random() * 89) + 10);
        if (rnd !== correct) poolSet.add(rnd);
      }
    }

    // Kiválasztunk 3 véletlenszerű egyedi tévesztő számot
    const poolArray = shuffle(Array.from(poolSet));
    const selectedDistractors = poolArray.slice(0, 3);

    // Összekeverjük a 4 gombot (helyes válasz + 3 tévesztő) — így a helyes válasz pozíciója teljesen random!
    return shuffle([correct, ...selectedDistractors]);
  }

  function loadStep(stepIndex) {
    const item = activePlates[stepIndex];
    if (!item) return;

    // Progress UI
    if (stepBadge) stepBadge.textContent = `${stepIndex + 1} / ${activePlates.length}. ábra`;
    if (plateName) plateName.textContent = `${stepIndex + 1}. Tesztábra — ${item.name}`;
    if (progressFill) {
      const pct = ((stepIndex + 1) / activePlates.length) * 100;
      progressFill.style.width = `${pct}%`;
    }

    // Plate image transition
    plateImg.classList.add('is-transitioning');
    setTimeout(() => {
      plateImg.src = item.image;
      plateImg.alt = `Ishihara tesztábra: ${item.name}`;
      plateImg.onload = () => {
        plateImg.classList.remove('is-transitioning');
      };
      setTimeout(() => plateImg.classList.remove('is-transitioning'), 100);
    }, 150);

    // Options buttons - minden alkalommal random számok és random pozíciók!
    optionsGrid.innerHTML = '';
    const currentOptions = generateRandomOptions(item);

    currentOptions.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cb-btn';
      btn.textContent = opt;
      btn.setAttribute('aria-label', `Válasz: ${opt}`);
      btn.addEventListener('click', () => handleAnswer(opt));
      optionsGrid.appendChild(btn);
    });

    // "Nem látok számot" option
    const noneBtn = document.createElement('button');
    noneBtn.type = 'button';
    noneBtn.className = 'cb-btn cb-btn--none';
    noneBtn.innerHTML = `
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" style="margin-right:6px; flex-shrink:0;">
        <circle cx="10" cy="10" r="7.5"/>
        <line x1="4.5" y1="4.5" x2="15.5" y2="15.5"/>
      </svg>
      Nem látok számot / Nem kivehető
    `;
    noneBtn.addEventListener('click', () => handleAnswer('none'));
    optionsGrid.appendChild(noneBtn);
  }

  function handleAnswer(answer) {
    userAnswers[currentStep] = answer;
    currentStep++;

    if (currentStep < activePlates.length) {
      loadStep(currentStep);
    } else {
      showResults();
    }
  }

  function showResults() {
    quizEl.hidden = true;
    resultEl.hidden = false;

    let correctCount = 0;
    let deutanPoints = 0;
    let protanPoints = 0;
    let noneCount = 0;

    activePlates.forEach((plate, idx) => {
      const ans = userAnswers[idx];
      if (ans === plate.correct) {
        correctCount++;
      } else if (ans === 'none') {
        noneCount++;
      }

      if (plate.deutanIllusion && ans === plate.deutanIllusion) {
        deutanPoints += 2;
      }
      if (plate.protanIllusion && ans === plate.protanIllusion) {
        protanPoints += 2;
      }
    });

    const total = activePlates.length;

    let resultBadgeClass = 'cb-result-badge--success';
    let resultBadgeText = 'Ép színérzékelés';
    let resultTitle = 'Normál Színlátás (Trichromát)';
    let summaryText = `Kiváló eredmény! A teszt mind a ${total} ábráját (${correctCount} / ${total}) hibátlanul azonosította. Az Ön színérzékelése a vörös, zöld és kék spektrum teljes tartományában éles és kiegyensúlyozott.`;
    let physiologyText = 'A retina mindhárom típusú csapsejtje (L-vörös, M-zöld, S-kék) egészségesen működik, a látóideg pontos spektrális jeleket továbbít az agy látókérgébe. Ez maximális biztonságot nyújt a gépjárművezetésben és a vizuális munkavégzésben.';
    let adviceText = 'Az ép színlátás érték! Évente egy rutin optometriai és szemfenéki kontroll javasolt a retina és a látóidegfő tartós épségének megőrzésére.';

    if (correctCount >= total - 1) {
      // 9-10 helyes -> Normál
    } else if (correctCount >= 6) {
      // 6-8 helyes -> Enyhe eltérés
      resultBadgeClass = 'cb-result-badge--warning';

      if (deutanPoints > protanPoints) {
        resultBadgeText = 'Deuteranomália gyanúja';
        resultTitle = 'Zöldérzékenységi Eltérés (Deuteranomália)';
        summaryText = `A teszten ${total}-ból ${correctCount} ábrát azonosított sikeresen. A válaszok mintázata a zöld-érzékeny receptorok (M-csapok) enyhe eltolódására utal.`;
        physiologyText = 'A deuteranomália a leggyakoribb színtévesztési forma (a színtévesztők ~75%-a). Bizonyos zöld és vörös, illetve pasztell árnyalatok egymáshoz közelivé válhatnak.';
      } else if (protanPoints > deutanPoints) {
        resultBadgeText = 'Protanomália gyanúja';
        resultTitle = 'Vörösérzékenységi Eltérés (Protanomália)';
        summaryText = `A teszten ${total}-ból ${correctCount} ábrát azonosított sikeresen. A válaszok mintázata a vörös-érzékeny receptorok (L-csapok) érzékenységcsökkenésére utal.`;
        physiologyText = 'Protanomália esetén a mélyvörös árnyalatok tompábbnak, sötétebbnek látszódhatnak, és a piros-barna-sárga színek összefolyhatnak.';
      } else {
        resultBadgeText = 'Enyhe színtévesztés gyanúja';
        resultTitle = 'Vörös-Zöld Színérzékelési Eltérés';
        summaryText = `A teszten ${total}-ból ${correctCount} ábrát ismert fel helyesen. Néhány ábránál tapasztalt bizonytalanság enyhe spektrális eltolódást (anomális trichromázia) valószínűsít.`;
        physiologyText = 'A vörös-zöld színtévesztés genetikai adottság (férfiak ~8%-a, nők ~0.5%-a), amely bizonyos színpárok kontrasztját csökkenti.';
      }

      adviceText = 'Feltétlenül érdemes hozzánk fordulnia! Szakrendelésünkön műszeres anomaloszkóppal pontosan kimérjük az eltérést, és speciális spektrális korrekciós lencséket illesztünk, amelyek látványosan fokozzák a színek élénkségét.';
    } else {
      // <= 5 helyes -> Kifejezett színtévesztés
      resultBadgeClass = 'cb-result-badge--alert';
      resultBadgeText = 'Színtévesztés valószínű';
      resultTitle = 'Kifejezett Vörös-Zöld Színtévesztés';
      summaryText = `A ${total} ábrából ${correctCount} számjegyet sikerült azonosítani (${noneCount} esetben nem volt kivehető szám). Az eredmény kifejezettebb színlátási eltérést (dichromázia vagy erős anomália) jelez.`;
      physiologyText = 'A vörös és zöld színek megkülönböztetése a mindennapokban (pl. jelzőlámpák, térképek, grafikonok, elektromos vezetékek színkódjai) nehézséget okozhat.';
      adviceText = 'Javasoljuk optometriai szakvizsgálatunkat! Segítünk a pontos diagnózis felállításában (pl. jogosítványhoz), és egyénre szabott színszűrős szemüveglencsékkel segítünk a színkontraszt helyreállításában.';
    }

    resultEl.innerHTML = `
      <div class="cb-result__header">
        <span class="cb-result-badge ${resultBadgeClass}">
          <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor">
            <circle cx="10" cy="10" r="6"/>
          </svg>
          ${resultBadgeText}
        </span>
        <h3 class="cb-result__title">${resultTitle}</h3>
        <p class="cb-result__score">Eredmény: <strong>${correctCount} / ${total}</strong> helyes felismerés</p>
      </div>

      <div class="cb-result__grid">
        <div class="cb-result-box">
          <span class="cb-result-box__label">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="10" cy="10" r="8"/>
              <line x1="10" y1="9" x2="10" y2="14"/>
              <circle cx="10" cy="6.2" r=".7" fill="currentColor" stroke="none"/>
            </svg>
            1. Eredmény értelmezése
          </span>
          <p class="cb-result-box__text">${summaryText}</p>
        </div>

        <div class="cb-result-box">
          <span class="cb-result-box__label">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="10" cy="10" r="7"/>
              <path d="M10 7v3l2 2"/>
            </svg>
            2. Élettani háttér & hatások
          </span>
          <p class="cb-result-box__text">${physiologyText}</p>
        </div>

        <div class="cb-result-box">
          <span class="cb-result-box__label">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 4h12v12H4z"/>
              <path d="M8 10l2 2 4-4"/>
            </svg>
            3. Érdemes hozzánk fordulni?
          </span>
          <p class="cb-result-box__text">${adviceText}</p>
        </div>
      </div>

      <div class="cb-result__actions">
        <button type="button" class="btn btn-primary" id="cb-booking-btn">
          Időpontfoglalás Szemvizsgálatra
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 10h12M11 5l5 5-5 5"/>
          </svg>
        </button>
        <button type="button" class="cb-btn-retest" id="cb-retest-btn">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3.4 10a6.6 6.6 0 1 0 1.93-4.67"/>
            <path d="M3 3v3.6h3.6"/>
          </svg>
          Teszt újraindítása (Új véletlenszerű sorrenddel)
        </button>
      </div>
    `;

    // Booking button event
    const bookBtn = document.getElementById('cb-booking-btn');
    if (bookBtn) {
      bookBtn.addEventListener('click', () => {
        const bookingDialog = document.getElementById('booking-dialog');
        if (bookingDialog && typeof bookingDialog.showModal === 'function') {
          bookingDialog.showModal();
          document.body.classList.add('dialog-open');
        }
      });
    }

    // Retest button event
    const retestBtn = document.getElementById('cb-retest-btn');
    if (retestBtn) {
      retestBtn.addEventListener('click', () => {
        startQuiz();
      });
    }

    // Scroll slightly to top of card if needed
    const cardEl = document.getElementById('cb-card');
    if (cardEl && window.innerWidth < 960) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // Start initial quiz session with randomized ordering
  startQuiz();
}

/* ==========================================================================
   6. Szolgáltatás Részletek Ablak (Kezelések & Vizsgálatok kártyák)
   ========================================================================== */

/*
 * A "Kezelések & Vizsgálatok" kártyák tartalma.
 * A kulcs a kártya gombján lévő data-service értéke.
 *
 * KÉP BEILLESZTÉSE: az `image` mezőbe írd be a kép elérési útját
 * (pl. 'assets/service-latasvizsgalat-1200.webp'), az `imageAlt` mezőbe pedig
 * a képhez tartozó rövid leírást. Amíg az `image` üres, egy semleges
 * helyőrző látszik a részletek ablak tetején.
 */
const SERVICE_DETAILS = {
  '1': {
    title: 'Komplett Optometriai Látásvizsgálat',
    duration: '45 perc',
    price: '12 000 Ft',
    bookingService: 'general-exam',
    image: 'assets/service-latasvizsgalat.webp',
    imageAlt: 'Komplett optometriai látásvizsgálat korszerű digitális diagnosztikai eszközökkel',
    intro: 'A komplett optometriai látásvizsgálat sokkal több egyszerű dioptria-meghatározásnál: a szem teljes fénytörési állapotát és a két szem együttműködését is feltérképezzük. A vizsgálat teljesen fájdalommentes, semmilyen előkészületet nem igényel, és a végén részletesen elmagyarázzuk az eredményeket.',
    list: [
      'Anamnézis felvétele: panaszok, munkakörülmények, korábbi szemüvegek áttekintése.',
      'Automata refraktométeres előmérés a kiindulási értékek gyors meghatározásához.',
      'Szubjektív finomhangolás próbakerettel, távolra és közelre egyaránt.',
      'Asztigmia tengelyének és mértékének pontos meghatározása.',
      'Binokuláris egyensúly és térlátás ellenőrzése.',
      'Szemnyomás- és elülső szegmens szűrés, szükség esetén szakorvosi továbbirányítás.'
    ],
    outro: 'A vizsgálat végén írásos recept formájában megkapja az eredményt, amellyel bárhol elkészíttetheti a szemüvegét — nálunk természetesen azonnal tovább is léphet a keret- és lencseválasztásra.'
  },

  '2': {
    title: 'Kontaktlencse Illesztés & Tanácsadás',
    duration: '60 perc',
    price: '15 000 Ft',
    bookingService: 'contact-lens',
    image: 'assets/service-kontaktlencse.webp',
    imageAlt: 'Kontaktlencse illesztés, réslámpás vizsgálat és betanítási tanácsadás',
    intro: 'A kontaktlencse nem polcról levehető termék: minden szem szaruhártyája más görbületű és más könnyfilmmel dolgozik. Ezért az illesztés mindig méréssel kezdődik, és csak akkor engedjük haza a lencsével, ha az kényelmesen ül és Ön magabiztosan kezeli.',
    list: [
      'Szaruhártya-görbület és pupillaátmérő mérése, könnyfilm-vizsgálat.',
      'A megfelelő lencsetípus kiválasztása: napi, havi, tórikus vagy multifokális.',
      'Próbalencse felhelyezése és a lencse mozgásának ellenőrzése réslámpával.',
      'Gyakorlati betanítás: fel- és levétel, tárolás, tisztítás lépésről lépésre.',
      'Viselési és higiéniai szabályok, valamint a cserélési rend átbeszélése.',
      'Ingyenes kontrollvizsgálat az első hetekben a tolerancia ellenőrzésére.'
    ],
    outro: 'Az illesztés díja tartalmazza a próbalencséket és az első kontrollt is. Kezdőknek külön időt szánunk a betanításra — addig maradunk, amíg a felhelyezés magától megy.'
  },

  '3': {
    title: 'Szemüvegkészítés & Lencse-választás',
    duration: '30 perc',
    price: 'Ingyenes *',
    bookingService: 'glasses-fitting',
    image: 'assets/service-szemuvegkiszolgalas.webp',
    imageAlt: 'Szemüvegkeret és prémium lencse választás személyre szabott szaktanácsadással',
    intro: 'Egy jó szemüveg két döntésen múlik: a kereten, amelyet nap mint nap visel, és a lencsén, amelyen keresztül néz. Tanácsadásunkon mindkettőt végigvesszük — arcformához, életmódhoz és a napi látási feladatokhoz igazítva.',
    list: [
      'Arcforma- és archossz-elemzés, keretjavaslat a gyűjteményünkből.',
      'Pupillatávolság és beállítási magasság precíziós, digitális mérése.',
      'Lencseanyag választása: vékonyított, ütésálló vagy könnyített kivitel.',
      'Bevonatok áttekintése: tükröződésmentes, karcálló, kékfényszűrő, fényre sötétedő.',
      'Multifokális és irodai lencsék bemutatása, a látómezők őszinte összehasonlítása.',
      'A kész szemüveg díjmentes beállítása és utánigazítása az átvételkor.'
    ],
    outro: '* A tanácsadás keret vagy lencse vásárlása esetén ingyenes, egyébként 8 000 Ft. A kész szemüveget általában 3-5 munkanapon belül átveheti.'
  },

  '4': {
    title: 'Szemüveg Javítás',
    duration: '15-30 perc',
    price: '2 500 Ft-tól',
    bookingService: 'glasses-repair',
    image: 'assets/service-szemuvegjavitas.webp',
    imageAlt: 'Szemüvegjavítás és finombeállítás precíziós optikai műhelyben',
    intro: 'Egy elpattant szár vagy egy kilazult csavar miatt nem kell új szemüveget vennie. Precíziós műhelyünkben a legtöbb hibát helyben, várakozás közben orvosoljuk — és csak azután kezdünk neki, hogy a javítás módját és árát is átbeszéltük Önnel.',
    list: [
      'Kilazult csavarok utánhúzása, hiányzó csavarok és orrtámaszok pótlása.',
      'Elgörbült keret és szárak visszaállítása, az illeszkedés újraigazítása.',
      'Kipattant lencsék visszahelyezése, damilos keretek damiljának cseréje.',
      'Törött fémkeretek forrasztása, műanyag keretek szakszerű rögzítése.',
      'Csuklópántok és zsanérok javítása vagy cseréje.',
      'Ultrahangos tisztítás és a keret átvizsgálása minden javítás után.'
    ],
    outro: 'A pontos árat mindig a hiba felmérése után mondjuk meg, és csak az Ön jóváhagyásával kezdünk hozzá. Nálunk vásárolt szemüveg esetén az utánigazítás és a csavarpótlás a garanciaidő alatt díjmentes. Egyszerűbb javításokat bejelentkezés nélkül is elvégzünk nyitvatartási időben.'
  }
};

function initServiceDetails() {
  const dialog = document.getElementById('service-dialog');
  if (!dialog) return;

  const triggers = document.querySelectorAll('.service-details-trigger');
  const titleEl = document.getElementById('service-dialog-title');
  const durationEl = document.getElementById('service-detail-duration');
  const priceEl = document.getElementById('service-detail-price');
  const bodyEl = document.getElementById('service-detail-body');
  const imageEl = document.getElementById('service-detail-image');
  const placeholderEl = document.getElementById('service-detail-placeholder');
  const closeBtn = document.getElementById('service-dialog-close-btn');
  const closeActionBtn = document.getElementById('service-detail-close-btn');

  function renderService(id) {
    const data = SERVICE_DETAILS[id];
    if (!data) return false;

    titleEl.textContent = data.title;
    durationEl.textContent = data.duration;
    priceEl.textContent = data.price;

    // Kép: amíg nincs megadva, a helyőrző marad látható
    if (data.image) {
      imageEl.src = data.image;
      imageEl.alt = data.imageAlt || data.title;
      imageEl.hidden = false;
      placeholderEl.hidden = true;
    } else {
      imageEl.removeAttribute('src');
      imageEl.alt = '';
      imageEl.hidden = true;
      placeholderEl.hidden = false;
    }

    const listItems = data.list.map(item => `<li>${item}</li>`).join('');
    bodyEl.innerHTML = `
      <p class="service-detail-lead">${data.intro}</p>
      <h3 class="service-detail-subtitle">Mit tartalmaz?</h3>
      <ul class="service-detail-list">${listItems}</ul>
      <p class="service-detail-note">${data.outro}</p>
    `;

    return true;
  }

  triggers.forEach(btn => {
    btn.addEventListener('click', () => {
      if (renderService(btn.getAttribute('data-service'))) {
        dialog.showModal();
      }
    });
  });

  [closeBtn, closeActionBtn].forEach(btn => {
    if (btn) btn.addEventListener('click', () => dialog.close());
  });
}

/* ==========================================================================
   7. Online Időpontfoglaló Rendszer (Többlépcsős naptár)
   ========================================================================== */
function initBookingSystem() {
  const dialog = document.getElementById('booking-dialog');
  const form = document.getElementById('booking-form');
  const openButtons = document.querySelectorAll('[aria-haspopup="dialog"]');
  const closeBtn = document.getElementById('dialog-close-btn');

  // Lépések paneljei és indikátorai
  const steps = document.querySelectorAll('.booking-step-panel');
  const stepIndicators = document.querySelectorAll('.progress-step');
  const progressBarFill = document.getElementById('progress-bar-fill');

  // Navigációs gombok
  const btnToStep2 = document.getElementById('btn-to-step2');
  const btnBackToStep1 = document.getElementById('btn-back-to-step1');
  const btnToStep3 = document.getElementById('btn-to-step3');
  const btnBackToStep2 = document.getElementById('btn-back-to-step2');
  const btnCloseBooking = document.getElementById('btn-close-booking');

  // Naptár elemei
  const prevMonthBtn = document.getElementById('prev-month');
  const nextMonthBtn = document.getElementById('next-month');
  const monthYearLabel = document.getElementById('calendar-month-year');
  const daysGrid = document.getElementById('calendar-days-grid');
  const selectedDayLabel = document.getElementById('selected-day-label');
  const slotsContainer = document.getElementById('time-slots-container');

  if (!dialog || !form) return;

  // Foglalási állapotok tárolása
  let bookingState = {
    step: 1,
    service: 'general-exam',
    date: null, // Date objektum
    time: null, // string "09:00"
    name: '',
    email: '',
    phone: '',
    message: ''
  };

  // Aktuálisan megjelenített naptári hónap/év
  let currentCalDate = new Date();

  // Dialog megnyitása gombokkal
  openButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();

      resetBooking();

      // Ha a részletek ablakból indult, automatikusan jelölje be a megfelelő szolgáltatást.
      // Fontos: a resetBooking() után kell beállítani, mert a form.reset() visszaállítaná.
      const serviceValue = btn.getAttribute('data-booking-service');
      if (serviceValue) {
        const radios = form.elements['booking-service'];
        if (radios) radios.value = serviceValue;
      }

      dialog.showModal();
    });
  });

  // Bezáró gomb
  if (closeBtn) {
    closeBtn.addEventListener('click', () => dialog.close());
  }

  // Foglalás alaphelyzetbe állítása
  function resetBooking() {
    bookingState = {
      step: 1,
      service: 'general-exam',
      date: null,
      time: null,
      name: '',
      email: '',
      phone: '',
      message: ''
    };
    currentCalDate = new Date();
    form.reset();

    // Form errorok levétele
    document.querySelectorAll('.form-group, .form-check-group').forEach(grp => grp.classList.remove('invalid'));

    goToStep(1);
    renderCalendar();
  }

  // Lépésváltó fő funkció
  function goToStep(stepNum) {
    const prevStep = bookingState.step;
    bookingState.step = stepNum;

    // Haladási irány meghatározása (forward/backward) a CSS animációkhoz
    const directionClass = stepNum > prevStep ? 'slide-forward' : 'slide-backward';

    // Panelek láthatósága és animációs osztályai
    steps.forEach(panel => {
      const panelStep = parseInt(panel.getAttribute('data-step'));
      if (panelStep === stepNum) {
        panel.classList.add('active');
        panel.classList.remove('slide-forward', 'slide-backward');
        void panel.offsetWidth; // Force reflow a CSS animáció újraindításához
        panel.classList.add(directionClass);
      } else {
        panel.classList.remove('active', 'slide-forward', 'slide-backward');
      }
    });

    // Haladási indikátorok
    stepIndicators.forEach(ind => {
      const indStep = parseInt(ind.getAttribute('data-step'));
      ind.classList.toggle('active', indStep <= stepNum);
    });

    // ProgressBar csík kitöltése százalékban
    const percentages = { 1: 25, 2: 50, 3: 75, 4: 100 };
    progressBarFill.style.width = `${percentages[stepNum]}%`;

    // Ha a 2-es lépésre lépünk, generáljuk a naptárat
    if (stepNum === 2) {
      renderCalendar();
      validateStep2Button();
    }
  }

  // --- Lépésről-lépésre gomb navigációk ---

  // 1 -> 2 lépés
  btnToStep2.addEventListener('click', () => {
    // Mentjük a kiválasztott szolgáltatást
    const selectedRadio = form.querySelector('input[name="booking-service"]:checked');
    if (selectedRadio) {
      bookingState.service = selectedRadio.value;
    }
    goToStep(2);
  });

  // 2 -> 1 lépés
  btnBackToStep1.addEventListener('click', () => goToStep(1));

  // 2 -> 3 lépés
  btnToStep3.addEventListener('click', () => {
    if (bookingState.date && bookingState.time) {
      goToStep(3);
    }
  });

  // 3 -> 2 lépés
  btnBackToStep2.addEventListener('click', () => goToStep(2));

  // Kész bezárás
  if (btnCloseBooking) {
    btnCloseBooking.addEventListener('click', () => dialog.close());
  }

  // --- Naptár Generálás ---
  const hungarianMonths = [
    'Január', 'Február', 'Március', 'Április', 'Május', 'Június',
    'Július', 'Augusztus', 'Szeptember', 'Október', 'November', 'December'
  ];

  function renderCalendar() {
    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();

    // Hónap és év kiírása
    monthYearLabel.textContent = `${year}. ${hungarianMonths[month]}`;

    // Átmeneti effekt a naptárhoz (halványítás)
    daysGrid.style.opacity = '0';
    daysGrid.style.transform = 'scale(0.98)';
    daysGrid.style.transition = 'none';

    // Naptár rács ürítése
    daysGrid.innerHTML = '';

    // Első nap indexe a héten (0: vasárnap, 1: hétfő ... 6: szombat)
    // Magyar naptár miatt hétfővel kell kezdeni, így eltoljuk
    let firstDayIndex = new Date(year, month, 1).getDay();
    firstDayIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1; // Hétfő lesz a 0. index

    // Hónap napjainak száma
    const totalDays = new Date(year, month + 1, 0).getDate();

    // Előző hónap utolsó napjainak száma (kitöltéshez)
    const prevMonthTotalDays = new Date(year, month, 0).getDate();

    // 1. Előző hónap utolsó napjai halványan
    for (let i = firstDayIndex; i > 0; i--) {
      const dayNum = prevMonthTotalDays - i + 1;
      const btn = createDayButton(dayNum, true, true);
      daysGrid.appendChild(btn);
    }

    // Aktuális dátum adatai az inaktív napok szűréséhez
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 2. Aktuális hónap napjai
    for (let day = 1; day <= totalDays; day++) {
      const thisDayDate = new Date(year, month, day);
      const dayOfWeek = thisDayDate.getDay(); // 0: Vasárnap

      // Korábbi napok letiltása
      const isPast = thisDayDate < today;

      // Vasárnap le van tiltva (zárva vagyunk)
      const isSunday = dayOfWeek === 0;

      const isDisabled = isPast || isSunday;

      const btn = createDayButton(day, false, isDisabled);

      // Ha ez a nap van kiválasztva, adjuk hozzá a kijelölést
      if (bookingState.date &&
        bookingState.date.getDate() === day &&
        bookingState.date.getMonth() === month &&
        bookingState.date.getFullYear() === year) {
        btn.classList.add('selected');
      }

      btn.addEventListener('click', () => {
        // Kijelölések törlése
        daysGrid.querySelectorAll('.calendar-day-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');

        bookingState.date = new Date(year, month, day);
        bookingState.time = null; // új nap választásakor az órát alaphelyzetbe hozzuk

        // Idősávok frissítése
        renderTimeSlots();
        validateStep2Button();
      });

      daysGrid.appendChild(btn);
    }

    // 3. Következő hónap első napjai (hogy 42 cella legyen meg)
    const totalRendered = firstDayIndex + totalDays;
    const remainingCells = 42 - totalRendered;
    for (let day = 1; day <= remainingCells; day++) {
      const btn = createDayButton(day, true, true);
      daysGrid.appendChild(btn);
    }

    // Finom animációs tranzíció befejezése
    requestAnimationFrame(() => {
      daysGrid.style.transition = 'opacity 0.25s ease-out, transform 0.25s ease-out';
      daysGrid.style.opacity = '1';
      daysGrid.style.transform = 'scale(1)';
    });
  }

  function createDayButton(num, isOtherMonth, isDisabled) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'calendar-day-btn';
    btn.textContent = num;
    btn.setAttribute('role', 'gridcell');

    if (isOtherMonth) {
      btn.classList.add('other-month');
    }
    if (isDisabled) {
      btn.disabled = true;
    }
    return btn;
  }

  // Hónap léptetések
  prevMonthBtn.addEventListener('click', () => {
    // Nem engedjük a múltba pörgetni a naptárat
    const today = new Date();
    if (currentCalDate.getFullYear() > today.getFullYear() ||
      (currentCalDate.getFullYear() === today.getFullYear() && currentCalDate.getMonth() > today.getMonth())) {
      currentCalDate.setMonth(currentCalDate.getMonth() - 1);
      renderCalendar();
    }
  });

  nextMonthBtn.addEventListener('click', () => {
    currentCalDate.setMonth(currentCalDate.getMonth() + 1);
    renderCalendar();
  });

  // --- Idősávok Generálása ---
  const standardTimeSlots = [
    '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'
  ];

  function renderTimeSlots() {
    // Átmeneti effekt az idősávokhoz
    slotsContainer.style.opacity = '0';
    slotsContainer.style.transform = 'translateY(8px)';
    slotsContainer.style.transition = 'none';

    slotsContainer.innerHTML = '';

    if (!bookingState.date) {
      selectedDayLabel.textContent = 'Válasszon egy napot';
      slotsContainer.innerHTML = '<p class="time-placeholder">Kérjük, először kattintson egy napra a naptárban!</p>';
      
      requestAnimationFrame(() => {
        slotsContainer.style.transition = 'opacity 0.25s ease-out, transform 0.25s ease-out';
        slotsContainer.style.opacity = '1';
        slotsContainer.style.transform = 'translateY(0)';
      });
      return;
    }

    const formattedDate = `${bookingState.date.getFullYear()}. ${hungarianMonths[bookingState.date.getMonth()]} ${bookingState.date.getDate()}.`;
    selectedDayLabel.textContent = `Szabad időpontok: ${formattedDate}`;

    // Szimulált véletlenszerű foglalt órák generálása a realisztikusságért
    // (A nap számából generálunk egy magot, hogy konzisztens maradjon az újrakattintáskor)
    const daySeed = bookingState.date.getDate();

    standardTimeSlots.forEach((slot, index) => {
      // Pl. a nap száma + az index alapján minden 3. vagy 4. óra foglalt
      const isBooked = (daySeed + index * 7) % 3 === 0;

      const label = document.createElement('label');
      label.className = 'time-slot-label';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'booking-time-slot';
      input.value = slot;
      if (isBooked) input.disabled = true;

      // Ha ez az idősáv volt kiválasztva
      if (bookingState.time === slot) {
        input.checked = true;
      }

      input.addEventListener('change', () => {
        bookingState.time = slot;
        validateStep2Button();
      });

      const inner = document.createElement('div');
      inner.className = 'time-slot-inner';
      inner.textContent = slot;

      label.appendChild(input);
      label.appendChild(inner);
      slotsContainer.appendChild(label);
    });

    requestAnimationFrame(() => {
      slotsContainer.style.transition = 'opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
      slotsContainer.style.opacity = '1';
      slotsContainer.style.transform = 'translateY(0)';
    });
  }

  // 2. Lépés Gomb Validáció (Dátum + Idő megléte kell a továbbhaladáshoz)
  function validateStep2Button() {
    const isValid = bookingState.date !== null && bookingState.time !== null;
    btnToStep3.disabled = !isValid;
  }

  // --- Lépés 3: Form Submit és Validáció ---
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    // Validáció futtatása manuálisan
    const nameInput = document.getElementById('booking-name');
    const emailInput = document.getElementById('booking-email');
    const phoneInput = document.getElementById('booking-phone');
    const messageInput = document.getElementById('booking-message');
    const termsInput = document.getElementById('booking-terms');
    const gdprInput = document.getElementById('booking-gdpr');

    let isFormValid = true;

    // Név
    if (!nameInput.value.trim()) {
      showError(nameInput, true);
      isFormValid = false;
    } else {
      showError(nameInput, false);
    }

    // E-mail regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailInput.value.trim())) {
      showError(emailInput, true);
      isFormValid = false;
    } else {
      showError(emailInput, false);
    }

    // Telefon regex (magyar formátumok pl: +36301234567, 06301234567 stb.)
    const phoneRegex = /^(\+36|06)[1-9][0-9]{8}$/;
    const cleanedPhone = phoneInput.value.trim().replace(/[\s-]/g, ''); // szóközök/kötőjelek kiszűrése tesztre
    if (!phoneRegex.test(cleanedPhone)) {
      showError(phoneInput, true);
      isFormValid = false;
    } else {
      showError(phoneInput, false);
    }

    // Házirend és ÁSZF elfogadás
    if (termsInput && !termsInput.checked) {
      showError(termsInput, true);
      isFormValid = false;
    } else if (termsInput) {
      showError(termsInput, false);
    }

    // Adatkezelési tájékoztató elfogadás
    if (gdprInput && !gdprInput.checked) {
      showError(gdprInput, true);
      isFormValid = false;
    } else if (gdprInput) {
      showError(gdprInput, false);
    }

    if (!isFormValid) return;

    // Adatok mentése a belső állapotba
    bookingState.name = nameInput.value.trim();
    bookingState.email = emailInput.value.trim();
    bookingState.phone = phoneInput.value.trim();
    bookingState.message = messageInput.value.trim();

    // Mentés LocalStorage-ba
    saveBookingToLocalStorage(bookingState);

    // Kártya összesítő kiírása
    renderSummaryCard();

    // Lépés a sikeres panelre
    goToStep(4);
  });

  // Élő hibatörlés
  const nameInp = document.getElementById('booking-name');
  const emailInp = document.getElementById('booking-email');
  const phoneInp = document.getElementById('booking-phone');
  const termsInp = document.getElementById('booking-terms');
  const gdprInp = document.getElementById('booking-gdpr');

  if (nameInp) nameInp.addEventListener('input', () => showError(nameInp, false));
  if (emailInp) emailInp.addEventListener('input', () => showError(emailInp, false));
  if (phoneInp) phoneInp.addEventListener('input', () => showError(phoneInp, false));
  if (termsInp) termsInp.addEventListener('change', () => showError(termsInp, !termsInp.checked));
  if (gdprInp) gdprInp.addEventListener('change', () => showError(gdprInp, !gdprInp.checked));

  function showError(inputEl, isError) {
    const group = inputEl.closest('.form-group, .form-check-group');
    if (group) {
      group.classList.toggle('invalid', isError);
    }
  }

  // Szolgáltatásnevek magyarítása a visszaigazoláshoz
  const serviceNames = {
    'general-exam': 'Komplett Látásvizsgálat',
    'contact-lens': 'Kontaktlencse Illesztés',
    'glasses-fitting': 'Szemüvegkészítés Tanácsadás',
    'glasses-repair': 'Szemüveg Javítás'
  };

  function renderSummaryCard() {
    const summaryCard = document.getElementById('booking-summary-card');
    if (!summaryCard) return;

    const formattedDate = `${bookingState.date.getFullYear()}. ${hungarianMonths[bookingState.date.getMonth()]} ${bookingState.date.getDate()}.`;

    summaryCard.innerHTML = `
      <h4 class="summary-title">Foglalási Adatok</h4>
      <div class="summary-row">
        <span class="summary-label">Név:</span>
        <span class="summary-value">${bookingState.name}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Vizsgálat típusa:</span>
        <span class="summary-value">${serviceNames[bookingState.service]}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Időpont:</span>
        <span class="summary-value">${formattedDate} - ${bookingState.time}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">Telefonszám:</span>
        <span class="summary-value">${bookingState.phone}</span>
      </div>
    `;
  }

  function saveBookingToLocalStorage(state) {
    const dataToSave = {
      service: state.service,
      dateString: state.date.toISOString(),
      time: state.time,
      name: state.name,
      email: state.email,
      phone: state.phone,
      message: state.message
    };
    localStorage.setItem('lumina_booking', JSON.stringify(dataToSave));
  }
}

/* ==========================================================================
   8. CSS Scroll-Driven Animations Fallback
   ========================================================================== */
function initScrollAnimationsFallback() {
  // 1. Shrinking Header Fallback
  if (!CSS.supports('(animation-timeline: scroll()) and (animation-range: 0% 100%)')) {
    const header = document.getElementById('main-header');
    if (header) {
      const scrollDistance = 80;

      window.addEventListener('scroll', () => {
        const scrollY = window.scrollY;
        const scrollPercent = Math.min(1, scrollY / scrollDistance);

        if (scrollPercent > 0.1) {
          header.style.paddingBlock = '0.6rem';
          header.style.backgroundColor = 'rgba(251, 250, 248, 0.95)';
          header.style.borderBottom = '1px solid var(--color-border)';
          header.style.boxShadow = '0 4px 30px rgba(28, 35, 33, 0.03)';
        } else {
          header.style.paddingBlock = '1.25rem';
          header.style.backgroundColor = 'rgba(251, 250, 248, 0.8)';
          header.style.borderBottom = '1px solid transparent';
          header.style.boxShadow = 'none';
        }
      });
    }
  }

  // 2. Product Card Entrance Animáció Fallback (IntersectionObserver)
  //    A megvalósítás a termékkatalógusnál él (revealProductCards), mert a
  //    rács tartalma a /api/products megérkezésekor kicserélődik — a beúszást
  //    az új kártyákra is fel kell kötni.
  revealProductCards();
}

/* ==========================================================================
   9. Light Dismiss Dialog Fallback (Safari-ra és régebbi böngészőkre)
   ========================================================================== */
function initDialogDismissFallback() {
  const dialogs = document.querySelectorAll('#booking-dialog, #service-dialog, #product-dialog');
  if (!dialogs.length) return;

  // Ha a böngésző NEM támogatja a closedby attribútumot (Safari pl.)
  if ('closedBy' in HTMLDialogElement.prototype) return;

  dialogs.forEach(dialog => {
    dialog.addEventListener('click', (event) => {
      // Ha a kattintás magára a dialog-ra történt (és nem a gyerekekre)
      if (event.target !== dialog) return;

      const rect = dialog.getBoundingClientRect();
      const isClickInside = (
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width
      );

      // Ha a kattintás a tartalomdobozon kívül (a háttérre) esett, bezárjuk
      if (!isClickInside) {
        dialog.close();
      }
    });
  });
}

/* ==========================================================================
   10. Meglévő Foglalás Keresése (LocalStorage) & Toast Értesítés
   ========================================================================== */
function checkExistingBooking() {
  const savedData = localStorage.getItem('lumina_booking');
  if (!savedData) return;

  try {
    const booking = JSON.parse(savedData);

    // Időpont kiolvasása és ellenőrzése, hogy jövőbeli-e
    const bookingDate = new Date(booking.dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (bookingDate >= today) {
      // Jövőbeli érvényes időpont, toast megjelenítése
      const serviceNames = {
        'general-exam': 'Komplett Látásvizsgálat',
        'contact-lens': 'Kontaktlencse Illesztés',
        'glasses-fitting': 'Szemüvegkészítés Tanácsadás',
        'glasses-repair': 'Szemüveg Javítás'
      };

      const months = [
        'Jan.', 'Feb.', 'Már.', 'Ápr.', 'Máj.', 'Jún.',
        'Júl.', 'Aug.', 'Szept.', 'Okt.', 'Nov.', 'Dec.'
      ];

      const dateStr = `${bookingDate.getFullYear()}. ${months[bookingDate.getMonth()]} ${bookingDate.getDate()}.`;

      showToast(`Aktív foglalása van: <strong>${serviceNames[booking.service]}</strong> (${dateStr} - ${booking.time})`);
    }
  } catch (e) {
    console.error('Hiba a foglalás beolvasásakor', e);
  }
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast toast-success';
  toast.innerHTML = `
    <span>${message}</span>
    <button class="btn btn-outline btn-sm" id="toast-modify-btn" style="margin-left: 10px; border-color: rgba(255,255,255,0.4); color: #ffffff; padding: 4px 10px;">Módosítás</button>
    <button class="toast-close" style="background:none; border:none; color:#ffffff; font-size:1.2rem; cursor:pointer; margin-left: 10px;">&times;</button>
  `;

  // Bezárás
  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  });

  // Módosítás
  const modifyBtn = toast.querySelector('#toast-modify-btn');
  modifyBtn.addEventListener('click', () => {
    toast.remove();
    const dialog = document.getElementById('booking-dialog');
    if (dialog) dialog.showModal();
  });

  container.appendChild(toast);

  // 10 másodperc után automatikus eltüntetés
  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }
  }, 10000);
}
