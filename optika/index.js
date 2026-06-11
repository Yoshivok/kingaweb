/* ==========================================================================
   Lumina Optika — Kliensoldali Interaktivitás
   ========================================================================== */

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
  let animationFrameId;
  let isCanvasVisible = false;
  let canvasRect = null;
  let lastScrollY = -1;
  let lastBlur = -1;
  let entranceDone = false;

  // Csökkentett mozgás igény tiszteletben tartása (akadálymentesség + alacsony teljesítményű eszközök)
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Caching variables for lens and gradients
  let lensX, lensY, lensR;
  let lensGrad = null;
  let glareGrad = null;

  // Méretezés (felbontás maximalizálása a fill-rate csökkentéséhez nagy képernyőkön)
  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = canvas.width = Math.min(1200, rect.width);
    height = canvas.height = Math.round((rect.height / rect.width) * width);
    canvasRect = rect; // Eltároljuk a méreteket a forced-reflow elkerülésére

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
  window.addEventListener('resize', resize);

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

  function animate(currentTime) {
    if (!isCanvasVisible) return; // Ha nem látszik, teljesen megáll a loop

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

      // A blur(...) szövegre alkalmazva drága (újrarasterizálás), ezért egész px-re
      // kvantáljuk és csak változáskor írjuk ki – így a teljes görgetés alatt csak
      // néhányszor rasterizálódik újra a 0..6px tartományban.
      const blurAmount = Math.round(scrollPercent * 6);
      if (blurAmount !== lastBlur) {
        heroContent.style.filter = blurAmount > 0 ? `blur(${blurAmount}px)` : '';
        lastBlur = blurAmount;
      }
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

    // Csökkentett mozgásnál csak egyetlen statikus képkockát rajzolunk, nem indítunk loopot
    if (reduceMotion) return;

    animationFrameId = requestAnimationFrame(animate);
  }

  // Csökkentett mozgás igény esetén egy statikus kockát rajzolunk és nem indítjuk az animációs loopot
  if (reduceMotion) {
    isCanvasVisible = true;
    animate();
    return;
  }

  // Megállítjuk az animációt, ha a hero szekció kívül esik a képernyőn (Scroll Throttling)
  const observer = new IntersectionObserver((entries) => {
    const wasVisible = isCanvasVisible;
    isCanvasVisible = entries[0].isIntersecting;

    if (isCanvasVisible && !wasVisible) {
      animationFrameId = requestAnimationFrame(animate);
    } else if (!isCanvasVisible && wasVisible) {
      cancelAnimationFrame(animationFrameId); // Teljesen leállítja
    }
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
    const bgImg = (activeCondition === 'myopia') ? "assets/myopia_skyscraper.png" :
      (activeCondition === 'farkasvaksag') ? "assets/night_driving.png" : "assets/book_in_hand.png";

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
   6. Online Időpontfoglaló Rendszer (Többlépcsős naptár)
   ========================================================================== */
function initBookingSystem() {
  const dialog = document.getElementById('booking-dialog');
  const form = document.getElementById('booking-form');
  const openButtons = document.querySelectorAll('[aria-haspopup="dialog"], .service-booking-trigger');
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

      // Ha a vizsgálatok szekcióból indult, automatikusan jelölje be a megfelelő vizsgálatot
      const serviceId = btn.getAttribute('data-service');
      if (serviceId) {
        const radios = form.elements['booking-service'];
        if (radios) {
          if (serviceId === '1') radios.value = 'general-exam';
          if (serviceId === '2') radios.value = 'contact-lens';
          if (serviceId === '3') radios.value = 'glasses-fitting';
          if (serviceId === '4') radios.value = 'pediatric-exam';
        }
      }

      resetBooking();
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
    document.querySelectorAll('.form-group').forEach(grp => grp.classList.remove('invalid'));

    goToStep(1);
    renderCalendar();
  }

  // Lépésváltó fő funkció
  function goToStep(stepNum) {
    bookingState.step = stepNum;

    // Panelek láthatósága
    steps.forEach(panel => {
      const panelStep = parseInt(panel.getAttribute('data-step'));
      panel.classList.toggle('active', panelStep === stepNum);
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
    slotsContainer.innerHTML = '';

    if (!bookingState.date) {
      selectedDayLabel.textContent = 'Válasszon egy napot';
      slotsContainer.innerHTML = '<p class="time-placeholder">Kérjük, először kattintson egy napra a naptárban!</p>';
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

  function showError(inputEl, isError) {
    const group = inputEl.closest('.form-group');
    if (group) {
      group.classList.toggle('invalid', isError);
    }
  }

  // Szolgáltatásnevek magyarítása a visszaigazoláshoz
  const serviceNames = {
    'general-exam': 'Komplett Látásvizsgálat',
    'contact-lens': 'Kontaktlencse Illesztés',
    'glasses-fitting': 'Szemüvegkészítés Tanácsadás',
    'pediatric-exam': 'Gyermek Szemészeti Szűrés'
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
   7. CSS Scroll-Driven Animations Fallback
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
   8. Light Dismiss Dialog Fallback (Safari-ra és régebbi böngészőkre)
   ========================================================================== */
function initDialogDismissFallback() {
  const dialog = document.getElementById('booking-dialog');
  if (!dialog) return;

  // Ha a böngésző NEM támogatja a closedby attribútumot (Safari pl.)
  if (!('closedBy' in HTMLDialogElement.prototype)) {
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
  }
}

/* ==========================================================================
   9. Meglévő Foglalás Keresése (LocalStorage) & Toast Értesítés
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
        'pediatric-exam': 'Gyermek Szemészeti Szűrés'
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
