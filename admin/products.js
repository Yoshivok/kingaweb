/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN — LUMINA OPTIKA: KIEMELT TERMÉKEK
   ─────────────────────────────────────────────────────────────────────────
   A weboldal „Exkluzív Választék” szakaszának szerkesztője. A vázhoz
   (`app.js`) az `Admin.register` hívással csatlakozik: az adja a
   bejelentkezést, a kiszolgálóhívást és a megerősítő ablakot, ez a fájl
   pedig csak a termékekkel foglalkozik.

   A képek feltöltés ELŐTT a böngészőben átméreteződnek és WebP-be
   tömörödnek. Ennek három haszna van: a látogatónak kevesebbet kell
   letöltenie, a fényképezőgép EXIF-adatai (köztük a GPS-koordináta) az
   újrakódolással eltűnnek, és a kiszolgálóra egységes formátum érkezik.

   Megjelenítés kizárólag `textContent`-tel és `createElement`-tel — soha
   `innerHTML`-lel. Lásd az `app.js` fejlécében a két alapszabályt.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var $ = Admin.$;
  var el = Admin.el;
  var show = Admin.show;
  var api = Admin.api;
  var toast = Admin.toast;

  var state = {
    products: [],
    filters: { text: '', category: 'all', status: 'all' },
    editing: null,      /* a szerkesztett termék másolata, vagy null = új */
    photos: [],
    dirty: false
  };

  var LIMITS = { images: 8, features: 14, specs: 14 };

  var CATEGORY_LABELS = {
    frames: 'Szemüvegkeret',
    sunglasses: 'Napszemüveg',
    lenses: 'Dioptriás lencse',
    accessories: 'Kiegészítő'
  };

  /* ══════════════════ TERMÉKLISTA ══════════════════ */
  function loadProducts() {
    return api('/api/admin/products').then(function (data) {
      state.products = data.products || [];
      if (data.limits) {
        LIMITS.images = data.limits.images || LIMITS.images;
        LIMITS.features = data.limits.features || LIMITS.features;
        LIMITS.specs = data.limits.specs || LIMITS.specs;
      }
      renderList();
    }).catch(Admin.reportError);
  }

  function visibleProducts() {
    var text = state.filters.text.trim().toLowerCase();
    return state.products.filter(function (p) {
      if (state.filters.category !== 'all' && p.category !== state.filters.category) return false;
      if (state.filters.status === 'published' && !p.published) return false;
      if (state.filters.status === 'draft' && p.published) return false;
      if (text) {
        var haystack = (p.title + ' ' + p.brand + ' ' + p.shortDesc).toLowerCase();
        if (haystack.indexOf(text) === -1) return false;
      }
      return true;
    });
  }

  function renderList() {
    var grid = $('admin-grid');
    var empty = $('admin-empty');
    grid.textContent = '';

    var published = state.products.filter(function (p) { return p.published; }).length;
    $('stat-total').textContent = String(state.products.length);
    $('stat-published').textContent = String(published);
    $('stat-draft').textContent = String(state.products.length - published);

    var list = visibleProducts();

    if (!list.length) {
      show(empty, true);
      empty.textContent = state.products.length
        ? 'Ehhez a szűréshez nincs találat. Próbálja más kategóriával vagy törölje a keresést.'
        : 'Még nincs egyetlen termék sem. Kezdje az „Új termék” gombbal.';
      return;
    }
    show(empty, false);

    list.forEach(function (product) {
      grid.appendChild(adminCard(product));
    });
  }

  function adminCard(product) {
    var card = el('div', 'admin-card' + (product.published ? '' : ' is-draft'));

    /* ── Felső rész: bélyegkép + adatok ── */
    var top = el('div', 'admin-card-top');
    var thumb = el('div', 'admin-card-thumb');

    if (product.images.length) {
      var img = el('img');
      img.src = product.images[0].thumb || product.images[0].full;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      thumb.appendChild(img);
      if (product.images.length > 1) {
        thumb.appendChild(el('span', 'photo-badge', product.images.length + ' db'));
      }
    } else {
      thumb.appendChild(el('span', null, 'nincs kép'));
    }
    top.appendChild(thumb);

    var info = el('div', 'admin-card-info');
    if (product.brand) info.appendChild(el('span', 'admin-card-brand', product.brand));
    info.appendChild(el('h2', 'admin-card-title', product.title));
    if (product.shortDesc) info.appendChild(el('p', 'admin-card-desc', product.shortDesc));

    var tags = el('div', 'admin-card-tags');
    tags.appendChild(el('span', 'tag', CATEGORY_LABELS[product.category] || product.category));
    if (product.price) tags.appendChild(el('span', 'tag tag--price', product.price));
    if (product.badge) tags.appendChild(el('span', 'tag tag--badge', product.badge));
    tags.appendChild(el('span',
      'tag ' + (product.published ? 'tag--published' : 'tag--draft'),
      product.published ? 'Megjelenik' : 'Rejtett'));
    info.appendChild(tags);

    top.appendChild(info);
    card.appendChild(top);

    /* ── Műveletek ── */
    var actions = el('div', 'admin-card-actions');

    var editBtn = el('button', 'btn btn-outline btn-sm', 'Szerkesztés');
    editBtn.type = 'button';
    editBtn.addEventListener('click', function () { openEditor(product); });
    actions.appendChild(editBtn);

    var toggleBtn = el('button', 'btn btn-ghost btn-sm', product.published ? 'Elrejtés' : 'Megjelenítés');
    toggleBtn.type = 'button';
    toggleBtn.addEventListener('click', function () { togglePublished(product, toggleBtn); });
    actions.appendChild(toggleBtn);

    /* Sorrend. Nem húzással: érintőképernyőn a húzás gyakran a lapgörgetéssel
       verseng, a nyíl viszont mindenhol pontosan azt teszi, amit mutat. */
    var index = state.products.indexOf(product);
    var order = el('div', 'order-buttons');

    var upBtn = el('button', 'btn btn-ghost btn-sm order-btn', '↑');
    upBtn.type = 'button';
    upBtn.setAttribute('aria-label', 'Előrébb: ' + product.title);
    upBtn.disabled = index <= 0;
    upBtn.addEventListener('click', function () { move(index, -1); });

    var downBtn = el('button', 'btn btn-ghost btn-sm order-btn', '↓');
    downBtn.type = 'button';
    downBtn.setAttribute('aria-label', 'Hátrébb: ' + product.title);
    downBtn.disabled = index >= state.products.length - 1;
    downBtn.addEventListener('click', function () { move(index, 1); });

    order.appendChild(upBtn);
    order.appendChild(downBtn);
    actions.appendChild(order);

    var deleteBtn = el('button', 'btn btn-ghost btn-sm', 'Törlés');
    deleteBtn.type = 'button';
    deleteBtn.addEventListener('click', function () { removeProduct(product); });
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    return card;
  }

  function togglePublished(product, button) {
    var next = Object.assign({}, product, { published: !product.published });
    button.disabled = true;
    api('/api/admin/products/' + product.id, { method: 'PUT', json: { product: next } })
      .then(function (data) {
        var index = state.products.findIndex(function (p) { return p.id === product.id; });
        if (index !== -1) state.products[index] = data.product;
        renderList();
        toast(data.product.published
          ? 'A termék mostantól látszik a weboldalon.'
          : 'A termék elrejtve — a látogatók nem látják.', 'success');
      })
      .catch(function (error) {
        button.disabled = false;
        Admin.reportError(error);
      });
  }

  function move(index, delta) {
    var target = index + delta;
    if (target < 0 || target >= state.products.length) return;

    var list = state.products.slice();
    var moved = list.splice(index, 1)[0];
    list.splice(target, 0, moved);
    state.products = list;
    renderList();

    api('/api/admin/products/order', {
      method: 'POST',
      json: { ids: list.map(function (p) { return p.id; }) }
    }).catch(function (error) {
      Admin.reportError(error);
      if (error.message !== 'unauthorised') loadProducts();   /* a kiszolgáló állapotát vesszük igazságnak */
    });
  }

  function removeProduct(product) {
    Admin.confirm(
      'Termék törlése',
      '„' + product.title + '” véglegesen törlődik a weboldalról, a hozzá tartozó fotókkal együtt. Ez nem vonható vissza.',
      'Igen, törlöm'
    ).then(function (confirmed) {
      if (!confirmed) return;
      return api('/api/admin/products/' + product.id, { method: 'DELETE' })
        .then(function () {
          state.products = state.products.filter(function (p) { return p.id !== product.id; });
          renderList();
          toast('A termék törölve.', 'success');
        })
        .catch(Admin.reportError);
    });
  }

  /* ══════════════════ SZERKESZTŐ ══════════════════ */
  function emptyProduct() {
    return {
      id: null,
      category: 'frames',
      brand: '',
      title: '',
      shortDesc: '',
      price: '',
      badge: '',
      badgeTone: 'none',
      published: true,
      images: [],
      detail: { intro: '', features: [], specs: [], outro: '' }
    };
  }

  function openEditor(product) {
    state.editing = product ? JSON.parse(JSON.stringify(product)) : emptyProduct();
    state.photos = state.editing.images.slice();
    state.dirty = false;

    $('editor-title').textContent = product ? 'Termék szerkesztése' : 'Új termék';
    $('editor-subtitle').textContent = product
      ? 'A mentés azonnal frissíti a weboldalt.'
      : 'Töltse ki az adatokat, majd mentse el. A név megadása kötelező.';

    $('f-title').value = state.editing.title;
    $('f-brand').value = state.editing.brand;
    $('f-price').value = state.editing.price;
    $('f-category').value = state.editing.category;
    $('f-short').value = state.editing.shortDesc;
    $('f-published').checked = state.editing.published;
    $('f-intro').value = state.editing.detail.intro;
    $('f-outro').value = state.editing.detail.outro;

    setBadgeFields(state.editing.badge, state.editing.badgeTone);
    renderPhotos();
    renderFeatures(state.editing.detail.features);
    renderSpecs(state.editing.detail.specs);
    updateCounters();
    selectTab('basics');
    show($('editor-error'), false);
    show($('upload-status'), false);

    $('editor-dialog').showModal();
    setTimeout(function () { $('f-title').focus(); }, 60);
  }

  function setBadgeFields(badge, tone) {
    var preset = $('f-badge-preset');
    var value = badge ? badge + '|' + tone : '';
    var known = Array.prototype.some.call(preset.options, function (option) { return option.value === value; });

    if (!badge) {
      preset.value = '';
    } else if (known) {
      preset.value = value;
    } else {
      preset.value = 'custom';
      $('f-badge-text').value = badge;
      $('f-badge-tone').value = tone === 'none' ? 'premium' : tone;
    }
    show($('custom-badge-field'), preset.value === 'custom');
  }

  function readBadge() {
    var preset = $('f-badge-preset').value;
    if (!preset) return { badge: '', badgeTone: 'none' };
    if (preset === 'custom') {
      var text = $('f-badge-text').value.trim();
      return { badge: text, badgeTone: text ? $('f-badge-tone').value : 'none' };
    }
    var parts = preset.split('|');
    return { badge: parts[0], badgeTone: parts[1] || 'premium' };
  }

  function collectForm() {
    var badge = readBadge();
    return {
      id: state.editing.id,
      category: $('f-category').value,
      brand: $('f-brand').value.trim(),
      title: $('f-title').value.trim(),
      shortDesc: $('f-short').value.trim(),
      price: $('f-price').value.trim(),
      badge: badge.badge,
      badgeTone: badge.badgeTone,
      published: $('f-published').checked,
      images: state.photos.slice(),
      detail: {
        intro: $('f-intro').value,
        features: collectFeatures(),
        specs: collectSpecs(),
        outro: $('f-outro').value
      }
    };
  }

  /* ── Fülek ─────────────────────────────────────────────────────────────── */
  function selectTab(name) {
    var tabs = document.querySelectorAll('.editor-tab');
    Array.prototype.forEach.call(tabs, function (tab) {
      var active = tab.getAttribute('data-tab') === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    var panels = document.querySelectorAll('.editor-panel');
    Array.prototype.forEach.call(panels, function (panel) {
      panel.classList.toggle('is-active', panel.getAttribute('data-panel') === name);
    });

    var body = document.querySelector('.editor-body');
    if (body) body.scrollTop = 0;

    if (name === 'preview') renderPreview();
  }

  /* ── Fotók ─────────────────────────────────────────────────────────────── */
  function renderPhotos() {
    var list = $('photo-list');
    list.textContent = '';
    $('tab-count-photos').textContent = String(state.photos.length);

    state.photos.forEach(function (photo, index) {
      var item = el('div', 'photo-item' + (index === 0 ? ' is-cover' : ''));

      var thumb = el('div', 'photo-thumb');
      var img = el('img');
      img.src = photo.thumb || photo.full;
      img.alt = '';
      img.loading = 'lazy';
      thumb.appendChild(img);
      if (index === 0) thumb.appendChild(el('span', 'photo-cover-flag', 'Borító'));
      item.appendChild(thumb);

      var fields = el('div', 'photo-fields');

      var altInput = el('input', 'field-input');
      altInput.type = 'text';
      altInput.maxLength = 160;
      altInput.value = photo.alt || '';
      altInput.placeholder = 'Mit ábrázol a kép? (képleírás)';
      altInput.setAttribute('aria-label', (index + 1) + '. fotó leírása');
      altInput.addEventListener('input', function () {
        state.photos[index].alt = altInput.value;
        state.dirty = true;
      });
      fields.appendChild(altInput);

      var actions = el('div', 'photo-actions');

      var upBtn = el('button', 'btn btn-ghost btn-sm', '← Előre');
      upBtn.type = 'button';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', function () { movePhoto(index, -1); });
      actions.appendChild(upBtn);

      var downBtn = el('button', 'btn btn-ghost btn-sm', 'Hátra →');
      downBtn.type = 'button';
      downBtn.disabled = index === state.photos.length - 1;
      downBtn.addEventListener('click', function () { movePhoto(index, 1); });
      actions.appendChild(downBtn);

      var removeBtn = el('button', 'btn btn-ghost btn-sm', 'Eltávolít');
      removeBtn.type = 'button';
      removeBtn.addEventListener('click', function () {
        state.photos.splice(index, 1);
        state.dirty = true;
        renderPhotos();
      });
      actions.appendChild(removeBtn);

      fields.appendChild(actions);
      item.appendChild(fields);
      list.appendChild(item);
    });

    var hint = el('p', 'field-hint');
    hint.textContent = state.photos.length
      ? state.photos.length + ' / ' + LIMITS.images + ' fotó'
      : 'Még nincs feltöltött fotó. Kép nélkül is menthető a termék, de a kártyán helyőrző látszik.';
    list.appendChild(hint);
  }

  function movePhoto(index, delta) {
    var target = index + delta;
    if (target < 0 || target >= state.photos.length) return;
    var moved = state.photos.splice(index, 1)[0];
    state.photos.splice(target, 0, moved);
    state.dirty = true;
    renderPhotos();
  }

  /* ── Képfeldolgozás ─────────────────────────────────────────────────────
     Két méret készül minden fotóból: egy 1200 képpontos a részletes nézethez
     és egy 600 képpontos a kártyához. A böngésző `srcset`-tel maga választ
     közülük, így telefonon nem tölt le fölöslegesen nagy képet.

     A rajzolás `<canvas>`-ra megy, onnan `toBlob`-bal kerül ki: ez ÚJRAKÓDOLÁS,
     tehát az eredeti fájl metaadatai (EXIF, benne a GPS-hely) nem jönnek át. */
  var MAX_FULL = 1200;
  var MAX_THUMB = 600;

  var webpSupport = (function () {
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 1;
      return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (error) {
      return false;
    }
  })();

  function loadBitmap(file) {
    if (typeof createImageBitmap === 'function') {
      /* Az `imageOrientation: 'from-image'` a telefonnal fekve készített
         képeket a helyes állásban adja vissza. */
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(function () { return loadViaElement(file); });
    }
    return loadViaElement(file);
  }

  function loadViaElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('A kép nem olvasható.')); };
      img.src = url;
    });
  }

  function toBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob); else reject(new Error('A kép tömörítése nem sikerült.'));
      }, webpSupport ? 'image/webp' : 'image/jpeg', quality);
    });
  }

  function scaleTo(source, maxSide, quality) {
    var width = source.width;
    var height = source.height;
    var ratio = Math.min(1, maxSide / Math.max(width, height));

    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));

    var ctx = canvas.getContext('2d');
    /* Fehér alap: a PNG átlátszó része különben feketén jelenne meg a
       JPEG-tartaléknál. */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

    return toBlob(canvas, quality).then(function (blob) {
      return { blob: blob, width: canvas.width, height: canvas.height };
    });
  }

  function uploadBlob(blob) {
    return blob.arrayBuffer().then(function (buffer) {
      return api('/api/admin/upload', { method: 'POST', binary: buffer });
    });
  }

  function handleFiles(files) {
    var accepted = Array.prototype.slice.call(files).filter(function (file) {
      return file && file.type && file.type.indexOf('image/') === 0;
    });

    if (!accepted.length) {
      setUploadStatus('Csak képfájl tölthető fel (JPG, PNG vagy WebP).', true);
      return;
    }

    var room = LIMITS.images - state.photos.length;
    if (room <= 0) {
      setUploadStatus('Egy termékhez legfeljebb ' + LIMITS.images + ' fotó tartozhat.', true);
      return;
    }
    var queue = accepted.slice(0, room);
    var skipped = accepted.length - queue.length;

    var done = 0;
    setUploadStatus('Feldolgozás… (0 / ' + queue.length + ')', false);

    /* Egyesével, sorban: párhuzamosan indítva egy gyengébb telefon
       memóriája elfogyhat a nagy felbontású képek dekódolásán. */
    var chain = Promise.resolve();
    queue.forEach(function (file) {
      chain = chain.then(function () {
        return processAndUpload(file).then(function (photo) {
          state.photos.push(photo);
          done += 1;
          setUploadStatus('Feldolgozás… (' + done + ' / ' + queue.length + ')', false);
          renderPhotos();
        });
      });
    });

    chain.then(function () {
      state.dirty = true;
      var message = done + ' fotó feltöltve.';
      if (skipped) message += ' ' + skipped + ' kimaradt (elérte a ' + LIMITS.images + ' fotós határt).';
      setUploadStatus(message + ' A mentéssel válik véglegessé.', false);
      renderPhotos();
    }).catch(function (error) {
      if (error.message !== 'unauthorised') setUploadStatus(error.message, true);
      renderPhotos();
    });
  }

  function processAndUpload(file) {
    return loadBitmap(file)
      .then(function (bitmap) {
        return scaleTo(bitmap, MAX_FULL, 0.86).then(function (full) {
          return scaleTo(bitmap, MAX_THUMB, 0.82).then(function (thumb) {
            if (bitmap.close) bitmap.close();
            return { full: full, thumb: thumb };
          });
        });
      })
      .then(function (sizes) {
        return uploadBlob(sizes.full.blob).then(function (fullResult) {
          return uploadBlob(sizes.thumb.blob).then(function (thumbResult) {
            return {
              full: fullResult.url,
              thumb: thumbResult.url,
              alt: '',
              w: fullResult.width || sizes.full.width,
              h: fullResult.height || sizes.full.height
            };
          });
        });
      });
  }

  function setUploadStatus(message, isError) {
    var box = $('upload-status');
    box.textContent = message;
    box.classList.toggle('is-error', !!isError);
    show(box, true);
  }

  /* ── Ismétlődő sorok ───────────────────────────────────────────────────── */
  function renderFeatures(features) {
    var list = $('features-list');
    list.textContent = '';
    (features || []).forEach(function (feature) { list.appendChild(featureRow(feature)); });
  }

  function featureRow(value) {
    var row = el('div', 'repeat-row');
    var inputs = el('div', 'repeat-inputs');

    var input = el('input', 'field-input');
    input.type = 'text';
    input.maxLength = 240;
    input.value = value || '';
    input.placeholder = 'pl. Nikkelmentes felület, allergiásoknak is viselhető';
    input.setAttribute('aria-label', 'Tulajdonság');
    input.addEventListener('input', function () { state.dirty = true; });
    inputs.appendChild(input);
    row.appendChild(inputs);

    row.appendChild(removeRowButton(row, 'Sor törlése'));
    return row;
  }

  function renderSpecs(specs) {
    var list = $('specs-list');
    list.textContent = '';
    (specs || []).forEach(function (spec) { list.appendChild(specRow(spec)); });
  }

  function specRow(spec) {
    var row = el('div', 'repeat-row');
    var inputs = el('div', 'repeat-inputs');

    var label = el('input', 'field-input');
    label.type = 'text';
    label.maxLength = 44;
    label.value = (spec && spec.label) || '';
    label.placeholder = 'Megnevezés (pl. Anyag)';
    label.setAttribute('aria-label', 'Adat megnevezése');
    label.dataset.role = 'label';

    var value = el('input', 'field-input');
    value.type = 'text';
    value.maxLength = 140;
    value.value = (spec && spec.value) || '';
    value.placeholder = 'Érték (pl. japán béta-titán)';
    value.setAttribute('aria-label', 'Adat értéke');
    value.dataset.role = 'value';

    [label, value].forEach(function (input) {
      input.addEventListener('input', function () { state.dirty = true; });
      inputs.appendChild(input);
    });

    row.appendChild(inputs);
    row.appendChild(removeRowButton(row, 'Adat törlése'));
    return row;
  }

  function removeRowButton(row, label) {
    var button = el('button', 'repeat-remove', '×');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', function () {
      row.remove();
      state.dirty = true;
    });
    return button;
  }

  function collectFeatures() {
    return Array.prototype.map.call(
      $('features-list').querySelectorAll('input'),
      function (input) { return input.value.trim(); }
    ).filter(Boolean);
  }

  function collectSpecs() {
    return Array.prototype.map.call(
      $('specs-list').querySelectorAll('.repeat-row'),
      function (row) {
        return {
          label: row.querySelector('[data-role="label"]').value.trim(),
          value: row.querySelector('[data-role="value"]').value.trim()
        };
      }
    ).filter(function (spec) { return spec.label && spec.value; });
  }

  /* ── Előnézet ──────────────────────────────────────────────────────────── */
  function renderPreview() {
    if (!window.LuminaProducts) return;
    var product = collectForm();
    if (!product.title) product.title = 'Névtelen termék';

    var cardBox = $('preview-card');
    cardBox.textContent = '';
    cardBox.appendChild(window.LuminaProducts.createCard(product));

    window.LuminaProducts.renderDetail(product, $('preview-detail'), {});
  }

  /* ── Mentés ────────────────────────────────────────────────────────────── */
  function saveProduct(event) {
    event.preventDefault();

    var product = collectForm();
    var error = $('editor-error');

    if (product.title.length < 2) {
      error.textContent = 'A termék nevét kötelező megadni (legalább 2 karakter).';
      show(error, true);
      selectTab('basics');
      $('f-title').focus();
      return;
    }
    show(error, false);

    var save = $('editor-save');
    save.disabled = true;
    save.textContent = 'Mentés…';

    var isNew = !product.id;
    var request = isNew
      ? api('/api/admin/products', { method: 'POST', json: { product: product } })
      : api('/api/admin/products/' + product.id, { method: 'PUT', json: { product: product } });

    request.then(function (data) {
      if (isNew) {
        state.products.unshift(data.product);
      } else {
        var index = state.products.findIndex(function (p) { return p.id === data.product.id; });
        if (index !== -1) state.products[index] = data.product;
      }
      state.dirty = false;
      renderList();
      $('editor-dialog').close();
      toast(isNew ? 'Az új termék elmentve.' : 'A módosítások elmentve.', 'success');
    }).catch(function (err) {
      if (err.message === 'unauthorised') return;
      error.textContent = err.message;
      show(error, true);
    }).finally(function () {
      save.disabled = false;
      save.textContent = 'Mentés';
    });
  }

  function closeEditor() {
    if (!state.dirty) { $('editor-dialog').close(); return; }
    Admin.confirm(
      'Elveti a módosításokat?',
      'A szerkesztésben nem mentett változások vannak. Ha most bezárja, ezek elvesznek.',
      'Igen, elvetem'
    ).then(function (confirmed) {
      if (confirmed) {
        state.dirty = false;
        $('editor-dialog').close();
      }
    });
  }

  /* ── Karakterszámlálók ─────────────────────────────────────────────────── */
  function updateCounters() {
    Array.prototype.forEach.call(document.querySelectorAll('.char-count'), function (counter) {
      var input = $(counter.getAttribute('data-for'));
      if (!input) return;
      var max = Number(input.getAttribute('maxlength')) || 0;
      var used = input.value.length;
      counter.textContent = used + ' / ' + max;
      counter.classList.toggle('is-near', max > 0 && used > max * 0.9);
    });
  }


  /* ══════════════════ BEKÖTÉS ══════════════════
     Egyszer fut le, az első belépéskor. A kijelentkezés, a megerősítő ablak
     és a jelszócsere a vázhoz tartozik (`app.js`), nem ide. */
  var wired = false;

  function wire() {
    if (wired) return;
    wired = true;

    $('new-product-btn').addEventListener('click', function () { openEditor(null); });

    $('search-input').addEventListener('input', function (event) {
      state.filters.text = event.target.value;
      renderList();
    });
    $('category-filter').addEventListener('change', function (event) {
      state.filters.category = event.target.value;
      renderList();
    });
    $('status-filter').addEventListener('change', function (event) {
      state.filters.status = event.target.value;
      renderList();
    });

    /* ── Szerkesztő ── */
    $('editor-form').addEventListener('submit', saveProduct);
    $('editor-close').addEventListener('click', closeEditor);
    $('editor-cancel').addEventListener('click', closeEditor);

    /* Az Escape a `cancel` eseményt indítja. Ha van nem mentett változás,
       előbb rákérdezünk — a natív bezárás elmarad. */
    $('editor-dialog').addEventListener('cancel', function (event) {
      if (!state.dirty) return;
      event.preventDefault();
      closeEditor();
    });

    $('editor-tabs').addEventListener('click', function (event) {
      var tab = event.target.closest('.editor-tab');
      if (tab) selectTab(tab.getAttribute('data-tab'));
    });

    $('f-badge-preset').addEventListener('change', function (event) {
      show($('custom-badge-field'), event.target.value === 'custom');
      state.dirty = true;
    });

    /* Bármelyik mező módosítása „piszkos” állapotot jelent. */
    document.querySelector('.editor-form').addEventListener('input', function () {
      state.dirty = true;
      updateCounters();
    });
    document.querySelector('.editor-form').addEventListener('change', function () {
      state.dirty = true;
    });

    $('add-feature').addEventListener('click', function () {
      var list = $('features-list');
      if (list.children.length >= LIMITS.features) {
        toast('Legfeljebb ' + LIMITS.features + ' sor adható meg.', 'error');
        return;
      }
      var row = featureRow('');
      list.appendChild(row);
      row.querySelector('input').focus();
      state.dirty = true;
    });

    $('add-spec').addEventListener('click', function () {
      var list = $('specs-list');
      if (list.children.length >= LIMITS.specs) {
        toast('Legfeljebb ' + LIMITS.specs + ' adat adható meg.', 'error');
        return;
      }
      var row = specRow(null);
      list.appendChild(row);
      row.querySelector('input').focus();
      state.dirty = true;
    });

    /* ── Fotók: tallózás és húzás ── */
    var dropzone = $('dropzone');
    var fileInput = $('file-input');

    dropzone.addEventListener('click', function () { fileInput.click(); });
    dropzone.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files.length) handleFiles(fileInput.files);
      fileInput.value = '';   /* ugyanaz a fájl újra kiválasztható legyen */
    });

    ['dragenter', 'dragover'].forEach(function (name) {
      dropzone.addEventListener(name, function (event) {
        event.preventDefault();
        dropzone.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      dropzone.addEventListener(name, function (event) {
        event.preventDefault();
        dropzone.classList.remove('is-over');
      });
    });
    dropzone.addEventListener('drop', function (event) {
      if (event.dataTransfer && event.dataTransfer.files.length) handleFiles(event.dataTransfer.files);
    });

    /* A lapra ejtett fájlt a váz fogja el (app.js), hogy a böngésző ne
       navigáljon el a nem mentett szerkesztésről. */
  }


  /* ══════════════════ BEJELENTKEZÉS A VÁZNÁL ══════════════════ */
  Admin.register('optika', {
    title: 'Lumina Optika — Kiemelt termékek',
    shortTitle: 'Lumina Optika',
    mount: function () {
      wire();
      loadProducts();
    },
    /* A váz ezt kérdezi meg, mielőtt a lap elhagyását engedné. */
    isDirty: function () { return state.dirty && $('editor-dialog').open; }
  });
})();
