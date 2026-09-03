/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN — SALVIA GYÓGYMASSZÁZS: ÁRAK
   ─────────────────────────────────────────────────────────────────────────
   A weboldal „Áraink” táblázatának szerkesztője. A vázhoz (`app.js`) az
   `Admin.register` hívással csatlakozik.

   MIÉRT NEM TÁBLÁZAT A SZERKESZTŐ. Az árlista 10 kezelés × 6 hossz = 60 mező.
   Táblázatba rendezve telefonon apró beviteli mezők sora lenne, oldalra
   görgetve, ahol a sor eleje kicsúszik a képből — épp ott, ahol tudni kéne,
   melyik kezelésnél tartunk. Ezért kezelésenként egy KÁRTYA: a kártya
   fejlécében a kezelés neve, benne a hosszak rácsban, mindegyik a saját
   címkéjével. Széles kijelzőn a rács egy sorba rendeződik, keskenyen kettesével
   tördel — a név pedig mindig látszik.

   AZ ÜRES MEZŐ JELENTÉSE. Nincs külön „elérhető” kapcsoló: ami üres, az a
   táblázatban „—”, és a foglalási űrlapon sem választható. Egy dolog, egy
   hely — nem lehet elrontani úgy, hogy a kapcsoló bekapcsolva marad egy
   üres ár mellett.

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
    /* A kiszolgálótól kapott, MENTETT állapot — ehhez tér vissza az elvetés. */
    saved: null,
    /* A szerkesztés alatti másolat. */
    draft: null,
    dirty: false,
    loaded: false,
    saving: false
  };

  var LIMITS = { durations: 10, treatments: 30, notes: 10, note: 320, name: 80 };

  /* ── Formázás ───────────────────────────────────────────────────────────
     „8900” → „8 900 Ft”. A hármas csoportok között nem törhető szóköz áll,
     hogy az összeg soha ne szakadjon két sorba. Ugyanez a szabály fut a
     nyilvános oldalon is (`masszazs/assets/js/main.js`). */
  function formatFt(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ft';
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /* ── Betöltés ──────────────────────────────────────────────────────────── */
  function load() {
    return api('/api/admin/prices').then(function (data) {
      if (data.limits) {
        LIMITS.durations = data.limits.durations || LIMITS.durations;
        LIMITS.notes = data.limits.notes || LIMITS.notes;
        LIMITS.note = data.limits.note || LIMITS.note;
        LIMITS.name = data.limits.name || LIMITS.name;
      }
      state.saved = {
        durations: data.durations,
        treatments: data.treatments,
        notes: data.notes,
        updatedAt: data.updatedAt
      };
      state.draft = clone(state.saved);
      state.dirty = false;
      state.loaded = true;
      renderAll();
    }).catch(Admin.reportError);
  }

  function markDirty() {
    state.dirty = true;
    updateStatus();
  }

  function updateStatus() {
    var status = $('prices-status');
    var bar = $('prices-save-bar');

    if (state.dirty) {
      status.textContent = 'Nem mentett módosítások.';
      status.className = 'prices-status is-dirty';
      show(bar, true);
    } else {
      var when = state.saved && state.saved.updatedAt;
      status.textContent = when
        ? 'Mentve: ' + formatDate(when)
        : 'Minden módosítás mentve.';
      status.className = 'prices-status';
      show(bar, false);
    }

    $('prices-reset').disabled = !state.dirty || state.saving;
    $('prices-save').disabled = !state.dirty || state.saving;
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleString('hu-HU', {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (error) {
      return iso;
    }
  }

  /* ── Időtartam-oszlopok ─────────────────────────────────────────────────
     Az időtartamok a táblázat oszlopai. Eltávolításuk a hozzájuk tartozó
     összegeket is elviszi, ezért rákérdezünk — de csak akkor, ha van mit
     elveszíteni. */
  function renderDurations() {
    var box = $('duration-chips');
    box.textContent = '';

    state.draft.durations.forEach(function (min) {
      var chip = el('span', 'duration-chip');
      chip.appendChild(el('span', 'duration-chip-label', min + ' perc'));

      var used = state.draft.treatments.filter(function (t) {
        return t.prices[min] != null;
      }).length;
      chip.appendChild(el('span', 'duration-chip-count',
        used ? used + ' árral' : 'nincs ár'));

      var remove = el('button', 'duration-chip-remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', min + ' perces oszlop eltávolítása');
      remove.addEventListener('click', function () { removeDuration(min, used); });
      chip.appendChild(remove);

      box.appendChild(chip);
    });

    if (!state.draft.durations.length) {
      box.appendChild(el('p', 'field-hint', 'Nincs egyetlen időtartam sem — adjon hozzá legalább egyet.'));
    }
  }

  function removeDuration(min, used) {
    var apply = function () {
      state.draft.durations = state.draft.durations.filter(function (d) { return d !== min; });
      state.draft.treatments.forEach(function (t) { delete t.prices[min]; });
      markDirty();
      renderAll();
    };

    if (!used) { apply(); return; }

    Admin.confirm(
      min + ' perces oszlop eltávolítása',
      'Ehhez az oszlophoz ' + used + ' kezelésnél tartozik ár. Az eltávolítással ezek az '
      + 'összegek elvesznek, és a ' + min + ' perces hossz a foglalási űrlapon sem lesz '
      + 'választható. A mentésig még visszavonható.',
      'Eltávolítom'
    ).then(function (confirmed) { if (confirmed) apply(); });
  }

  function addDuration(event) {
    event.preventDefault();
    var input = $('duration-new');
    var value = parseInt(input.value, 10);

    if (!Number.isInteger(value) || value < 5 || value > 300) {
      toast('Az időtartam 5 és 300 perc között lehet.', 'error');
      input.focus();
      return;
    }
    if (state.draft.durations.indexOf(value) !== -1) {
      toast('Ez az időtartam már szerepel.', 'error');
      input.focus();
      return;
    }
    if (state.draft.durations.length >= LIMITS.durations) {
      toast('Legfeljebb ' + LIMITS.durations + ' időtartam adható meg.', 'error');
      return;
    }

    state.draft.durations.push(value);
    state.draft.durations.sort(function (a, b) { return a - b; });
    state.draft.treatments.forEach(function (t) { t.prices[value] = null; });

    input.value = '';
    markDirty();
    renderAll();
    toast(value + ' perces oszlop hozzáadva. Töltse ki, ahol kérhető.', 'success');
  }

  /* ── Kezeléskártyák ────────────────────────────────────────────────────── */
  function renderTreatments() {
    var box = $('price-cards');
    box.textContent = '';

    state.draft.treatments.forEach(function (treatment, index) {
      box.appendChild(treatmentCard(treatment, index));
    });
  }

  function treatmentCard(treatment, index) {
    var card = el('section', 'price-card');

    /* ── Fejléc: név és csillag ── */
    var head = el('div', 'price-card-head');

    var nameField = el('div', 'price-card-name');
    var nameLabel = el('label', 'field-label', 'A táblázatban megjelenő név');
    nameLabel.htmlFor = 'tname-' + index;
    nameField.appendChild(nameLabel);

    var nameInput = el('input', 'field-input');
    nameInput.type = 'text';
    nameInput.id = 'tname-' + index;
    nameInput.maxLength = LIMITS.name;
    nameInput.value = treatment.name;
    nameInput.addEventListener('input', function () {
      treatment.name = nameInput.value;
      markDirty();
      renderPreview();
    });
    nameField.appendChild(nameInput);
    head.appendChild(nameField);

    /* Csillag: a táblázat alatti lábjegyzethez köti a sort. */
    var markLabel = el('label', 'checkbox');
    var markInput = el('input');
    markInput.type = 'checkbox';
    markInput.checked = treatment.footnote === true;
    markInput.addEventListener('change', function () {
      treatment.footnote = markInput.checked;
      markDirty();
      renderPreview();
    });
    markLabel.appendChild(markInput);
    markLabel.appendChild(el('span', 'checkbox-box'));
    markLabel.appendChild(el('span', 'checkbox-text', 'Csillag (*) a név után'));
    head.appendChild(markLabel);

    card.appendChild(head);

    /* ── Árak hosszanként ── */
    var grid = el('div', 'price-grid');

    state.draft.durations.forEach(function (min) {
      var cell = el('div', 'price-cell');

      var label = el('label', 'price-cell-label', min + ' perc');
      label.htmlFor = 'p-' + index + '-' + min;
      cell.appendChild(label);

      var wrap = el('div', 'price-input-wrap');
      var input = el('input', 'field-input price-input');
      input.type = 'number';
      input.id = 'p-' + index + '-' + min;
      input.min = '0';
      input.step = '100';
      input.inputMode = 'numeric';
      input.placeholder = '—';
      input.value = treatment.prices[min] == null ? '' : String(treatment.prices[min]);
      input.setAttribute('aria-label', treatment.name + ', ' + min + ' perc ára forintban');

      input.addEventListener('input', function () {
        var raw = input.value.trim();
        if (raw === '') {
          treatment.prices[min] = null;
        } else {
          var n = Math.round(Number(raw));
          treatment.prices[min] = (Number.isFinite(n) && n > 0) ? n : null;
        }
        cell.classList.toggle('is-empty', treatment.prices[min] == null);
        markDirty();
        renderPreview();
      });

      wrap.appendChild(input);
      wrap.appendChild(el('span', 'price-suffix', 'Ft'));
      cell.appendChild(wrap);

      if (treatment.prices[min] == null) cell.classList.add('is-empty');
      cell.appendChild(el('span', 'price-cell-hint', 'üres = nem kérhető'));

      grid.appendChild(cell);
    });

    card.appendChild(grid);
    return card;
  }

  /* ── Megjegyzések ──────────────────────────────────────────────────────── */
  function renderNotes() {
    var list = $('notes-list');
    list.textContent = '';
    state.draft.notes.forEach(function (note, index) {
      list.appendChild(noteRow(note, index));
    });
    $('add-note').disabled = state.draft.notes.length >= LIMITS.notes;
  }

  function noteRow(note, index) {
    var row = el('div', 'repeat-row note-row');

    var markLabel = el('label', 'checkbox checkbox--tight');
    var markInput = el('input');
    markInput.type = 'checkbox';
    markInput.checked = note.mark === true;
    markInput.setAttribute('aria-label', (index + 1) + '. megjegyzés csillaggal kezdődjön');
    markInput.addEventListener('change', function () {
      note.mark = markInput.checked;
      markDirty();
      renderPreview();
    });
    markLabel.appendChild(markInput);
    markLabel.appendChild(el('span', 'checkbox-box'));
    markLabel.appendChild(el('span', 'checkbox-text', '*'));
    row.appendChild(markLabel);

    var inputs = el('div', 'repeat-inputs');
    var input = el('textarea', 'field-input note-input');
    input.rows = 2;
    input.maxLength = LIMITS.note;
    input.value = note.text;
    input.setAttribute('aria-label', (index + 1) + '. megjegyzés szövege');
    input.addEventListener('input', function () {
      note.text = input.value;
      markDirty();
      renderPreview();
    });
    inputs.appendChild(input);
    row.appendChild(inputs);

    var remove = el('button', 'repeat-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', (index + 1) + '. megjegyzés törlése');
    remove.addEventListener('click', function () {
      state.draft.notes.splice(index, 1);
      markDirty();
      renderNotes();
      renderPreview();
    });
    row.appendChild(remove);

    return row;
  }

  /* ── Előnézet ───────────────────────────────────────────────────────────
     Ugyanaz a szerkezet és ugyanaz a stíluslap, mint a weboldalon
     (`masszazs/assets/css/prices.css`) — így nem hasonlít a végeredményre,
     hanem az. */
  function renderPreview() {
    var table = $('price-preview');
    var thead = table.tHead;
    var tbody = table.tBodies[0];

    thead.textContent = '';
    var headRow = el('tr');
    var nameHead = el('th', 'price-table__name', 'Kezelés');
    nameHead.scope = 'col';
    headRow.appendChild(nameHead);

    state.draft.durations.forEach(function (min) {
      var th = el('th', null, min + ' perc');
      th.scope = 'col';
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    tbody.textContent = '';
    state.draft.treatments.forEach(function (treatment) {
      var tr = el('tr');

      var rowHead = el('th');
      rowHead.scope = 'row';
      var label = el('span', null, treatment.name || '(névtelen)');
      if (treatment.footnote) {
        label.appendChild(el('span', 'price-table__mark', '*'));
      }
      rowHead.appendChild(label);
      tr.appendChild(rowHead);

      state.draft.durations.forEach(function (min) {
        var value = treatment.prices[min];
        var td = el('td');
        if (value == null) {
          td.className = 'na';
          td.setAttribute('aria-label', 'nem elérhető');
          td.textContent = '—';
        } else {
          td.textContent = formatFt(value);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    var notes = $('price-preview-notes');
    notes.textContent = '';
    state.draft.notes.forEach(function (note) {
      if (!note.text.trim()) return;
      var li = el('li');
      if (note.mark) {
        li.appendChild(el('span', 'price-table__mark', '*'));
        li.appendChild(document.createTextNode(' '));
      }
      li.appendChild(document.createTextNode(note.text));
      notes.appendChild(li);
    });
    notes.hidden = notes.childNodes.length === 0;
  }

  function renderAll() {
    renderDurations();
    renderTreatments();
    renderNotes();
    renderPreview();
    updateStatus();
  }

  /* ── Mentés és elvetés ─────────────────────────────────────────────────── */
  function save() {
    if (!state.dirty || state.saving) return;

    /* Az üres nevű sor a kiszolgálón amúgy is kiesne — jobb itt szólni,
       mint mentés után szembesülni egy eltűnt sorral. */
    var nameless = state.draft.treatments.filter(function (t) {
      return t.name.trim().length < 2;
    });
    if (nameless.length) {
      showError('Minden kezelésnek kell név (legalább 2 karakter). Ellenőrizze a kiemelt mezőt.');
      return;
    }
    if (!state.draft.durations.length) {
      showError('Legalább egy időtartam kell.');
      return;
    }

    hideError();
    state.saving = true;
    setSaveButtons(true);

    api('/api/admin/prices', {
      method: 'PUT',
      json: {
        prices: {
          durations: state.draft.durations,
          treatments: state.draft.treatments,
          notes: state.draft.notes
        }
      }
    }).then(function (data) {
      state.saved = {
        durations: data.durations,
        treatments: data.treatments,
        notes: data.notes,
        updatedAt: data.updatedAt
      };
      /* A kiszolgáló válaszát vesszük igaznak: ő tisztította a szöveget és
         kerekítette az összegeket, tehát az ő változata a mentett állapot. */
      state.draft = clone(state.saved);
      state.dirty = false;
      renderAll();
      toast('Az árlista mentve. A weboldalon már ez látszik.', 'success');
    }).catch(function (error) {
      if (error.message === 'unauthorised') return;
      showError(error.message);
    }).finally(function () {
      state.saving = false;
      setSaveButtons(false);
      updateStatus();
    });
  }

  function setSaveButtons(busy) {
    ['prices-save', 'prices-save-sticky'].forEach(function (id) {
      var button = $(id);
      if (!button) return;
      button.disabled = busy;
      button.textContent = busy ? 'Mentés…' : 'Mentés';
    });
  }

  function reset() {
    if (!state.dirty) return;
    Admin.confirm(
      'Módosítások elvetése',
      'A legutóbbi mentés óta tett változtatások elvesznek, és visszaáll a mentett árlista.',
      'Elvetem'
    ).then(function (confirmed) {
      if (!confirmed) return;
      state.draft = clone(state.saved);
      state.dirty = false;
      hideError();
      renderAll();
      toast('A mentett árlista visszaállt.', 'info');
    });
  }

  function showError(message) {
    var box = $('prices-error');
    box.textContent = message;
    show(box, true);
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function hideError() { show($('prices-error'), false); }

  /* ══════════════════ BEKÖTÉS ══════════════════
     Egyszer fut le, az első belépéskor a területre. */
  var wired = false;

  function wire() {
    if (wired) return;
    wired = true;

    $('prices-save').addEventListener('click', save);
    $('prices-save-sticky').addEventListener('click', save);
    $('prices-reset').addEventListener('click', reset);
    $('prices-reset-sticky').addEventListener('click', reset);

    $('duration-add-form').addEventListener('submit', addDuration);

    $('add-note').addEventListener('click', function () {
      if (state.draft.notes.length >= LIMITS.notes) return;
      state.draft.notes.push({ mark: false, text: '' });
      markDirty();
      renderNotes();
      var rows = $('notes-list').querySelectorAll('textarea');
      if (rows.length) rows[rows.length - 1].focus();
    });

    /* Ctrl/Cmd + S: a hosszú listán ez a leggyorsabb mentés. */
    $('section-masszazs').addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      }
    });
  }

  /* ══════════════════ BEJELENTKEZÉS A VÁZNÁL ══════════════════ */
  Admin.register('masszazs', {
    title: 'Salvia Gyógymasszázs — Áraink',
    shortTitle: 'Salvia Gyógymasszázs',
    mount: function () {
      wire();
      /* Nem mentett munkával visszatérve azt tartjuk meg — a felhasználó nem
         veszít adatot attól, hogy közben átnézte a másik területet. */
      if (state.dirty && state.loaded) { renderAll(); return; }
      load();
    },
    isDirty: function () { return state.dirty; }
  });
})();
