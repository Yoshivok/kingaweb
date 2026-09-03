/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN VÁZ — bejelentkezés, területválasztó, közös segédek
   ─────────────────────────────────────────────────────────────────────────
   Ez a fájl NEM tud semmit a termékekről és az árakról. Csak azt intézi, ami
   minden szerkesztőfelületnek közös:

     • bejelentkezés, munkamenet, kijelentkezés, jelszócsere
     • a kiszolgálóhívás (CSRF-fejléc, lejárt munkamenet kezelése)
     • értesítések, megerősítő ablak, apró DOM-segédek
     • a területválasztó és a köztük váltás (#optika, #masszazs)

   A tényleges szerkesztők külön fájlban élnek, és itt jelentkeznek be:

       Admin.register('optika', { title, shortTitle, mount });

   Így egy új terület hozzáadásához nem kell ehhez a fájlhoz nyúlni — és egy
   szerkesztő hibája sem viszi magával az egész felületet.

   KÉT SZABÁLY, ami minden szekcióra érvényes:

   1. EZ NEM A VÉDELEM. A bejelentkezési képernyő csak felület; a jogosultságot
      minden egyes kérésnél a kiszolgáló ellenőrzi újra (munkamenet-süti +
      CSRF-token + azonos eredet). Ha valaki elrejtené a bejelentkezést a
      böngésző fejlesztői eszközeivel, egyetlen adatot sem érne el vele.
   2. SOHA NINCS innerHTML. Minden megjelenített érték `textContent`-tel vagy
      `createElement`-tel kerül a lapra. Így az adminban beírt szöveg akkor sem
      válhat kóddá, ha véletlenül HTML-t másolnak be valamelyik mezőbe.
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* A CSRF-token szándékosan csak memóriában él: nem tesszük localStorage-ba,
     ahonnan egy esetleges szkript kiolvashatná, és nem is kell túlélnie a lap
     újratöltését — olyankor a /api/admin/session újat ad. */
  var state = {
    csrf: null,
    user: null,
    section: null,
    confirmResolve: null
  };

  var sections = {};      /* id → { title, shortTitle, mount, unmount, isDirty } */
  var sectionOrder = [];

  /* ── Apró DOM-segédek ──────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }

  function el(tag, className, textValue) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue != null && textValue !== '') node.textContent = textValue;
    return node;
  }

  function show(node, visible) { if (node) node.hidden = !visible; }

  /* ── Értesítések ───────────────────────────────────────────────────────── */
  function toast(message, kind) {
    var stack = $('toast-stack');
    if (!stack) return;
    var box = el('div', 'toast toast--' + (kind || 'info'), message);
    stack.appendChild(box);
    setTimeout(function () {
      box.style.opacity = '0';
      box.style.transition = 'opacity 0.3s ease';
      setTimeout(function () { box.remove(); }, 320);
    }, kind === 'error' ? 6000 : 3600);
  }

  /* ── Megerősítés ───────────────────────────────────────────────────────── */
  function confirmAction(title, text, okLabel, danger) {
    var dialog = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;

    var ok = $('confirm-ok');
    ok.textContent = okLabel || 'Rendben';
    ok.className = 'btn ' + (danger === false ? 'btn-primary' : 'btn-danger');

    dialog.showModal();
    return new Promise(function (resolve) { state.confirmResolve = resolve; });
  }

  /* A választ MINDIG a bezárás ELŐTT vesszük ki és nullázzuk.
     A `dialog.close()` ugyanis `close` eseményt vált ki, amire szintén ez a
     függvény fut le — `false` válasszal, mert az Escape és a háttérre
     kattintás is így érkezik. Ha a bezárás lenne előbb, a „Törlés”
     megerősítése is `false`-ként érkezne vissza, és a törlés némán elmaradna. */
  function closeConfirm(answer) {
    var resolve = state.confirmResolve;
    state.confirmResolve = null;

    var dialog = $('confirm-dialog');
    if (dialog.open) dialog.close();

    if (resolve) resolve(answer);
  }

  /* ── Kiszolgálóhívás ────────────────────────────────────────────────────
     Egyetlen helyen kezeljük a CSRF-fejlécet és a lejárt munkamenetet. Ha a
     kiszolgáló 401-et ad, azonnal visszatérünk a bejelentkezéshez — nincs
     olyan állapot, amiben a felület használhatónak látszik, de a mentés némán
     elveszne. */
  function api(path, options) {
    var opts = options || {};
    var headers = { Accept: 'application/json' };

    if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.binary) headers['Content-Type'] = 'application/octet-stream';
    if (state.csrf && opts.method && opts.method !== 'GET') headers['X-CSRF-Token'] = state.csrf;

    return fetch(path, {
      method: opts.method || 'GET',
      /* `same-origin`: a süti csak a saját kiszolgálónkhoz megy ki. */
      credentials: 'same-origin',
      headers: headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : (opts.binary || undefined)
    }).then(function (response) {
      return response.json()
        .catch(function () { return { ok: false, error: 'Váratlan válasz a kiszolgálótól.' }; })
        .then(function (data) {
          if (response.status === 401 && !opts.allowUnauthorised) {
            showLogin('A munkamenet lejárt. Jelentkezzen be újra.');
            throw new Error('unauthorised');
          }
          if (!response.ok || !data.ok) throw new Error(data.error || 'A művelet nem sikerült.');
          return data;
        });
    });
  }

  /** Hibakiírás, ami a lejárt munkamenetet nem duplázza meg üzenettel. */
  function reportError(error) {
    if (error && error.message === 'unauthorised') return;
    toast((error && error.message) || 'A művelet nem sikerült.', 'error');
  }

  /* ══════════════════ BEJELENTKEZÉS ══════════════════ */
  function showLogin(message) {
    state.csrf = null;
    state.user = null;
    state.section = null;

    document.body.classList.remove('is-loading');
    show($('admin-app'), false);
    show($('login-screen'), true);

    var error = $('login-error');
    if (message) { error.textContent = message; show(error, true); }
    else { show(error, false); }

    var field = $('login-username');
    if (field && !field.value) field.focus();
  }

  function showAdmin(session) {
    state.csrf = session.csrfToken;
    state.user = session.user;
    state.section = null;

    document.body.classList.remove('is-loading');
    show($('login-screen'), false);
    show($('admin-app'), true);

    $('admin-user').textContent = session.user;
    show($('default-password-warning'), session.usingDefaultPassword === true);

    var minutes = Math.round((session.idleTimeoutMs || 0) / 60000);
    $('session-note').textContent = minutes
      ? 'A munkamenet ' + minutes + ' perc tétlenség után magától lezárul.'
      : '';

    route();
  }

  function initLogin() {
    var form = $('login-form');
    var submit = $('login-submit');

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var username = $('login-username').value.trim();
      var password = $('login-password').value;
      if (!username || !password) {
        var err = $('login-error');
        err.textContent = 'Adja meg a felhasználónevet és a jelszót.';
        show(err, true);
        return;
      }

      submit.disabled = true;
      submit.textContent = 'Belépés…';

      api('/api/admin/login', {
        method: 'POST',
        json: { username: username, password: password },
        allowUnauthorised: true
      }).then(function (data) {
        $('login-password').value = '';
        show($('login-error'), false);
        showAdmin(data);
      }).catch(function (error) {
        var err = $('login-error');
        err.textContent = error.message || 'A belépés nem sikerült.';
        show(err, true);
        $('login-password').select();
      }).finally(function () {
        submit.disabled = false;
        submit.textContent = 'Belépés';
      });
    });

    bindReveal($('login-reveal'), $('login-password'));
  }

  function bindReveal(button, input) {
    if (!button || !input) return;
    button.addEventListener('click', function () {
      var revealed = input.type === 'text';
      input.type = revealed ? 'password' : 'text';
      button.textContent = revealed ? 'Mutat' : 'Rejt';
      button.setAttribute('aria-pressed', revealed ? 'false' : 'true');
      button.setAttribute('aria-label', revealed ? 'Jelszó megjelenítése' : 'Jelszó elrejtése');
    });
  }

  /* ══════════════════ TERÜLETVÁLASZTÓ ══════════════════
     A választás a címsorban is látszik (`#optika`, `#masszazs`), így a
     böngésző vissza gombja és a lap újratöltése is oda visz, ahol a
     felhasználó éppen járt. */

  /**
   * Szerkesztőfelület bejelentkeztetése a váznál.
   * @param {string} id a `#hash` és a `section-<id>` elem azonosítója
   * @param {{title: string, shortTitle?: string, mount?: Function, unmount?: Function, isDirty?: Function}} config
   */
  function register(id, config) {
    if (!sections[id]) sectionOrder.push(id);
    sections[id] = config;
  }

  function currentHash() {
    var hash = String(location.hash || '').replace(/^#/, '');
    return Object.prototype.hasOwnProperty.call(sections, hash) ? hash : '';
  }

  function route() {
    if (!state.csrf) return;

    var target = currentHash();
    if (state.section === target) return;

    /* A kilépő szekció elköszönhet (pl. leállíthat egy időzítőt). */
    var leaving = state.section && sections[state.section];
    if (leaving && leaving.unmount) leaving.unmount();

    state.section = target;

    sectionOrder.forEach(function (id) {
      show($('section-' + id), id === target);
    });
    show($('chooser'), !target);

    var back = $('section-back');
    var areaLabel = $('admin-area');

    if (!target) {
      if (areaLabel) areaLabel.textContent = '';
      show(back, false);
      document.title = 'Manula-Optic Med. — Adminisztráció';
      window.scrollTo(0, 0);
      return;
    }

    var section = sections[target];
    if (areaLabel) areaLabel.textContent = section.shortTitle || section.title;
    show(back, true);
    document.title = section.title + ' — Adminisztráció';
    window.scrollTo(0, 0);

    if (section.mount) {
      try {
        section.mount();
      } catch (error) {
        /* Egy szekció hibája ne vigye magával az egész felületet. */
        console.error(error);
        toast('A szerkesztő betöltése nem sikerült.', 'error');
      }
    }
  }

  function goTo(id) {
    var next = id ? '#' + id : '';
    if (location.hash === next || (!id && !location.hash)) route();
    else if (!id) {
      /* Üres hash: a `location.hash = ''` a régi böngészőkben otthagyná a
         `#`-et, ezért inkább a történetbe írjuk. */
      history.pushState(null, '', location.pathname + location.search);
      route();
    } else {
      location.hash = next;
    }
  }

  /* ══════════════════ JELSZÓCSERE ══════════════════ */
  function initPassword() {
    var dialog = $('password-dialog');
    var form = $('password-form');
    var newInput = $('p-new');

    function open() {
      form.reset();
      show($('password-error'), false);
      updatePasswordRules();
      dialog.showModal();
      setTimeout(function () { $('p-current').focus(); }, 60);
    }

    $('password-btn').addEventListener('click', open);
    $('warning-change-btn').addEventListener('click', open);
    $('password-close').addEventListener('click', function () { dialog.close(); });
    $('password-cancel').addEventListener('click', function () { dialog.close(); });

    bindReveal($('p-reveal'), newInput);
    newInput.addEventListener('input', updatePasswordRules);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var error = $('password-error');

      if (newInput.value !== $('p-confirm').value) {
        error.textContent = 'A két új jelszó nem egyezik.';
        show(error, true);
        return;
      }

      api('/api/admin/password', {
        method: 'POST',
        json: {
          currentPassword: $('p-current').value,
          newPassword: newInput.value,
          newUsername: $('p-username').value.trim()
        }
      }).then(function () {
        form.reset();
        dialog.close();
        /* A kiszolgáló minden munkamenetet lezárt — a felület is visszaáll. */
        showLogin('A jelszó megváltozott. Jelentkezzen be az új adatokkal.');
        toast('A belépési adatok frissítve.', 'success');
      }).catch(function (err) {
        if (err.message === 'unauthorised') return;
        error.textContent = err.message;
        show(error, true);
      });
    });
  }

  function updatePasswordRules() {
    var value = $('p-new').value;
    var rules = {
      length: value.length >= 12,
      lower: /[a-záéíóöőúüű]/.test(value),
      upper: /[A-ZÁÉÍÓÖŐÚÜŰ]/.test(value),
      digit: /[0-9]/.test(value)
    };
    Array.prototype.forEach.call($('password-rules').children, function (item) {
      item.classList.toggle('is-met', rules[item.getAttribute('data-rule')] === true);
    });
  }

  /* ══════════════════ INDULÁS ══════════════════ */
  function initShell() {
    $('logout-btn').addEventListener('click', function () {
      api('/api/admin/logout', { method: 'POST', allowUnauthorised: true })
        .catch(function () { /* kilépéskor a hiba is kilépés */ })
        .finally(function () { showLogin('Kijelentkezett.'); });
    });

    $('section-back').addEventListener('click', function () { goTo(''); });
    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', route);

    $('confirm-ok').addEventListener('click', function () { closeConfirm(true); });
    $('confirm-cancel').addEventListener('click', function () { closeConfirm(false); });
    $('confirm-dialog').addEventListener('cancel', function () { closeConfirm(false); });
    $('confirm-dialog').addEventListener('close', function () { closeConfirm(false); });

    /* A lapra ejtett fájl alapból megnyílna a böngészőben, és elhagynánk a
       szerkesztőt — a nem mentett munkával együtt. */
    window.addEventListener('dragover', function (event) { event.preventDefault(); });
    window.addEventListener('drop', function (event) { event.preventDefault(); });

    /* Nem mentett munka és lapelhagyás. A böngésző saját szövegét mutatja;
       a `returnValue` beállítása az, ami előhozza a kérdést. */
    window.addEventListener('beforeunload', function (event) {
      var section = state.section && sections[state.section];
      if (section && section.isDirty && section.isDirty()) {
        event.preventDefault();
        event.returnValue = '';
      }
    });

    initPassword();
  }

  /* Először megkérdezzük a kiszolgálót, van-e élő munkamenet. Amíg nem
     válaszol, egyik nézet sem látszik: így nem villan fel a bejelentkezés
     annak, aki már be van jelentkezve. */
  function start() {
    initLogin();
    initShell();

    fetch('/api/admin/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (data && data.ok && data.authenticated) showAdmin(data);
        else showLogin(null);
      })
      .catch(function () {
        showLogin('A kiszolgáló nem elérhető. Fut a szerver?');
      });
  }

  global.Admin = {
    $: $, el: el, show: show,
    api: api, toast: toast, confirm: confirmAction, reportError: reportError,
    register: register, goTo: goTo
  };

  /* A szekciófájlok a vázra épülnek, ezért ŐK töltődnek be utána, és a
     `register` hívásaik már megvannak, mire ez lefut. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    setTimeout(start, 0);
  }
})(window);
