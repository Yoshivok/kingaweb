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
    initProduct3DTilt();
    initVisionSimulator();
    initEyeAnatomy();
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
   3. Termékszűrő Logika
   ========================================================================== */
function initProductFilters() {
  const buttons = document.querySelectorAll('.filter-btn');
  const cards = document.querySelectorAll('.product-card');

  if (buttons.length === 0 || cards.length === 0) return;

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Aktív gomb csere
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filterValue = btn.getAttribute('data-filter');

      cards.forEach(card => {
        const category = card.getAttribute('data-category');

        // Animált ki/beúszás
        if (filterValue === 'all' || category === filterValue) {
          card.style.display = 'flex';
          setTimeout(() => {
            card.style.opacity = '1';
            card.style.transform = 'scale(1) translateY(0)';
          }, 50);
        } else {
          card.style.opacity = '0';
          card.style.transform = 'scale(0.95) translateY(10px)';
          setTimeout(() => {
            card.style.display = 'none';
          }, 300);
        }
      });
    });
  });
}

/* ==========================================================================
   4. Termékkártyák 3D Hover Tilt Effektusa
   ========================================================================== */
function initProduct3DTilt() {
  // Csak asztali nézetben fusson a teljesítmény megőrzése érdekében
  if (window.innerWidth < 768) return;

  const cards = document.querySelectorAll('.product-card');

  cards.forEach(card => {
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
   5/b. Interaktív 3D Szemanatómia
   --------------------------------------------------------------------------
   A modellt saját, könyvtár nélküli 3D motor rajzolja 2D vászonra. A szem
   képletei forgástestek, ezért mindegyik egy (r, z) profilból születik, amit
   a Z tengely (a látótengely) körül körbeforgatunk. A gömbből egy 90°-os
   éket kihagyunk — így a szem belseje is látszik —, a vágásfelületeket pedig
   lapos fedőlapok zárják le. A helyes takaráshoz elég a festő-algoritmus
   (mélység szerinti rajzolási sorrend) és a hátlapok eldobása: nem kell
   WebGL, és nem kell külső könyvtárat betölteni sem.

   A szemgolyó sugara a modellben 1 egység (a valóságban kb. 12 mm).
   ========================================================================== */

/*
 * A szem részeinek orvosi magyarázata. Ez a tömb adja a választógombok
 * sorrendjét is: elölről hátrafelé haladunk végig a szemgolyón.
 *
 * id        — ez köti össze a leírást a 3D modell felületeivel (buildEyeMeshes)
 * interior  — csak metszetben látszik, ezért kiválasztáskor kinyitjuk az éket
 * view      — ajánlott kameraállás, ha a látogató a gombbal választja ki
 */
const EYE_PARTS = [
  {
    id: 'cornea',
    name: 'Szaruhártya',
    latin: 'Cornea',
    badge: 'Elülső fénytörő ablak',
    swatch: '#cfe4ec',
    intro: 'A szemgolyó elülső felszínén ülő, teljesen átlátszó, érmentes „óraüveg”. Öt rétegből épül fel, és mivel egyetlen ér sem futhat benne (az rontaná az átlátszóságát), tápanyagait kívülről a könnyfilmből, belülről a csarnokvízből kapja.',
    functions: [
      'A szem legerősebb fénytörő eleme: a teljes törőerő mintegy kétharmadát, kb. 40–43 dioptriát adja.',
      'Mechanikai és fertőzés elleni védőpajzs a szem belseje számára.',
      'A test legsűrűbben beidegzett szövete — ezért fáj már egy hajszálnyi karcolás is.'
    ],
    disorders: 'Ha görbülete nem szabályosan gömbszerű, hanem tojásdad, szemtengelyferdülés (asztigmia) alakul ki. Sérülése vagy gyulladása (keratitis) heves fájdalommal, könnyezéssel és fényérzékenységgel jár, hegesedése pedig maradandó homályt hagyhat. Alakja és görbülete dönti el azt is, milyen kontaktlencse illeszthető a szemre.',
    exam: 'Réslámpás vizsgálat és szaruhártya-görbület mérése (keratometria)',
    interior: false,
    view: { yaw: -42, pitch: 16 }
  },
  {
    id: 'aqueous',
    name: 'Csarnokvíz',
    latin: 'Humor aquosus',
    badge: 'Elülső és hátsó csarnok',
    swatch: '#dbeef4',
    intro: 'A szaruhártya és a szemlencse közötti teret kitöltő, víztiszta folyadék. A sugártest termeli, a szem körkörös csarnokzugán át pedig folyamatosan elszívódik — ez az állandó ki-be áramlás tartja egyensúlyban a szem belsejét.',
    functions: [
      'Táplálja az érmentes szaruhártyát és szemlencsét, és elszállítja az anyagcseretermékeket.',
      'Fenntartja a szem belnyomását (normálértéke kb. 10–21 Hgmm), ami a szemgolyó feszes, gömbölyű alakjához kell.',
      'Fénytörő közegként a szaruhártya és a lencse közötti optikai utat is biztosítja.'
    ],
    disorders: 'Ha a folyadék elfolyása akadályozottá válik, a szem belnyomása megemelkedik: ez a zöldhályog (glaukóma). Alattomos betegség, mert évekig teljesen tünetmentesen sorvasztja a látóideget, és az elveszett látótér már nem hozható vissza. Ezért része minden alapos vizsgálatnak a szemnyomás mérése.',
    exam: 'Szemnyomásmérés (tonometria), csarnokmélység megítélése réslámpával',
    interior: true,
    view: { yaw: -46, pitch: 20 }
  },
  {
    id: 'iris',
    name: 'Szivárványhártya',
    latin: 'Iris',
    badge: 'A szem színes rekesze',
    swatch: '#b06c3a',
    intro: 'A szaruhártya mögött álló, izmokat tartalmazó színes lemez, amely a szem közepén nyílást hagy szabadon. Pigmenttartalma határozza meg a szem színét: kevés festék esetén kék, sok festék esetén barna a szem — a mintázata pedig, akárcsak az ujjlenyomat, mindenkinél egyedi.',
    functions: [
      'Két izma — a záró- és a tágítóizom — akaratlanul, a fényviszonyokhoz igazodva állítja a pupilla méretét.',
      'Fényképezőgép rekeszeként szabályozza a szemfenékre jutó fény mennyiségét.',
      'Elzárja a fény útját a pupillán kívül, így csak a lencse optikai középpontján át engedi be a képet.'
    ],
    disorders: 'Gyulladása (iritis, uveitis) mély szemfájdalommal, vörös szemmel és erős fényérzékenységgel jár, és sürgős kezelést igényel. Színének, mintázatának vagy a pupillareakciónak a kétoldali eltérése belgyógyászati és neurológiai kivizsgálást tehet szükségessé.',
    exam: 'Réslámpás vizsgálat, pupillareakció és csarnokzug ellenőrzése',
    interior: false,
    view: { yaw: -40, pitch: 16 }
  },
  {
    id: 'pupil',
    name: 'Pupilla',
    latin: 'Pupilla',
    badge: 'A fény bemenete',
    swatch: '#1d1512',
    intro: 'A pupilla nem önálló szerv, hanem a szivárványhártya közepén lévő nyílás. Azért látszik feketének, mert a rajta beeső fény a szem belsejében szinte teljesen elnyelődik, és alig verődik vissza belőle.',
    functions: [
      'Átmérője 2 és 8 mm között változik, így nagyjából tizenhatszoros különbséget képes áthidalni a beeső fénymennyiségben.',
      'Szűkülése közelre nézéskor megnöveli a mélységélességet, ezzel élesebbé teszi a közeli képet.',
      'Fényre adott válasza mindkét szemen egyszerre jelentkezik, ezért a vizsgálata fontos idegrendszeri információt ad.'
    ],
    disorders: 'A két oldal eltérő pupillamérete (anisocoria), a lassú vagy hiányzó fényreakció mindig kivizsgálandó. Sötétben, tág pupillánál a szem szélső területein átjutó fény is részt vesz a képalkotásban: ilyenkor a meglévő látáshibák és a szórt fény hatása felerősödik — pontosan ezt szemlélteti a fenti Látásszimulátor éjszakai beállítása is.',
    exam: 'Pupillareakció vizsgálata, pupillaátmérő mérése sötétben és világosban',
    interior: false,
    view: { yaw: -38, pitch: 14 }
  },
  {
    id: 'lens',
    name: 'Szemlencse',
    latin: 'Lens crystallina',
    badge: 'Az állítható fókusz',
    swatch: '#efe0bd',
    intro: 'Rugalmas, átlátszó, kétdomború lencse a szivárványhártya mögött, amelyet vékony függesztőrostok (zonulák) tartanak a helyén, mint egy trambulint a rugói. Egész életünkben növekszik, és közben fokozatosan veszít a rugalmasságából.',
    functions: [
      'Az alkalmazkodás (akkomodáció) szerve: alakváltoztatásával kb. 15–20 dioptriányi finomhangolást ad a szaruhártya rögzített törőerejéhez.',
      'Közelre nézéskor gömbölyűbbé válik, távolra nézéskor ellaposodik — így élesedik ki a kép különböző távolságokon.',
      'Elnyeli a szembe jutó ultraibolya sugárzás jelentős részét, védve ezzel az ideghártyát.'
    ],
    disorders: '40–45 éves kor körül rugalmassága annyira lecsökken, hogy a közeli élesre állítás nehézzé válik: ez az öregszeműség (presbyopia), amit olvasó- vagy multifokális szemüveggel korrigálunk. Ha maga a lencseállomány homályosodik el, szürkehályogról (cataracta) beszélünk — fokozatosan fakuló, ködös látást okoz, és ma már rutinműtéttel, műlencse beültetésével gyógyítható.',
    exam: 'Réslámpás vizsgálat tágított pupillával, szürkehályog-szűrés',
    interior: true,
    view: { yaw: -52, pitch: 24 }
  },
  {
    id: 'ciliary',
    name: 'Sugártest',
    latin: 'Corpus ciliare',
    badge: 'Motor és folyadékforrás',
    swatch: '#a85e37',
    intro: 'Gyűrű alakú, izmos és mirigyes képlet a szivárványhártya tövénél, körben a szemgolyó falán. Ehhez rögzülnek a szemlencse függesztőrostjai, és a felszínén futó nyúlványai termelik a csarnokvizet.',
    functions: [
      'Sugárizmának összehúzódása ellazítja a függesztőrostokat, ekkor a lencse gömbölyűbbé válik: így állítunk élesre közelre.',
      'Elernyedésekor a rostok megfeszülnek, a lencse ellaposodik — ez a távolra nézés nyugalmi állapota.',
      'Nyúlványai folyamatosan termelik a csarnokvizet, amely az egész elülső szemszakaszt táplálja.'
    ],
    disorders: 'Tartós közeli munka mellett görcsös állapotba kerülhet (akkomodációs görcs): ilyenkor a képernyő elől felnézve percekig homályos a távoli kép, és gyakori a homloktáji fejfájás. Gyulladása a szem belnyomásának ingadozásához vezethet.',
    exam: 'Akkomodáció- és konvergenciavizsgálat, közeli látásélesség mérése',
    interior: true,
    view: { yaw: -58, pitch: 26 }
  },
  {
    id: 'vitreous',
    name: 'Üvegtest',
    latin: 'Corpus vitreum',
    badge: 'A szem belső kitöltése',
    swatch: '#dfeaec',
    intro: 'A szemgolyó térfogatának mintegy négyötödét kitöltő, kocsonyás állomány a szemlencse és az ideghártya között. Csaknem teljes egészében víz, amelyet finom kollagénrost-háló és hialuronsav tart össze. Nem termelődik újra: ami egyszer elfolyósodott benne, az úgy is marad.',
    functions: [
      'Megtartja a szemgolyó gömbölyű alakját és a belső nyomást.',
      'Torzításmentesen továbbítja a fényt a lencsétől az ideghártyáig.',
      'Belülről kipárnázza és a helyén tartja az ideghártyát.'
    ],
    disorders: 'Az évek során részben elfolyósodik, a rostok pedig apró csomókba állnak össze: ezek vetnek árnyékot a retinára, így jelennek meg a látótérben „szálldosó legyek” (mouches volantes). Ez önmagában ártalmatlan. Ha viszont hirtelen sok új úszkáló folt, villanások vagy sötét „függöny” jelenik meg, az ideghártya leválásának gyanúja miatt azonnali szemészeti vizsgálat szükséges.',
    exam: 'Szemfenéki vizsgálat, az üvegtest átvilágítása réslámpával',
    interior: true,
    view: { yaw: -60, pitch: 28 }
  },
  {
    id: 'sclera',
    name: 'Ínhártya',
    latin: 'Sclera',
    badge: 'A szem külső váza',
    swatch: '#f2ece3',
    intro: 'A „szem fehérje”: erős, rostos külső burok, amely a szemgolyó felszínének mintegy öt hatodát borítja, elöl pedig átmenet nélkül folytatódik az átlátszó szaruhártyában. Kívülről vékony, nyálkahártyaszerű kötőhártya (conjunctiva) fedi.',
    functions: [
      'Megtartja a szemgolyó alakját és a belnyomását, mint egy teniszlabda burka.',
      'Védi a belső, sérülékeny szerkezeteket a mechanikai hatásoktól.',
      'A hat szemmozgató izom tapadási felülete — innen mozdul el a tekintet minden irányba.'
    ],
    disorders: 'Gyulladása (scleritis) mély, tompa, éjszaka is ébresztő fájdalommal jár, és gyakran társul reumatológiai betegséghez. A felszínét borító kötőhártya gyulladása (conjunctivitis) vörös szemet, égő érzést és váladékozást okoz. Egyenletes sárgás elszíneződése belgyógyászati eltérésre (pl. epeúti okra) hívhatja fel a figyelmet.',
    exam: 'Külső szemvizsgálat, a kötőhártya és az érrajzolat áttekintése réslámpával',
    interior: false,
    view: { yaw: -22, pitch: 10 }
  },
  {
    id: 'choroid',
    name: 'Érhártya',
    latin: 'Choroidea',
    badge: 'A középső, tápláló réteg',
    swatch: '#8c3d27',
    intro: 'Az ínhártya és az ideghártya között elhelyezkedő, sűrű érhálózattal és sötét festékanyaggal átszőtt középső réteg. A test egyik legerősebben átáramlott szövete: területéhez képest ide jut a legtöbb vér az egész szervezetben.',
    functions: [
      'Vérrel és tápanyaggal látja el az ideghártya külső, fényérzékelő rétegeit.',
      'Elvezeti a fényelnyelés során keletkező hőt, így hűti a szemfenéket.',
      'Sötét festékanyaga elnyeli a szórt fényt, ezzel jelentősen növeli a kép kontrasztját — enélkül minden fényes felület elmosódna.'
    ],
    disorders: 'Keringési zavara és az itt zajló lerakódás áll az időskori sárgafolt-degeneráció (AMD) hátterében. Gyulladása (chorioiditis) foltos látáskieséssel járhat, magas vérnyomás mellett pedig jellegzetes szemfenéki elváltozások alakulhatnak ki benne.',
    exam: 'Szemfenéki (fundus) vizsgálat, digitális szemfenékfotó',
    interior: true,
    view: { yaw: -66, pitch: 30 }
  },
  {
    id: 'retina',
    name: 'Ideghártya',
    latin: 'Retina',
    badge: 'A fényérzékelő réteg',
    swatch: '#d6845f',
    intro: 'A szem belső felszínét bélelő, tíz rétegből álló idegszövet — valójában az agy kihelyezett darabja. Mintegy 120 millió pálcikát és 6 millió csapot tartalmaz, amelyek a beeső fényt idegi jellé alakítják.',
    functions: [
      'A csapok a nappali, éles és színes látásért felelnek, és főként a sárgafoltban tömörülnek.',
      'A pálcikák a szürkületi látást, a mozgás és a látótér széli eseményeinek észlelését biztosítják.',
      'A feldolgozott jelet az idegrostok a látóidegen keresztül továbbítják az agy látókérgébe.'
    ],
    disorders: 'A cukorbetegség és a magas vérnyomás gyakran itt okozza az első kimutatható károsodást (diabeteses retinopathia), ezért a szemfenék vizsgálata az egész szervezetről árulkodik. Az ideghártya leválása fájdalmatlan, de sürgősségi állapot: villanások, hirtelen megszaporodó úszkáló foltok vagy a látótér szélén megjelenő sötét „függöny” jelezheti.',
    exam: 'Szemfenéki vizsgálat, digitális fundusfotó, szükség esetén rétegvizsgálat (OCT)',
    interior: true,
    view: { yaw: -62, pitch: 30 }
  },
  {
    id: 'macula',
    name: 'Sárgafolt',
    latin: 'Macula lutea & fovea centralis',
    badge: 'Az éleslátás helye',
    swatch: '#a8552e',
    intro: 'Az ideghártya hátsó pólusán elhelyezkedő, néhány milliméteres, sárgás árnyalatú terület, közepén a csapokkal zsúfolt apró gödröcskével (fovea centralis). Itt a legsűrűbb a fényérzékelő sejtek elhelyezkedése az egész szemben.',
    functions: [
      'Ez adja a látás éles, színes, részletgazdag középpontját: az olvasás, az arcfelismerés és a vezetés mind innen származik.',
      'Sárgás festékanyaga szűri a kék fényt, ezzel védi a legérzékenyebb sejteket.',
      'A látótér többi része ehhez képest jóval durvább felbontású — csak tájékozódásra és mozgásészlelésre elegendő.'
    ],
    disorders: 'Az időskori sárgafolt-degeneráció (AMD) esetén a kép közepe torzul, majd fokozatosan kiesik: az egyenes vonalak hullámosnak látszanak, az arcok közepe „elmosódik”, miközben a széli látás sokáig megmarad. Egyszerű Amsler-ráccsal otthon is szűrhető, ezért 50 év felett érdemes rendszeresen ellenőrizni.',
    exam: 'Amsler-teszt, célzott makulavizsgálat és szemfenékfotó',
    interior: true,
    view: { yaw: -64, pitch: 32 }
  },
  {
    id: 'optic',
    name: 'Látóidegfő és látóideg',
    latin: 'Discus nervi optici & nervus opticus',
    badge: 'A vakfolt és a kábel',
    swatch: '#f1e6d5',
    intro: 'Az a pont, ahol az ideghártya mintegy 1,2 millió idegrostja összeszedődik, és a szemgolyót elhagyva látóideggé áll össze. Itt nincsenek fényérzékelő sejtek, ezért ez a terület a fiziológiás vakfolt — amit azért nem érzékelünk, mert az agy a hiányzó részt kitölti.',
    functions: [
      'Az összes képi információt továbbítja a szemből az agy látókérgébe.',
      'Ugyanitt lép be a szembe és ki a szemből a szemfenék fő artériája és vénája.',
      'A látóidegfő állapota — színe, kimélyülése, széleinek élessége — a szemvizsgálat egyik legárulkodóbb lelete.'
    ],
    disorders: 'A zöldhályog (glaukóma) éppen itt sorvasztja el fokozatosan az idegrostokat, észrevétlenül szűkítve a látóteret; ezért mérünk szemnyomást és értékeljük rendszeresen a látóidegfőt. A látóideg gyulladása (neuritis) néhány nap alatt kialakuló látásvesztéssel és szemmozgatáskor jelentkező fájdalommal jár, duzzadt látóidegfő pedig koponyaűri nyomásfokozódásra utalhat.',
    exam: 'Látóidegfő értékelése szemfenéki vizsgálattal, látótérvizsgálat, szemnyomásmérés',
    interior: false,
    view: { yaw: 104, pitch: 12 }
  }
];

/* --------------------------------------------------------------------------
   A szemgolyó geometriája
   --------------------------------------------------------------------------
   Minden képlet egy (r, z) profil, amit a Z tengely körül forgatunk meg.
   A profilokat az óramutató járásával megegyezően járjuk körbe (r jobbra,
   z felfelé) — ez adja a kifelé néző normálisokat. Ha valamelyik profil
   mégis fordítva készült, a felület-terület előjele alapján magától
   megfordul, a fedőlapok pedig indextérkép szerint követik a fordítást.
   -------------------------------------------------------------------------- */
function buildEyeMeshes(seg) {
  const D = Math.PI / 180;
  const cut = { from: 0, to: Math.round(seg / 4) };   // a kihagyott 90°-os ék

  // Gömbív pontjai: (R·sinθ, zc + jel·R·cosθ)
  function arc(radius, fromDeg, toDeg, steps, zc, zSign) {
    const pts = [];
    const z0 = zc || 0;
    const sg = (zSign === undefined) ? 1 : zSign;
    for (let i = 0; i <= steps; i++) {
      const t = (fromDeg + (toDeg - fromDeg) * (i / steps)) * D;
      pts.push([radius * Math.sin(t), z0 + sg * radius * Math.cos(t)]);
    }
    return pts;
  }

  // Héj: külső felszín + visszafelé fordított belső felszín, majd zárás
  function shell(outer, inner) {
    const prof = outer.concat(inner.slice().reverse());
    prof.push([outer[0][0], outer[0][1]]);
    return prof;
  }

  const CORNEA_Z = 0.4426;   // a szaruhártya gömbjének középpontja a látótengelyen

  // --- Ínhártya (a fehér külső burok, elöl a limbusnál végződik) ---
  const scleraOut = arc(1.000, 29.2, 180, 16);
  const scleraIn = arc(0.960, 31.0, 180, 16);

  // --- Érhártya és ideghártya: egymásba ágyazott vékony héjak ---
  const choroidOut = arc(0.953, 31, 180, 9);
  const choroidIn = arc(0.930, 33, 180, 9);
  const retinaOut = arc(0.922, 39, 180, 9);
  const retinaIn = arc(0.888, 41, 180, 9);

  // --- Szaruhártya: erősebben görbülő, kidomborodó sapka ---
  const corneaOut = arc(0.650, 0, 48.5, 7, CORNEA_Z);
  const corneaIn = arc(0.605, 0, 53.6, 7, CORNEA_Z);

  // --- Szivárványhártya: enyhén kúpos gyűrű a pupilla körül ---
  const irisFront = [[0.170, 0.716], [0.288, 0.732], [0.440, 0.757]];
  const irisBack = [[0.170, 0.688], [0.288, 0.704], [0.440, 0.729]];

  // --- Pupilla: a szivárványhártya nyílásában látszó sötét korong ---
  const pupilProfile = [[0, 0.706], [0.178, 0.706], [0.178, 0.692], [0, 0.692]];

  // --- Szemlencse: elöl laposabb, hátul erősebben domború ---
  const lensFront = arc(0.70, 0, 32.4, 5, -0.046, 1);
  const lensBack = arc(0.45, 56.4, 0, 5, 0.794, -1);
  const lensProfile = lensFront.concat(lensBack.slice(1));

  // --- Sugártest: gyűrű a szemgolyó falán, a szivárványhártya töve mögött ---
  const ciliaryOut = arc(0.884, 28, 44, 3);
  const ciliaryIn = arc(0.812, 29, 43, 3);

  // --- Üvegtest: a lencse hátsó felszínétől a szemfenékig ---
  const vitreousProfile = arc(0.45, 0, 56.4, 3, 0.794, -1)
    .concat([[0.505, 0.600]])
    .concat(arc(0.872, 46, 180, 4));

  // --- Csarnokvíz: a szaruhártya belső felszíne és a lencse/írisz között ---
  const aqueousProfile = arc(0.605, 0, 53.6, 3, CORNEA_Z)
    .concat([[0.440, 0.757], [0.288, 0.732], [0.170, 0.716]])
    .concat(arc(0.70, 14.05, 0, 1, -0.046, 1));

  // --- Látóideg és látóidegfő: a hátsó pólustól 15°-kal oldalra lép ki ---
  const nerveProfile = [[0, 0.86], [0.155, 0.88], [0.275, 1.05], [0.245, 1.60], [0, 1.60]];
  const discProfile = arc(0.883, 0, 7.5, 2).concat([[0.1153, 0.898], [0, 0.898]]);

  // --- Sárgafolt és a közepén a gödröcske (fovea) ---
  const maculaProfile = arc(0.883, 0, 9, 2).concat([[0.1381, 0.896], [0, 0.896]]);
  const foveaProfile = arc(0.880, 0, 3.6, 1).concat([[0.0553, 0.893], [0, 0.893]]);

  /* Helyi koordinátarendszer egy tetszőleges irányhoz: a helyi +Z tengely
     az adott irányba mutat, a másik két tengelyt hozzá igazítjuk. */
  function frameFor(dx, dy, dz) {
    const l = Math.hypot(dx, dy, dz);
    const ez = [dx / l, dy / l, dz / l];
    // Segédtengely, ami biztosan nem párhuzamos ez-zel
    const up = (Math.abs(ez[1]) > 0.9) ? [1, 0, 0] : [0, 1, 0];
    let ex = [
      up[1] * ez[2] - up[2] * ez[1],
      up[2] * ez[0] - up[0] * ez[2],
      up[0] * ez[1] - up[1] * ez[0]
    ];
    const el = Math.hypot(ex[0], ex[1], ex[2]);
    ex = [ex[0] / el, ex[1] / el, ex[2] / el];
    const ey = [
      ez[1] * ex[2] - ez[2] * ex[1],
      ez[2] * ex[0] - ez[0] * ex[2],
      ez[0] * ex[1] - ez[1] * ex[0]
    ];
    return [ex, ey, ez];
  }

  // A látóideg kilépési iránya: 15°-kal a hátsó pólustól, az ék felől nézve túloldalt
  const nerveDir = [
    Math.sin(15 * D) * Math.cos(225 * D),
    Math.sin(15 * D) * Math.sin(225 * D),
    -Math.cos(15 * D)
  ];
  const nerveFrame = frameFor(nerveDir[0], nerveDir[1], nerveDir[2]);

  /* A sárgafolt pontosan a hátsó póluson ül, ezért a helyi rendszerét
     egyszerű Z-tükrözéssel adjuk meg: így a helyi szög és a modellbeli szög
     egymás ellentettje, és az ék kivágása pontosan átfordítható rá. */
  const maculaFrame = [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
  const maculaSeg = 12;
  const maculaCut = { from: Math.round(maculaSeg * 0.75), to: maculaSeg };

  return [
    {
      part: 'sclera', profile: shell(scleraOut, scleraIn), cap: { mode: 'strip', n: scleraOut.length },
      seg: seg, cut: cut, color: [247, 241, 233], alpha: 1, spec: 0.30, shin: 30, bias: 0.012, hidden: 'inner'
    },
    {
      part: 'choroid', profile: shell(choroidOut, choroidIn), cap: { mode: 'strip', n: choroidOut.length },
      seg: seg, cut: cut, color: [140, 61, 39], alpha: 1, spec: 0.14, shin: 16, bias: 0.005, hidden: 'all'
    },
    {
      part: 'retina', profile: shell(retinaOut, retinaIn), cap: { mode: 'strip', n: retinaOut.length },
      seg: seg, cut: cut, color: [214, 132, 95], alpha: 1, spec: 0.16, shin: 18, hidden: 'outer'
    },
    {
      part: 'ciliary', profile: shell(ciliaryOut, ciliaryIn), cap: { mode: 'strip', n: ciliaryOut.length },
      seg: seg, cut: cut, color: [168, 94, 55], alpha: 1, spec: 0.20, shin: 20
    },
    {
      part: 'vitreous', profile: vitreousProfile, cap: { mode: 'fan', center: [0, -0.10] },
      seg: seg, cut: cut, color: [221, 233, 236], alpha: 0.17, spec: 0.10, shin: 22
    },
    {
      part: 'iris', profile: shell(irisFront, irisBack), cap: { mode: 'strip', n: irisFront.length },
      seg: seg, cut: cut, color: [134, 72, 33], alpha: 1, spec: 0.26, shin: 22
    },
    {
      part: 'pupil', profile: pupilProfile, cap: { mode: 'fan', center: [0.089, 0.699] },
      seg: seg, cut: cut, color: [22, 15, 13], alpha: 1, spec: 0.06, shin: 40
    },
    {
      part: 'lens', profile: lensProfile, cap: { mode: 'fan', center: [0, 0.52] },
      seg: seg, cut: cut, color: [236, 216, 176], alpha: 0.60, spec: 0.42, shin: 40
    },
    {
      part: 'aqueous', profile: aqueousProfile, cap: { mode: 'fan', center: [0.10, 0.86] },
      seg: seg, cut: cut, color: [216, 236, 243], alpha: 0.12, spec: 0.16, shin: 26
    },
    {
      part: 'cornea', profile: shell(corneaOut, corneaIn), cap: { mode: 'strip', n: corneaOut.length },
      seg: seg, cut: cut, color: [203, 226, 236], alpha: 0.22, spec: 0.90, shin: 60
    },
    {
      part: 'optic', profile: nerveProfile, cap: null, frame: nerveFrame,
      seg: 16, cut: null, color: [238, 224, 205], alpha: 1, spec: 0.20, shin: 20
    },
    {
      part: 'optic', profile: discProfile, cap: null, frame: nerveFrame,
      seg: 16, cut: null, color: [246, 234, 214], alpha: 1, spec: 0.16, shin: 18
    },
    {
      part: 'macula', profile: maculaProfile, cap: null, frame: maculaFrame,
      seg: maculaSeg, cut: maculaCut, color: [173, 90, 47], alpha: 1, spec: 0.14, shin: 16
    },
    {
      part: 'macula', profile: foveaProfile, cap: null, frame: maculaFrame,
      seg: maculaSeg, cut: maculaCut, color: [138, 64, 33], alpha: 1, spec: 0.12, shin: 16
    }
  ];
}

/* Egy forgástest felépítése a leírásából: csúcsok, lapok, vágásfedelek. */
function buildEyeMesh(spec, partIndexOf) {
  const prof = spec.profile.slice();

  // Körüljárási irány ellenőrzése — a kifelé néző normálisokhoz óramutató
  // szerinti sorrend kell. Fordítás esetén az indextérkép követi a cserét.
  let area = 0;
  for (let i = 0; i < prof.length; i++) {
    const a = prof[i], b = prof[(i + 1) % prof.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const rows = prof.length;
  const flipped = area > 0;
  if (flipped) prof.reverse();
  const map = (i) => (flipped ? rows - 1 - i : i);

  const seg = spec.seg;
  const ringCount = seg + 1;
  const fanExtra = (spec.cap && spec.cap.mode === 'fan') ? 2 : 0;
  const vertCount = ringCount * rows + fanExtra;
  const verts = new Float64Array(vertCount * 3);

  const fr = spec.frame;
  function place(vi, x, y, z) {
    if (fr) {
      verts[vi] = fr[0][0] * x + fr[1][0] * y + fr[2][0] * z;
      verts[vi + 1] = fr[0][1] * x + fr[1][1] * y + fr[2][1] * z;
      verts[vi + 2] = fr[0][2] * x + fr[1][2] * y + fr[2][2] * z;
    } else {
      verts[vi] = x; verts[vi + 1] = y; verts[vi + 2] = z;
    }
  }

  for (let s = 0; s < ringCount; s++) {
    const ang = (s / seg) * Math.PI * 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let p = 0; p < rows; p++) {
      const r = prof[p][0], z = prof[p][1];
      place((s * rows + p) * 3, r * ca, r * sa, z);
    }
  }

  /* A profil érintőjéből számolt valódi felületi normálisok. Ezekkel a
     megvilágítás akkor is folytonos marad, ha a felület csak néhány lapból
     áll — így nem esik szét látható sokszögekre a gömbfelület. A körüljárás
     óramutató szerinti, ezért a kifelé mutató normális (-dz, dr). */
  const closed = Math.abs(prof[0][0] - prof[rows - 1][0]) < 1e-9
    && Math.abs(prof[0][1] - prof[rows - 1][1]) < 1e-9;
  const pn = [];
  for (let p = 0; p < rows; p++) {
    let a = p - 1, b = p + 1;
    if (a < 0) a = closed ? rows - 2 : 0;
    if (b > rows - 1) b = closed ? 1 : rows - 1;
    const tr = prof[b][0] - prof[a][0];
    const tz = prof[b][1] - prof[a][1];
    const l = Math.hypot(tr, tz) || 1;
    pn.push([-tz / l, tr / l]);
  }

  /* Rejtett felületek elhagyása. Egy héj profilja külső ív + visszafelé
     fordított belső ív, így a sávok első fele a külső, második fele a belső
     felszín. A fal rétegeinél az egyik oldal sosem látszik (az ínhártya belső
     felszínét eltakarja az ideghártya, az ideghártya külső felszínét pedig az
     ínhártya), az érhártyából pedig csak a metszlapon lévő csík látszik.
     Ezeket meg sem rajzoljuk: ez a lapok harmadát megspórolja. */
  const hideStrip = new Array(rows - 1).fill(false);
  if (spec.hidden && spec.cap && spec.cap.mode === 'strip') {
    const n = spec.cap.n;
    const mark = (from, to) => {
      for (let i = from; i <= to && i < rows - 1; i++) hideStrip[i] = true;
    };
    if (spec.hidden === 'inner') mark(n, 2 * n - 2);
    else if (spec.hidden === 'outer') mark(0, n - 2);
    else if (spec.hidden === 'all') mark(0, rows - 2);
  }
  if (flipped) hideStrip.reverse();

  const quads = [];
  const segOf = [];
  const norms = [];
  for (let s = 0; s < seg; s++) {
    const mid = ((s + 0.5) / seg) * Math.PI * 2;
    const cm = Math.cos(mid), sm = Math.sin(mid);
    for (let p = 0; p < rows - 1; p++) {
      if (hideStrip[p]) continue;
      const i0 = s * rows + p;
      quads.push(i0, i0 + 1, (s + 1) * rows + p + 1, (s + 1) * rows + p);
      segOf.push(s);
      // A lap közepére eső felületi normális a két profilnormális átlaga
      let nr = (pn[p][0] + pn[p + 1][0]) * 0.5;
      let nz = (pn[p][1] + pn[p + 1][1]) * 0.5;
      const nl = Math.hypot(nr, nz) || 1;
      nr /= nl; nz /= nl;
      let nx = nr * cm, ny = nr * sm, nzz = nz;
      if (fr) {
        const x = nx, y = ny, z = nzz;
        nx = fr[0][0] * x + fr[1][0] * y + fr[2][0] * z;
        ny = fr[0][1] * x + fr[1][1] * y + fr[2][1] * z;
        nzz = fr[0][2] * x + fr[1][2] * y + fr[2][2] * z;
      }
      norms.push(nx, ny, nzz);
    }
  }

  /* Vágásfedelek. A megmaradó anyag a [cut.to, cut.from + 360°] tartományban
     van, ezért a cut.from oldalán kifelé a növekvő szög felé, a cut.to
     oldalán a csökkenő szög felé néz a fedőlap. A tényleges körüljárást
     lapon ként ellenőrizzük, és ha kell, megfordítjuk. */
  if (spec.cap && spec.cut) {
    const cap = spec.cap;
    let fanVert = ringCount * rows;

    [[spec.cut.from, 1], [spec.cut.to, -1]].forEach(([ring, sign]) => {
      const ang = (ring / seg) * Math.PI * 2;
      let wx = -Math.sin(ang) * sign, wy = Math.cos(ang) * sign, wz = 0;
      if (fr) {
        const x = wx, y = wy, z = wz;
        wx = fr[0][0] * x + fr[1][0] * y + fr[2][0] * z;
        wy = fr[0][1] * x + fr[1][1] * y + fr[2][1] * z;
        wz = fr[0][2] * x + fr[1][2] * y + fr[2][2] * z;
      }
      const base = (ring % ringCount) * rows;

      const faces = [];
      if (cap.mode === 'strip') {
        const n = cap.n;
        for (let i = 0; i < n - 1; i++) {
          faces.push([
            base + map(i), base + map(i + 1),
            base + map(2 * n - 2 - i), base + map(2 * n - 1 - i)
          ]);
        }
      } else {
        const cvi = fanVert++;
        const ca2 = Math.cos(ang), sa2 = Math.sin(ang);
        place(cvi * 3, cap.center[0] * ca2, cap.center[0] * sa2, cap.center[1]);
        for (let i = 0; i < rows - 1; i++) {
          faces.push([cvi, base + i, base + i + 1, base + i + 1]);
        }
      }

      faces.forEach((f) => {
        // Körüljárás igazítása a kívánt normálishoz
        const a = f[0] * 3, b = f[1] * 3, c = f[2] * 3, d = f[3] * 3;
        const p1x = verts[c] - verts[a], p1y = verts[c + 1] - verts[a + 1], p1z = verts[c + 2] - verts[a + 2];
        const p2x = verts[d] - verts[b], p2y = verts[d + 1] - verts[b + 1], p2z = verts[d + 2] - verts[b + 2];
        const nx = p1y * p2z - p1z * p2y;
        const ny = p1z * p2x - p1x * p2z;
        const nz = p1x * p2y - p1y * p2x;
        if (nx * wx + ny * wy + nz * wz < 0) {
          quads.push(f[3], f[2], f[1], f[0]);
        } else {
          quads.push(f[0], f[1], f[2], f[3]);
        }
        segOf.push(-1);   // -1 = fedőlap: csak metszet módban rajzoljuk
        norms.push(wx, wy, wz);   // a fedőlap sík, a normálisa a vágás iránya
      });
    });
  }

  return {
    partIndex: partIndexOf(spec.part),
    verts: verts,
    view: new Float64Array(vertCount * 3),
    screen: new Float64Array(vertCount * 2),
    faces: new Int32Array(quads),
    faceSeg: new Int32Array(segOf),
    faceNorm: new Float64Array(norms),
    cutFrom: spec.cut ? spec.cut.from : -1,
    cutTo: spec.cut ? spec.cut.to : -1,
    color: spec.color,
    alpha: spec.alpha,
    spec: spec.spec,
    shin: spec.shin,
    bias: spec.bias || 0,
    // Fix méretű tömb: a ritkán kitöltött, növekvő tömböt a motor szótárrá
    // alakítaná, és lassulna a keresés. 4 állapot × 64 árnyalat × 16 csillanás.
    cache: new Array(4096)
  };
}

function initEyeAnatomy() {
  const canvas = document.getElementById('eye-canvas');
  const viewport = document.getElementById('eye-viewport');
  const pillsBox = document.getElementById('eye-pills');
  const badgeEl = document.getElementById('eye-badge');
  const titleEl = document.getElementById('eye-title');
  const latinEl = document.getElementById('eye-latin');
  const bodyEl = document.getElementById('eye-body');
  const markerEl = document.getElementById('eye-marker');
  const tipEl = document.getElementById('eye-tooltip');
  const cutBtn = document.getElementById('eye-cut-btn');
  const spinBtn = document.getElementById('eye-spin-btn');
  const resetBtn = document.getElementById('eye-reset-btn');
  if (!canvas || !viewport || !pillsBox || !bodyEl) return;

  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) {
    viewport.classList.add('is-unsupported');
    return;
  }

  const PART_INDEX = {};
  EYE_PARTS.forEach((p, i) => { PART_INDEX[p.id] = i; });
  const partIndexOf = (id) => (id in PART_INDEX ? PART_INDEX[id] : 0);

  /* ---- Modell felépítése ------------------------------------------------ */
  // Kisebb kijelzőn ritkább a felosztás: kevesebb lapot kell kitölteni.
  const SEG = window.matchMedia('(max-width: 700px)').matches ? 28 : 44;
  const meshes = buildEyeMeshes(SEG).map((spec) => buildEyeMesh(spec, partIndexOf));

  let totalFaces = 0;
  meshes.forEach((m) => { totalFaces += m.faceSeg.length; });

  const fMesh = new Int32Array(totalFaces);
  const fQuad = new Int32Array(totalFaces);
  const fDepth = new Float64Array(totalFaces);
  const fShade = new Float32Array(totalFaces);
  const fSpec = new Float32Array(totalFaces);
  const fOrder = new Uint32Array(totalFaces);
  let faceCount = 0;

  /* ---- Nézet állapota --------------------------------------------------- */
  const DEFAULT_VIEW = { yaw: -32, pitch: 16 };
  const DEG = Math.PI / 180;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let yaw = DEFAULT_VIEW.yaw * DEG;
  let pitch = DEFAULT_VIEW.pitch * DEG;
  let targetYaw = yaw, targetPitch = pitch;
  let tweening = false;
  let spinPhase = 0;
  let spinOn = !reduceMotion;
  let cutOn = true;
  let selected = null;
  let hovered = null;

  let cssW = 0, cssH = 0, dpr = 1;
  let maxDpr = 1.5;             // a modell sima árnyalású, ennél többre nincs szükség
  let dirty = true;
  let running = false;
  let rafId = 0;
  let inView = false;
  let lastTime = 0;
  let interacting = false;   // igaz, amíg a látogató húzza a modellt

  // Fényirány a nézeti térben rögzítve: forgatás közben sem „vándorol” a fény
  const LX = -0.40, LY = 0.52, LZ = 0.75;
  const HL = Math.hypot(LX, LY, LZ + 1);
  const HX = LX / HL, HY = LY / HL, HZ = (LZ + 1) / HL;   // felező vektor a csillanáshoz
  const ACCENT = [214, 123, 75];
  const MUTED = [156, 148, 141];   // a tompított képletek felé kevert semleges szín

  function shadeColor(mesh, shadeBucket, specBucket, hot) {
    const key = hot * 1024 + shadeBucket * 16 + specBucket;
    const cached = mesh.cache[key];
    if (cached) return cached;

    // 0 = alap, 1 = egér alatt, 2 = kiválasztva, 3 = tompítva (más van kiválasztva)
    const base = mesh.color;
    const toward = hot === 3 ? MUTED : ACCENT;
    const mix = hot === 2 ? 0.44 : (hot === 1 ? 0.22 : (hot === 3 ? 0.42 : 0));
    const lift = hot === 2 ? 1.22 : (hot === 1 ? 1.10 : (hot === 3 ? 0.80 : 1));
    const shade = (shadeBucket + 0.5) / 64 * 1.6 * lift;
    const sp = (specBucket + 0.5) / 16 * mesh.spec * (hot === 3 ? 0.5 : 1);

    const out = [];
    for (let i = 0; i < 3; i++) {
      const c = base[i] * (1 - mix) + toward[i] * mix;
      out[i] = Math.max(0, Math.min(255, Math.round(c * shade + 255 * sp)));
    }
    const str = 'rgb(' + out[0] + ',' + out[1] + ',' + out[2] + ')';
    mesh.cache[key] = str;
    return str;
  }

  /* ---- Méretezés -------------------------------------------------------- */
  function resize(force) {
    const rect = viewport.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const nextDpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = Math.round(rect.width), h = Math.round(rect.height);
    if (!force && w === cssW && h === cssH && nextDpr === dpr) return;
    cssW = w; cssH = h; dpr = nextDpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    dirty = true;
  }

  /* ---- Rajzolás --------------------------------------------------------- */
  const CAM = 5.6;

  function render() {
    if (!cssW || !cssH) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const ox = cssW / 2;
    const oy = cssH / 2;
    const scale = Math.min(cssW, cssH) * 0.345;

    const useYaw = yaw + (spinOn ? Math.sin(spinPhase) * 0.26 : 0);
    const cy = Math.cos(useYaw), sy = Math.sin(useYaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);

    /* A fény a nézeti térben áll, a felületi normálisokat viszont modelltérben
       tároljuk. Olcsóbb a fényt visszaforgatni modelltérbe egyszer, mint
       laponként előreforgatni a normálisokat. */
    const lz1 = -sp * LY + cp * LZ;
    const lmx = cy * LX - sy * lz1;
    const lmy = cp * LY + sp * LZ;
    const lmz = sy * LX + cy * lz1;
    const hz1 = -sp * HY + cp * HZ;
    const hmx = cy * HX - sy * hz1;
    const hmy = cp * HY + sp * HZ;
    const hmz = sy * HX + cy * hz1;

    faceCount = 0;
    let markX = 0, markY = 0, markN = 0;

    for (let mi = 0; mi < meshes.length; mi++) {
      const mesh = meshes[mi];
      const v = mesh.verts, tv = mesh.view, sc = mesh.screen;

      for (let i = 0, j = 0, n = v.length; i < n; i += 3, j += 2) {
        const x = v[i], y = v[i + 1], z = v[i + 2];
        const x1 = x * cy + z * sy;
        const z1 = z * cy - x * sy;
        const y2 = y * cp - z1 * sp;
        const z2 = y * sp + z1 * cp;
        tv[i] = x1; tv[i + 1] = y2; tv[i + 2] = z2;
        const pp = CAM / (CAM - z2) * scale;
        sc[j] = ox + x1 * pp;
        sc[j + 1] = oy - y2 * pp;
      }

      const f = mesh.faces, fs = mesh.faceSeg;
      const cFrom = mesh.cutFrom, cTo = mesh.cutTo;
      const isSel = selected !== null && mesh.partIndex === selected;

      for (let q = 0, nq = fs.length; q < nq; q++) {
        const s = fs[q];
        if (s < 0) {
          if (!cutOn) continue;                       // fedőlap csak metszetben
        } else if (cutOn && cFrom >= 0 && s >= cFrom && s < cTo) {
          continue;                                   // a kihagyott ék lapjai
        }

        const k = q * 4;
        const a = f[k] * 3, b = f[k + 1] * 3, c = f[k + 2] * 3, d = f[k + 3] * 3;
        const p1x = tv[c] - tv[a], p1y = tv[c + 1] - tv[a + 1], p1z = tv[c + 2] - tv[a + 2];
        const p2x = tv[d] - tv[b], p2y = tv[d + 1] - tv[b + 1], p2z = tv[d + 2] - tv[b + 2];
        let nx = p1y * p2z - p1z * p2y;
        let ny = p1z * p2x - p1x * p2z;
        let nz = p1x * p2y - p1y * p2x;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nl < 1e-9) continue;
        nx /= nl; ny /= nl; nz /= nl;

        const ccx = (tv[a] + tv[b] + tv[c] + tv[d]) * 0.25;
        const ccy = (tv[a + 1] + tv[b + 1] + tv[c + 1] + tv[d + 1]) * 0.25;
        const ccz = (tv[a + 2] + tv[b + 2] + tv[c + 2] + tv[d + 2]) * 0.25;

        // Hátlapok eldobása a lap tényleges (sík) normálisa alapján
        if (nx * -ccx + ny * -ccy + nz * (CAM - ccz) <= 0) continue;

        // Megvilágításhoz viszont a sima felületi normálist használjuk
        const fn = mesh.faceNorm;
        const sx = fn[q * 3], sy2 = fn[q * 3 + 1], sz = fn[q * 3 + 2];
        const lam = sx * lmx + sy2 * lmy + sz * lmz;
        const diff = lam > 0 ? lam : 0;
        const hdot = sx * hmx + sy2 * hmy + sz * hmz;
        const glint = hdot > 0 ? Math.pow(hdot, mesh.shin) : 0;

        fMesh[faceCount] = mi;
        fQuad[faceCount] = q;
        fDepth[faceCount] = ccz + mesh.bias;
        fShade[faceCount] = 0.54 + 0.60 * diff;
        fSpec[faceCount] = glint;
        fOrder[faceCount] = faceCount;
        faceCount++;

        if (isSel) {
          markX += (sc[f[k] * 2] + sc[f[k + 2] * 2]) * 0.5;
          markY += (sc[f[k] * 2 + 1] + sc[f[k + 2] * 2 + 1]) * 0.5;
          markN++;
        }
      }
    }

    const order = fOrder.subarray(0, faceCount);
    order.sort((a, b) => fDepth[a] - fDepth[b]);

    let curAlpha = -1;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.9;

    for (let i = 0; i < faceCount; i++) {
      const fi = order[i];
      const mesh = meshes[fMesh[fi]];
      const sc = mesh.screen;
      const k = fQuad[fi] * 4;
      const a = mesh.faces[k], b = mesh.faces[k + 1], c = mesh.faces[k + 2], d = mesh.faces[k + 3];

      if (mesh.alpha !== curAlpha) {
        curAlpha = mesh.alpha;
        ctx.globalAlpha = curAlpha;
      }

      const hot = (selected !== null && mesh.partIndex === selected) ? 2
        : ((hovered !== null && mesh.partIndex === hovered) ? 1
          : (selected !== null ? 3 : 0));
      let sb = (fShade[fi] / 1.6 * 64) | 0;
      if (sb < 0) sb = 0; else if (sb > 63) sb = 63;
      let pb = (fSpec[fi] * 16) | 0;
      if (pb < 0) pb = 0; else if (pb > 15) pb = 15;
      const col = shadeColor(mesh, sb, pb, hot);

      let ax = sc[a * 2], ay = sc[a * 2 + 1];
      let bx = sc[b * 2], by = sc[b * 2 + 1];
      let cx2 = sc[c * 2], cy2 = sc[c * 2 + 1];
      let dx2 = sc[d * 2], dy2 = sc[d * 2 + 1];

      /* A szomszédos lapok közé az élsimítás hajszálvékony rést hagy. Régebben
         egy azonos színű körvonal takarta el, de az megduplázta a rajzolási
         hívások számát. Helyette a lapot a saját súlypontjából kifelé tágítjuk
         egy képpont töredékével — ez néhány szorzás, nem újabb raszterezés. */
      if (curAlpha > 0.95) {
        const mx = (ax + bx + cx2 + dx2) * 0.25;
        const my = (ay + by + cy2 + dy2) * 0.25;
        const spread = (Math.abs(ax - mx) + Math.abs(ay - my)
          + Math.abs(cx2 - mx) + Math.abs(cy2 - my)) * 0.5;
        const g = 1 + 1.05 / (spread + 1.3);
        ax = mx + (ax - mx) * g; ay = my + (ay - my) * g;
        bx = mx + (bx - mx) * g; by = my + (by - my) * g;
        cx2 = mx + (cx2 - mx) * g; cy2 = my + (cy2 - my) * g;
        dx2 = mx + (dx2 - mx) * g; dy2 = my + (dy2 - my) * g;
      }

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx2, cy2);
      if (d !== c) ctx.lineTo(dx2, dy2);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    updateMarker(markN ? markX / markN : null, markN ? markY / markN : null);
  }

  function updateMarker(x, y) {
    if (!markerEl) return;
    if (selected === null || x === null) {
      markerEl.hidden = true;
      return;
    }
    markerEl.hidden = false;
    markerEl.style.left = (x / cssW * 100) + '%';
    markerEl.style.top = (y / cssH * 100) + '%';
    markerEl.classList.toggle('is-right', x > cssW * 0.55);
  }

  /* ---- Animációs hurok ---------------------------------------------------
     Három dolog tartja alacsonyan a terhelést:
     1. képkockakorlát — a modell 30 kép/mp-mel is folyamatosnak látszik,
        viszont fele annyi munkát ad a szálnak, mint a 60;
     2. görgetés alatti szünet — görgetés közben a rajzolás versenyezne a
        gördítéssel, és ettől akadt meg az egész oldal;
     3. önszabályozás — ha egy gyengébb gépen mégis hosszúak a képkockák,
        magától visszavesz a felbontásból, majd leállítja a forgatást.
     -------------------------------------------------------------------- */
  const FRAME_MS = 33;          // ~30 kép/mp
  const SCROLL_PAUSE_MS = 180;
  let scrollQuietAt = 0;
  let lastDraw = 0;
  let slowAvg = 0;
  let slowSamples = 0;
  let quality = 2;              // 2 = teljes, 1 = kisebb felbontás, 0 = forgatás nélkül

  function shouldRun() {
    return inView && isPageLive();
  }

  function frame(now) {
    if (!shouldRun()) { running = false; rafId = 0; return; }
    const dt = lastTime ? Math.min(64, now - lastTime) : 16;
    lastTime = now;

    let active = false;
    if (spinOn) { spinPhase += dt * 0.00042; active = true; }
    if (tweening) {
      const ease = 1 - Math.pow(0.001, dt / 620);
      yaw += (targetYaw - yaw) * ease;
      pitch += (targetPitch - pitch) * ease;
      if (Math.abs(targetYaw - yaw) < 0.002 && Math.abs(targetPitch - pitch) < 0.002) {
        yaw = targetYaw; pitch = targetPitch; tweening = false;
      }
      active = true;
    }

    if (!active && !dirty) { running = false; rafId = 0; return; }

    // Görgetés közben, illetve a képkockakorlát alatt csak várunk. Húzás
    // közben viszont nincs korlát: ott a késleltetés azonnal érezhető lenne.
    if (now < scrollQuietAt || (!interacting && now - lastDraw < FRAME_MS)) {
      rafId = requestAnimationFrame(frame);
      return;
    }

    dirty = false;
    lastDraw = now;
    const t0 = performance.now();
    render();
    const cost = performance.now() - t0;

    // Gördülő átlag: egy-egy kiugró képkocka még nem ok a visszavételre
    slowAvg = slowAvg ? slowAvg * 0.9 + cost * 0.1 : cost;
    if (++slowSamples > 24 && slowAvg > 22 && quality > 0) {
      quality--;
      slowSamples = 0;
      slowAvg = 0;
      if (quality === 1) { maxDpr = 1; resize(true); }
      else setSpin(false);
    }

    rafId = requestAnimationFrame(frame);
  }

  // Görgetés alatt nem rajzolunk: így nem akad meg az oldal gördítése
  window.addEventListener('scroll', () => {
    scrollQuietAt = (window.performance ? performance.now() : Date.now()) + SCROLL_PAUSE_MS;
  }, { passive: true });

  function requestRender() {
    dirty = true;
    if (running || !shouldRun()) return;
    running = true;
    lastTime = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0; running = false;
  }

  /* ---- Találatvizsgálat (melyik képletre mutat az egér) ------------------ */
  function faceHit(fi, px, py) {
    const mesh = meshes[fMesh[fi]];
    const sc = mesh.screen;
    const k = fQuad[fi] * 4;
    const idx = [mesh.faces[k], mesh.faces[k + 1], mesh.faces[k + 2], mesh.faces[k + 3]];
    const n = (idx[3] === idx[2]) ? 3 : 4;
    let sign = 0;
    for (let i = 0; i < n; i++) {
      const a = idx[i] * 2, b = idx[(i + 1) % n] * 2;
      const cross = (sc[b] - sc[a]) * (py - sc[a + 1]) - (sc[b + 1] - sc[a + 1]) * (px - sc[a]);
      if (cross === 0) continue;
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (sign !== s) return false;
    }
    return true;
  }

  // A nagy, átlátszó kitöltő terek (csarnokvíz, üvegtest) csak akkor
  // nyernek, ha semmi más nem esik a mutató alá; a szaruhártya pedig
  // átengedi a mögötte lévő szivárványhártyát és pupillát.
  const PICK_RANK = {
    aqueous: 1, vitreous: 1, cornea: 3,
    sclera: 3, choroid: 3, retina: 3, ciliary: 3,
    iris: 4, pupil: 4, lens: 4, macula: 5, optic: 5
  };

  function pick(px, py) {
    let best = -1, bestRank = -1;
    for (let i = faceCount - 1; i >= 0; i--) {
      const fi = fOrder[i];
      const mesh = meshes[fMesh[fi]];
      if (!faceHit(fi, px, py)) continue;
      // A metszlapon az adott képlet keresztmetszete látszik, ezért ott ő a
      // találat — különben a csarnokvíz sosem lenne kattintható, hiszen mindig
      // van mögötte szilárd felület. Az üvegtest kimarad ebből: a metszete a
      // teljes belső teret lefedné, és elvenné a jól látható ideghártyát.
      const id = EYE_PARTS[mesh.partIndex].id;
      const onCut = mesh.faceSeg[fQuad[fi]] < 0 && id !== 'vitreous';
      const rank = (PICK_RANK[id] || 2) + (onCut ? 3 : 0);
      if (rank > bestRank) { bestRank = rank; best = mesh.partIndex; }
      if (mesh.alpha > 0.95) break;   // átlátszatlan lap mögé nem látunk
    }
    return best >= 0 ? best : null;
  }

  /* ---- Kártya és gombsor ------------------------------------------------ */
  const ICONS = {
    what: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v5" stroke-linecap="round"/><circle cx="10" cy="6.2" r=".9" fill="currentColor" stroke="none"/></svg>',
    role: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.4"/></svg>',
    risk: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.6 18.4 17H1.6L10 2.6z"/><path d="M10 8v3.4"/><circle cx="10" cy="14" r=".9" fill="currentColor" stroke="none"/></svg>',
    exam: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="9" r="6"/><path d="m13.5 13.5 4 4"/></svg>'
  };

  function renderCard(part) {
    if (!part) {
      badgeEl.textContent = 'Interaktív modell';
      titleEl.textContent = 'Válasszon egy szemrészletet';
      latinEl.textContent = 'Anatomia oculi humani';
      bodyEl.innerHTML =
        '<div class="eye-placeholder">' +
        '<span class="eye-placeholder__icon">' + ICONS.role + '</span>' +
        '<p class="eye-placeholder__text">Forgassa meg a modellt, majd kattintson a szem valamelyik képletére — vagy válasszon a fenti gombok közül. Minden részhez rövid orvosi magyarázat tartozik.</p>' +
        '</div>';
      bodyEl.classList.remove('is-animating');
      return;
    }

    badgeEl.textContent = part.badge;
    titleEl.textContent = part.name;
    latinEl.textContent = part.latin;
    bodyEl.innerHTML =
      '<div class="eye-info-group">' +
      '<p class="eye-info-label">' + ICONS.what + ' Mi ez?</p>' +
      '<p class="eye-info-text">' + part.intro + '</p>' +
      '</div>' +
      '<div class="eye-info-group">' +
      '<p class="eye-info-label">' + ICONS.role + ' Mi a feladata?</p>' +
      '<ul class="eye-info-list">' + part.functions.map((t) => '<li>' + t + '</li>').join('') + '</ul>' +
      '</div>' +
      '<div class="eye-info-group">' +
      '<p class="eye-info-label">' + ICONS.risk + ' Ha nem működik jól</p>' +
      '<p class="eye-info-text">' + part.disorders + '</p>' +
      '</div>' +
      '<div class="eye-info-group">' +
      '<p class="eye-info-label">' + ICONS.exam + ' Így vizsgáljuk</p>' +
      '<span class="eye-exam-chip">' + part.exam + '</span>' +
      '</div>';

    bodyEl.classList.remove('is-animating');
    void bodyEl.offsetWidth;
    bodyEl.classList.add('is-animating');
  }

  function select(index, fromPill) {
    selected = index;
    const part = index === null ? null : EYE_PARTS[index];

    pillsBox.querySelectorAll('.eye-pill').forEach((btn) => {
      const on = part && btn.getAttribute('data-part') === part.id;
      btn.classList.toggle('is-active', !!on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    if (markerEl) {
      const label = markerEl.querySelector('.eye-marker-label');
      if (label) label.textContent = part ? part.name : '';
    }

    if (part) {
      // A belső képletek csak nyitott metszetben látszanak
      if (part.interior && !cutOn) setCut(true);
      if (fromPill && part.view) {
        targetYaw = part.view.yaw * DEG;
        targetPitch = part.view.pitch * DEG;
        tweening = true;
      }
    }

    renderCard(part);
    requestRender();
  }

  function setCut(on) {
    cutOn = on;
    if (cutBtn) {
      cutBtn.classList.toggle('is-active', on);
      cutBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    requestRender();
  }

  function setSpin(on) {
    spinOn = on;
    if (spinBtn) {
      spinBtn.classList.toggle('is-active', on);
      spinBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    requestRender();
  }

  EYE_PARTS.forEach((part) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'eye-pill';
    btn.setAttribute('data-part', part.id);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.innerHTML = '<span class="eye-pill__swatch" style="background:' + part.swatch + '"></span>' + part.name;
    btn.addEventListener('click', () => select(PART_INDEX[part.id], true));
    btn.addEventListener('mouseenter', () => {
      if (hovered !== PART_INDEX[part.id]) { hovered = PART_INDEX[part.id]; requestRender(); }
    });
    btn.addEventListener('mouseleave', () => {
      if (hovered !== null) { hovered = null; requestRender(); }
    });
    pillsBox.appendChild(btn);
  });

  renderCard(null);

  /* ---- Egér, érintés, billentyűzet -------------------------------------- */
  let dragging = false, dragMoved = false, lastX = 0, lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; dragMoved = false; interacting = true;
    lastX = e.clientX; lastY = e.clientY;
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
      lastX = e.clientX; lastY = e.clientY;
      yaw += dx * 0.0085;
      pitch = Math.max(-1.15, Math.min(1.15, pitch + dy * 0.0075));
      targetYaw = yaw; targetPitch = pitch; tweening = false;
      if (tipEl) tipEl.hidden = true;
      requestRender();
      return;
    }

    if (e.pointerType === 'touch') return;
    const hit = pick(px, py);
    if (hit !== hovered) {
      hovered = hit;
      requestRender();
    }
    canvas.style.cursor = hit === null ? 'grab' : 'pointer';
    if (tipEl) {
      if (hit === null) {
        tipEl.hidden = true;
      } else {
        tipEl.hidden = false;
        tipEl.textContent = EYE_PARTS[hit].name;
        tipEl.style.left = (px / cssW * 100) + '%';
        tipEl.style.top = (py / cssH * 100) + '%';
        tipEl.classList.toggle('is-right', px > cssW * 0.6);
      }
    }
  });

  function endDrag(e) {
    interacting = false;
    if (!dragging) return;
    dragging = false;
    if (canvas.releasePointerCapture && e.pointerId !== undefined) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* már elengedve */ }
    }
    if (dragMoved) return;
    const rect = canvas.getBoundingClientRect();
    const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
    if (hit !== null) select(hit, false);
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { dragging = false; interacting = false; });

  canvas.addEventListener('pointerleave', () => {
    if (hovered !== null) { hovered = null; requestRender(); }
    if (tipEl) tipEl.hidden = true;
  });

  canvas.addEventListener('keydown', (e) => {
    const step = 0.12;
    let used = true;
    if (e.key === 'ArrowLeft') yaw -= step;
    else if (e.key === 'ArrowRight') yaw += step;
    else if (e.key === 'ArrowUp') pitch = Math.min(1.15, pitch + step);
    else if (e.key === 'ArrowDown') pitch = Math.max(-1.15, pitch - step);
    else used = false;
    if (used) {
      e.preventDefault();
      targetYaw = yaw; targetPitch = pitch; tweening = false;
      requestRender();
    }
  });

  if (cutBtn) cutBtn.addEventListener('click', () => setCut(!cutOn));
  if (spinBtn) spinBtn.addEventListener('click', () => setSpin(!spinOn));
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      targetYaw = DEFAULT_VIEW.yaw * DEG;
      targetPitch = DEFAULT_VIEW.pitch * DEG;
      tweening = true;
      setCut(true);
      select(null, false);
    });
  }
  if (reduceMotion) setSpin(false);

  /* ---- Láthatóság és életciklus ----------------------------------------- */
  resize();

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      resize();
      requestRender();
    });
  });

  const observer = new IntersectionObserver((entries) => {
    inView = entries[0].isIntersecting;
    if (inView) { resize(); requestRender(); } else stopLoop();
  }, { threshold: 0.05 });
  observer.observe(viewport);

  document.addEventListener('visibilitychange', () => {
    if (isPageLive()) requestRender(); else stopLoop();
  });
  frameMotion.hooks.push(() => {
    if (isPageLive()) requestRender(); else stopLoop();
  });
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
  if (!CSS.supports('(animation-timeline: view()) and (animation-range: entry)')) {
    const cards = document.querySelectorAll('.product-card');

    if (cards.length > 0) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0) scale(1)';
            observer.unobserve(entry.target); // Csak egyszer fut le
          }
        });
      }, {
        threshold: 0.15
      });

      cards.forEach(card => {
        // Kezdőállapot beállítása
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px) scale(0.95)';
        card.style.transition = 'opacity 0.6s ease, transform 0.6s cubic-bezier(0.25, 0.8, 0.25, 1)';
        observer.observe(card);
      });
    }
  }
}

/* ==========================================================================
   9. Light Dismiss Dialog Fallback (Safari-ra és régebbi böngészőkre)
   ========================================================================== */
function initDialogDismissFallback() {
  const dialogs = document.querySelectorAll('#booking-dialog, #service-dialog');
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
