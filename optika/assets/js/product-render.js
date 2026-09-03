/* ═══════════════════════════════════════════════════════════════════════════
   TERMÉKMEGJELENÍTÉS — közös a weboldal és az admin előnézet között
   ─────────────────────────────────────────────────────────────────────────
   Egy helyen írjuk le, hogy néz ki egy termékkártya és egy termék részletes
   nézete. Az `optika/index.js` és az admin felület is ezt hívja, így az
   előnézet nem „hasonlít” a valódi megjelenésre, hanem AZONOS vele.

   EGY SZABÁLY, amitől nem térünk el: minden, ami az adminból jön, kizárólag
   `textContent`-tel kerül a lapra — soha `innerHTML`-lel. A `textContent`
   nem értelmez jelölőnyelvet, tehát ha valaki `<script>`-et ír a termék
   nevébe, az szövegként jelenik meg, nem kódként. Ez a védelem akkor is áll,
   ha a kiszolgálóoldali ellenőrzés valamiért kihagyna valamit — és a CSP
   mellett ez már a harmadik, egymástól független réteg.
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var CATEGORY_LABELS = {
    frames: 'Szemüvegkeret',
    sunglasses: 'Napszemüveg',
    lenses: 'Dioptriás lencse',
    accessories: 'Kiegészítő'
  };

  var BADGE_TONE_CLASS = {
    premium: 'product-badge--premium',
    new: 'product-badge--new',
    sale: 'product-badge--sale'
  };

  /* ── Apró DOM-segédek ──────────────────────────────────────────────────── */
  function el(tag, className, textValue) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue != null && textValue !== '') node.textContent = textValue;
    return node;
  }

  /** Üres helyőrző, amikor egy terméknek nincs képe. */
  function placeholder(className) {
    var box = el('div', className || 'product-image-placeholder');
    box.setAttribute('aria-hidden', 'true');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '34');
    svg.setAttribute('height', '34');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '3'); rect.setAttribute('y', '3');
    rect.setAttribute('width', '18'); rect.setAttribute('height', '18');
    rect.setAttribute('rx', '2');
    var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '8.5'); circle.setAttribute('cy', '8.5'); circle.setAttribute('r', '1.5');
    var pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', 'M21 15l-5-5L5 21');

    svg.appendChild(rect); svg.appendChild(circle); svg.appendChild(pathEl);
    box.appendChild(svg);
    box.appendChild(el('span', null, 'Nincs feltöltött kép'));
    return box;
  }

  /**
   * Kép elem a megadott forrásokból, arányhelyesen.
   * A `width`/`height` attribútum a helyfoglalás miatt fontos: enélkül a
   * kép beérkezésekor megugrik az alatta lévő tartalom.
   */
  function imageNode(image, className, sizes, preferFull) {
    var img = el('img', className);
    img.src = preferFull ? image.full : (image.thumb || image.full);
    if (!preferFull && image.thumb && image.full && image.thumb !== image.full) {
      img.srcset = image.thumb + ' 600w, ' + image.full + ' 1200w';
      if (sizes) img.sizes = sizes;
    }
    img.alt = image.alt || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    if (image.w && image.h) { img.width = image.w; img.height = image.h; }
    return img;
  }

  /* ── Termékkártya ──────────────────────────────────────────────────────── */
  /**
   * @param {object} product
   * @param {{onDetails?: Function, buttonLabel?: string}} [options]
   * @returns {HTMLElement}
   */
  function createCard(product, options) {
    var opts = options || {};
    var card = el('div', 'product-card');
    card.setAttribute('data-category', product.category);
    card.setAttribute('data-id', product.id);

    var wrapper = el('div', 'product-image-wrapper');
    if (product.images && product.images.length) {
      wrapper.appendChild(imageNode(
        product.images[0], 'product-image', '(max-width: 768px) 90vw, 300px', false
      ));
    } else {
      wrapper.appendChild(placeholder());
    }

    if (product.badge) {
      var badge = el('span', 'product-badge', product.badge);
      var tone = BADGE_TONE_CLASS[product.badgeTone];
      if (tone) badge.classList.add(tone);
      wrapper.appendChild(badge);
    }

    /* Több fotó esetén jelezzük a kártyán is — így látszik, hogy van mit megnyitni. */
    if (product.images && product.images.length > 1) {
      var count = el('span', 'product-photo-count');
      count.appendChild(el('span', null, String(product.images.length)));
      count.setAttribute('aria-label', product.images.length + ' fotó');
      wrapper.appendChild(count);
    }

    card.appendChild(wrapper);

    var info = el('div', 'product-info');
    if (product.brand) info.appendChild(el('span', 'product-brand', product.brand));
    info.appendChild(el('h3', 'product-title', product.title));
    if (product.shortDesc) info.appendChild(el('p', 'product-desc', product.shortDesc));

    var footer = el('div', 'product-footer');
    footer.appendChild(el('span', 'product-price', product.price || ''));

    var button = el('button', 'btn btn-outline btn-sm product-action-btn', opts.buttonLabel || 'Érdekel');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-label', 'Részletek – ' + product.title);
    if (opts.onDetails) {
      button.addEventListener('click', function () { opts.onDetails(product, button); });
    }
    footer.appendChild(button);

    info.appendChild(footer);
    card.appendChild(info);
    return card;
  }

  /* ── Részletes nézet ───────────────────────────────────────────────────── */
  /**
   * A termék teljes bemutatóját beépíti a megadott konténerbe.
   * A konténer előző tartalmát törli.
   *
   * @param {object} product
   * @param {HTMLElement} container
   * @param {{titleId?: string, onBook?: Function, showEmpty?: boolean}} [options]
   * @returns {{focusTarget: HTMLElement|null}}
   */
  function renderDetail(product, container, options) {
    var opts = options || {};
    container.textContent = '';

    var images = (product.images || []).slice();
    var current = 0;

    /* ── Galéria ─────────────────────────────────────────────────────────── */
    var gallery = el('div', 'pd-gallery');
    var stage = el('div', 'pd-stage');
    var mainImg = null;

    if (images.length) {
      mainImg = imageNode(images[0], 'pd-main-image', null, true);
      mainImg.loading = 'eager';
      stage.appendChild(mainImg);
    } else {
      stage.appendChild(placeholder('pd-placeholder'));
    }

    if (product.badge) {
      var badge = el('span', 'pd-badge', product.badge);
      var tone = BADGE_TONE_CLASS[product.badgeTone];
      if (tone) badge.classList.add(tone);
      stage.appendChild(badge);
    }

    var thumbs = null;
    var counter = null;

    function show(index) {
      if (!images.length || !mainImg) return;
      current = (index + images.length) % images.length;
      var image = images[current];
      mainImg.src = image.full;
      mainImg.alt = image.alt || product.title;
      if (image.w && image.h) { mainImg.width = image.w; mainImg.height = image.h; }

      if (thumbs) {
        var buttons = thumbs.querySelectorAll('.pd-thumb');
        for (var i = 0; i < buttons.length; i += 1) {
          var active = i === current;
          buttons[i].classList.toggle('is-active', active);
          /* `aria-pressed`: a most látható fotó gombja lenyomott állapotú. */
          buttons[i].setAttribute('aria-pressed', active ? 'true' : 'false');
        }
      }
      if (counter) counter.textContent = (current + 1) + ' / ' + images.length;
    }

    if (images.length > 1) {
      var prev = el('button', 'pd-nav pd-nav--prev');
      prev.type = 'button';
      prev.setAttribute('aria-label', 'Előző fotó');
      prev.appendChild(arrow('M15 18l-6-6 6-6'));
      prev.addEventListener('click', function () { show(current - 1); });

      var next = el('button', 'pd-nav pd-nav--next');
      next.type = 'button';
      next.setAttribute('aria-label', 'Következő fotó');
      next.appendChild(arrow('M9 18l6-6-6-6'));
      next.addEventListener('click', function () { show(current + 1); });

      counter = el('span', 'pd-counter');
      stage.appendChild(prev);
      stage.appendChild(next);
      stage.appendChild(counter);

      /* Ujjal húzás mobilon. Csak vízszintes mozdulatra reagál, hogy a
         függőleges görgetést ne akassza meg. */
      var startX = 0, startY = 0, tracking = false;
      stage.addEventListener('touchstart', function (event) {
        if (event.touches.length !== 1) return;
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
        tracking = true;
      }, { passive: true });
      stage.addEventListener('touchend', function (event) {
        if (!tracking) return;
        tracking = false;
        var touch = event.changedTouches[0];
        var dx = touch.clientX - startX;
        var dy = touch.clientY - startY;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          show(current + (dx < 0 ? 1 : -1));
        }
      }, { passive: true });
    }

    gallery.appendChild(stage);

    if (images.length > 1) {
      thumbs = el('div', 'pd-thumbs');
      /* NEM `role="tablist"`: fülekhez tartozó panelek kellenének hozzá, itt
         viszont egyetlen kép cserélődik. A képernyőolvasónak így nyomógombok
         csoportja, ami pontosan az, ami. */
      thumbs.setAttribute('role', 'group');
      thumbs.setAttribute('aria-label', 'Termékfotók');

      images.forEach(function (image, index) {
        var button = el('button', 'pd-thumb');
        button.type = 'button';
        button.setAttribute('aria-label', (index + 1) + '. fotó megjelenítése');
        var thumbImg = el('img');
        thumbImg.src = image.thumb || image.full;
        thumbImg.alt = '';
        thumbImg.loading = 'lazy';
        thumbImg.decoding = 'async';
        button.appendChild(thumbImg);
        button.addEventListener('click', function () { show(index); });
        button.addEventListener('keydown', function (event) {
          if (event.key === 'ArrowRight') { event.preventDefault(); show(current + 1); focusThumb(); }
          if (event.key === 'ArrowLeft') { event.preventDefault(); show(current - 1); focusThumb(); }
        });
        thumbs.appendChild(button);
      });

      function focusThumb() {
        var active = thumbs.querySelector('.pd-thumb.is-active');
        if (active) active.focus();
      }

      gallery.appendChild(thumbs);
    }

    /* ── Fejadatok ───────────────────────────────────────────────────────── */
    var head = el('div', 'pd-head');
    if (product.brand) head.appendChild(el('span', 'pd-brand', product.brand));

    var title = el('h2', 'pd-title', product.title);
    if (opts.titleId) title.id = opts.titleId;
    head.appendChild(title);

    var meta = el('div', 'pd-meta');
    var categoryLabel = CATEGORY_LABELS[product.category];
    if (categoryLabel) meta.appendChild(el('span', 'pd-chip', categoryLabel));
    if (product.price) meta.appendChild(el('span', 'pd-chip pd-chip--price', product.price));
    if (meta.childNodes.length) head.appendChild(meta);

    if (product.shortDesc) head.appendChild(el('p', 'pd-lead', product.shortDesc));

    var top = el('div', 'pd-top');
    top.appendChild(gallery);
    top.appendChild(head);
    container.appendChild(top);

    /* ── Szöveges rész ───────────────────────────────────────────────────── */
    var detail = product.detail || {};
    var body = el('div', 'pd-body');

    if (detail.intro) {
      /* A bekezdéseket az üres sorok jelölik. Külön `<p>`-kbe tesszük, hogy
         a szöveg valóban tagolt legyen, ne egy hosszú blokk. */
      detail.intro.split(/\n{2,}/).forEach(function (paragraph) {
        var trimmed = paragraph.trim();
        if (trimmed) body.appendChild(el('p', 'pd-paragraph', trimmed));
      });
    }

    if (detail.features && detail.features.length) {
      var featureSection = el('section', 'pd-section');
      featureSection.appendChild(el('h3', 'pd-subtitle', 'Amit tudni érdemes'));
      var list = el('ul', 'pd-list');
      detail.features.forEach(function (feature) {
        list.appendChild(el('li', null, feature));
      });
      featureSection.appendChild(list);
      body.appendChild(featureSection);
    }

    if (detail.specs && detail.specs.length) {
      var specSection = el('section', 'pd-section');
      specSection.appendChild(el('h3', 'pd-subtitle', 'Adatok'));
      var table = el('dl', 'pd-specs');
      detail.specs.forEach(function (spec) {
        var row = el('div', 'pd-spec-row');
        row.appendChild(el('dt', null, spec.label));
        row.appendChild(el('dd', null, spec.value));
        table.appendChild(row);
      });
      specSection.appendChild(table);
      body.appendChild(specSection);
    }

    if (detail.outro) {
      detail.outro.split(/\n{2,}/).forEach(function (paragraph) {
        var trimmed = paragraph.trim();
        if (trimmed) body.appendChild(el('p', 'pd-note', trimmed));
      });
    }

    if (!body.childNodes.length && opts.showEmpty !== false) {
      body.appendChild(el('p', 'pd-empty',
        'Ehhez a termékhez még nem készült részletes leírás. Szalonunkban szívesen bemutatjuk személyesen.'));
    }

    container.appendChild(body);

    /* ── Zárósor ─────────────────────────────────────────────────────────── */
    if (opts.onBook) {
      var actions = el('div', 'pd-actions');
      var bookBtn = el('button', 'btn btn-primary', 'Időpontot kérek felpróbálásra');
      bookBtn.type = 'button';
      bookBtn.addEventListener('click', function () { opts.onBook(product); });
      actions.appendChild(bookBtn);

      var note = el('p', 'pd-actions-note',
        'Az árak tájékoztató jellegűek. A pontos ajánlatot a mérés és a lencseválasztás után adjuk.');
      actions.appendChild(note);
      container.appendChild(actions);
    }

    show(0);
    return { focusTarget: title };
  }

  function arrow(d) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', d);
    svg.appendChild(pathEl);
    return svg;
  }

  global.LuminaProducts = {
    CATEGORY_LABELS: CATEGORY_LABELS,
    createCard: createCard,
    renderDetail: renderDetail,
    imageNode: imageNode
  };
})(window);
