/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN — FOGLALÁS FELVÉTELE (telefonos vendég)
   ─────────────────────────────────────────────────────────────────────────
   A naptár csak akkor mond igazat, ha a telefonon egyeztetett időpontok is
   benne vannak. Enélkül a weboldal ugyanazt a sávot még egyszer felkínálná,
   és két vendég érkezne ugyanarra az órára.

   ADMINKÉNT A NYITVATARTÁS NEM KORLÁT: ha valakit kivételesen zárás után
   fogadunk, azt is fel lehet venni. Az ÜTKÖZÉS viszont igen — két embert a
   kiszolgáló akkor sem enged egymásra tenni. A szabad kezdéseket segítségként
   kiírjuk a kezdés mezője alatt.
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var $ = Admin.$;
  var show = Admin.show;

  var current = null;   /* { site, services, onSaved } */
  var wired = false;
  var hintRequest = 0;

  function dialog() { return $('new-booking-dialog'); }

  function setError(message) {
    var box = $('new-booking-error');
    if (!box) return;
    box.textContent = message || '';
    show(box, !!message);
  }

  /** A választott szolgáltatás hosszai. */
  function fillDurations() {
    var select = $('nb-duration');
    var key = $('nb-service').value;
    var service = (current.services || []).filter(function (item) { return item.key === key; })[0];

    select.textContent = '';
    if (!service) return;
    service.durations.forEach(function (minutes) {
      var option = document.createElement('option');
      option.value = String(minutes);
      option.textContent = minutes + ' perc';
      select.appendChild(option);
    });
    refreshHint();
  }

  /* A szabad kezdések a kezdés mező alatt. Csak segítség: a kiszolgáló
     adminként ennél tágabban is elfogad időpontot. */
  function refreshHint() {
    var hint = $('nb-slot-hint');
    if (!hint) return;

    var date = $('nb-date').value;
    var duration = parseInt($('nb-duration').value, 10);
    if (!date || !isFinite(duration)) { hint.textContent = ''; return; }

    hint.textContent = 'Szabad kezdések keresése…';
    var token = ++hintRequest;

    fetch('/api/booking/availability?site=' + current.site + '&date=' + encodeURIComponent(date) +
      '&duration=' + duration, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (token !== hintRequest) return;
        if (!data || !data.ok) { hint.textContent = ''; return; }
        if (data.closed) { hint.textContent = data.reason; return; }
        hint.textContent = data.slots.length
          ? 'Szabad kezdések: ' + data.slots.join(', ')
          : 'Erre a napra ilyen hosszban nincs szabad kezdés.';
      })
      .catch(function () {
        if (token !== hintRequest) return;
        hint.textContent = '';
      });
  }

  function wire() {
    if (wired) return;
    wired = true;

    $('new-booking-close').addEventListener('click', function () { dialog().close(); });
    $('new-booking-cancel').addEventListener('click', function () { dialog().close(); });
    $('nb-service').addEventListener('change', fillDurations);
    $('nb-duration').addEventListener('change', refreshHint);
    $('nb-date').addEventListener('change', refreshHint);

    $('new-booking-form').addEventListener('submit', function (event) {
      event.preventDefault();
      submit();
    });
  }

  function submit() {
    var payload = {
      site: current.site,
      serviceKey: $('nb-service').value,
      duration: parseInt($('nb-duration').value, 10),
      date: $('nb-date').value,
      start: $('nb-start').value,
      name: $('nb-name').value.trim(),
      phone: $('nb-phone').value.trim(),
      email: $('nb-email').value.trim(),
      message: $('nb-message').value.trim()
    };

    if (!payload.serviceKey || !isFinite(payload.duration)) {
      setError('Válassza ki a szolgáltatást és a hosszát.'); return;
    }
    if (!payload.date || !payload.start) {
      setError('A nap és a kezdés megadása kötelező.'); return;
    }
    if (payload.name.length < 2) { setError('Adja meg a vendég nevét.'); return; }
    if (payload.phone.replace(/\D/g, '').length < 7) {
      setError('Adjon meg egy telefonszámot — enélkül nem lehet elérni a vendéget.'); return;
    }

    setError('');
    var submitBtn = $('new-booking-form').querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Felvétel…';

    Admin.api('/api/admin/bookings', { method: 'POST', json: payload })
      .then(function (data) {
        dialog().close();
        if (current.onSaved) current.onSaved(data.booking);
      })
      .catch(function (error) {
        if (error && error.message === 'unauthorised') return;
        setError(error.message || 'A foglalást nem sikerült felvenni.');
      })
      .then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Felvétel a naptárba';
      });
  }

  global.AdminBookingForm = {
    /**
     * @param {{site: string, date: string, services: Array, onSaved: Function}} options
     */
    open: function (options) {
      current = options;
      wire();

      var form = $('new-booking-form');
      form.reset();
      setError('');
      $('nb-slot-hint').textContent = '';

      var select = $('nb-service');
      select.textContent = '';
      (options.services || []).forEach(function (service) {
        var option = document.createElement('option');
        option.value = service.key;
        option.textContent = service.name;
        select.appendChild(option);
      });

      $('nb-date').value = options.date;
      fillDurations();

      dialog().showModal();
      setTimeout(function () { $('nb-start').focus(); }, 60);
    }
  };
})(window);

/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN — NAPTÁR (mindkét terület tetején)
   ─────────────────────────────────────────────────────────────────────────
   A masszázs és az optika szerkesztőfelülete fölött ugyanez a naptár ül, két
   külön példányban: mindkettő a SAJÁT területének foglalásait mutatja.

   NÉGY NÉZET, egy modul:

     Ma      — a nap menetrendje percre pontosan, a vendégek adataival.
               Ide tartozik a foglalás felvétele (telefonos vendég) és a
               lemondás is.
     Hét     — hét oszlop, naponként a foglalások rövid listája. Egy kattintás
               a nap fejlécére átvisz a napi nézetre.
     Hónap   — sima naptárrács a napi darabszámmal. Napra kattintva a napi
               menetrend nyílik meg. Külön kapcsolóval ugyanitt jelölhetők ki
               a SZABADNAPOK (elutazás, ünnep).
     Nyitva  — nyitvatartás naponként, a pihenő hossza, az állandó szünetek
               (ebéd, uzsonna) és a szabadnapok listája.

   MIÉRT JS-BŐL ÉPÜL A FELÜLET. A naptár két helyen jelenik meg, azonos
   szerkezettel. HTML-ben ez két, kézzel szinkronban tartott másolat lenne,
   egyedi azonosítókkal — az első eltérés után némán elcsúsznának. Így viszont
   egy `<div class="cal-mount" data-site="…">` elég a lapon, a többit ez a
   fájl rajzolja meg, példányonként saját állapottal.

   A vázzal (`app.js`) az `admin:section` eseményen keresztül tartja a
   kapcsolatot: a naptár nem szerkesztője egyik területnek sem, csak kísérője.

   Megjelenítés kizárólag `textContent`-tel és `createElement`-tel — soha
   `innerHTML`-lel. Lásd az `app.js` fejlécében a két alapszabályt.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var api = Admin.api;
  var toast = Admin.toast;

  var SITE_NAMES = { masszazs: 'Salvia Gyógymasszázs', optika: 'Lumina Optika' };

  var DAY_NAMES = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
  var DAY_SHORT = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];
  /* A magyar naptár hétfővel kezdődik; ez a sorrend a rácsé és a beállításoké. */
  var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  var MONTHS = ['január', 'február', 'március', 'április', 'május', 'június',
    'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
  /* Nem az első három betű: a „sze.” a szerdával, a „már.” a márciussal
     keveredne. A magyar helyesírás szerinti rövidítések. */
  var MONTHS_SHORT = ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.',
    'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];

  /* ── Apró építőelemek ─────────────────────────────────────────────────── */
  function h(tag, className, textValue) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue != null && textValue !== '') node.textContent = textValue;
    return node;
  }

  function button(className, label, onClick) {
    var node = h('button', className, label);
    node.type = 'button';
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  function field(labelText, input) {
    var wrap = h('label', 'cal-field');
    wrap.appendChild(h('span', 'cal-field-label', labelText));
    wrap.appendChild(input);
    return wrap;
  }

  /* A `field-input` a szöveges mezők stílusa (keret, kitöltés, teljes
     szélesség). Jelölőnégyzetre ez nem illik — az saját méretet kap a CSS-ben. */
  function input(type, value, className) {
    var node = document.createElement('input');
    node.type = type;
    var css = className !== undefined ? className : (type === 'checkbox' ? '' : 'field-input');
    if (css) node.className = css;
    if (value != null) node.value = value;
    return node;
  }

  /* ── Dátumszámolás ──────────────────────────────────────────────────────
     Mindenhol ÉÉÉÉ-HH-NN szöveggel dolgozunk, és UTC-ben számolunk vele: így
     a böngésző időzónája és a nyári időszámítás nem tud egy napot csúsztatni. */
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function todayIso() {
    var now = new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function parseDay(iso) {
    var parts = iso.split('-').map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  }

  function formatDay(date) {
    return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
  }

  function addDays(iso, count) {
    var d = parseDay(iso);
    d.setUTCDate(d.getUTCDate() + count);
    return formatDay(d);
  }

  function weekdayOf(iso) { return parseDay(iso).getUTCDay(); }

  /** A hét hétfője. */
  function mondayOf(iso) {
    var day = weekdayOf(iso);
    return addDays(iso, day === 0 ? -6 : 1 - day);
  }

  function monthOf(iso) { return iso.slice(0, 7); }

  function longDate(iso) {
    var d = parseDay(iso);
    return d.getUTCFullYear() + '. ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + '., ' +
      DAY_NAMES[d.getUTCDay()];
  }

  function shortDate(iso) {
    var d = parseDay(iso);
    return MONTHS_SHORT[d.getUTCMonth()] + ' ' + d.getUTCDate() + '.';
  }

  function monthTitle(month) {
    var parts = month.split('-').map(Number);
    return parts[0] + '. ' + MONTHS[parts[1] - 1];
  }

  function clockToMinutes(clock) {
    var parts = String(clock || '').split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }

  function minutesToClock(minutes) {
    return pad(Math.floor(minutes / 60) % 24) + ':' + pad(minutes % 60);
  }

  /* ══════════════════════════════════════════════════════════════════════
     EGY NAPTÁRPÉLDÁNY
     ══════════════════════════════════════════════════════════════════ */
  function createCalendar(root, site) {
    var state = {
      view: 'day',
      /* A megjelenített nap; a heti és a havi nézet is ehhez igazodik. */
      day: todayIso(),
      month: monthOf(todayIso()),
      /* Szabadnap-kijelölő mód a havi nézetben. */
      marking: false,
      schedule: null,
      services: [],
      draft: null,       /* a beállítások szerkesztés alatti másolata */
      dirty: false,
      loading: false
    };

    var body = null;      /* a nézetek konténere */
    var tabs = {};

    /* ── Váz ─────────────────────────────────────────────────────────── */
    function build() {
      root.textContent = '';
      root.classList.add('cal');

      var head = h('div', 'cal-head');
      var titles = h('div');
      titles.appendChild(h('h1', 'cal-title', 'Naptár'));
      titles.appendChild(h('p', 'cal-sub',
        SITE_NAMES[site] + ' — foglalások, szabadnapok és szünetek. Amit itt lát, ' +
        'azt látja a weboldal foglalója is: ami el van foglalva, azt nem kínálja fel.'));
      head.appendChild(titles);

      var actions = h('div', 'cal-head-actions');
      actions.appendChild(button('btn btn-primary btn-sm', '+ Foglalás felvétele', function () {
        openNewBooking(state.day);
      }));
      head.appendChild(actions);
      root.appendChild(head);

      var nav = h('nav', 'cal-tabs');
      nav.setAttribute('role', 'tablist');
      [
        ['day', 'Mai nap'],
        ['week', 'Ez a hét'],
        ['month', 'Hónap'],
        ['settings', 'Nyitvatartás']
      ].forEach(function (pair) {
        var tab = button('cal-tab', pair[1], function () { switchView(pair[0]); });
        tab.setAttribute('role', 'tab');
        tabs[pair[0]] = tab;
        nav.appendChild(tab);
      });
      root.appendChild(nav);

      body = h('div', 'cal-body');
      root.appendChild(body);
    }

    function switchView(view) {
      if (state.view === view) return;
      if (state.view === 'settings' && state.dirty && view !== 'settings') {
        Admin.confirm(
          'Nem mentett nyitvatartás',
          'A nyitvatartáson végzett módosításai elvesznek, ha most átvált egy másik nézetre.',
          'Elvetem'
        ).then(function (confirmed) {
          if (!confirmed) return;
          state.dirty = false;
          state.draft = null;
          state.view = view;
          render();
        });
        return;
      }
      state.view = view;
      render();
    }

    function markTabs() {
      Object.keys(tabs).forEach(function (key) {
        var active = key === state.view;
        tabs[key].classList.toggle('is-active', active);
        tabs[key].setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    function setBusy(message) {
      body.textContent = '';
      body.appendChild(h('p', 'cal-empty', message || 'Betöltés…'));
    }

    /* ── Betöltés ────────────────────────────────────────────────────── */
    function loadSchedule() {
      return api('/api/admin/schedule?site=' + site).then(function (data) {
        state.schedule = data.schedule;
        state.services = data.services || [];
        state.optikaServices = data.optikaServices || [];
        return data;
      });
    }

    function render() {
      markTabs();
      if (!state.schedule) {
        setBusy('Naptár betöltése…');
        loadSchedule().then(render).catch(function (error) {
          setBusy('A naptárat nem sikerült betölteni.');
          Admin.reportError(error);
        });
        return;
      }

      if (state.view === 'day') renderDay();
      else if (state.view === 'week') renderWeek();
      else if (state.view === 'month') renderMonth();
      else renderSettings();
    }

    /* ══════════════════ NAPI NÉZET ══════════════════ */
    function renderDay() {
      body.textContent = '';

      var bar = h('div', 'cal-bar');
      bar.appendChild(button('cal-nav', '‹', function () { state.day = addDays(state.day, -1); renderDay(); }));

      var label = h('div', 'cal-bar-label');
      label.appendChild(h('strong', null, longDate(state.day)));
      if (state.day === todayIso()) label.appendChild(h('span', 'cal-badge', 'ma'));
      bar.appendChild(label);

      bar.appendChild(button('cal-nav', '›', function () { state.day = addDays(state.day, 1); renderDay(); }));
      bar.appendChild(button('btn btn-ghost btn-sm', 'Ma', function () {
        state.day = todayIso();
        state.month = monthOf(state.day);
        renderDay();
      }));
      body.appendChild(bar);

      var slot = h('div', 'cal-day-slot');
      body.appendChild(slot);
      slot.appendChild(h('p', 'cal-empty', 'Menetrend betöltése…'));

      api('/api/admin/agenda?site=' + site + '&from=' + state.day + '&to=' + state.day)
        .then(function (data) {
          if (state.view !== 'day') return;
          slot.textContent = '';
          slot.appendChild(dayAgenda(data.days[0], { full: true }));
        })
        .catch(function (error) {
          slot.textContent = '';
          slot.appendChild(h('p', 'cal-empty', 'A menetrendet nem sikerült betölteni.'));
          Admin.reportError(error);
        });
    }

    /**
     * Egy nap menetrendje.
     * @param {object} day a kiszolgáló `agenda` válasza
     * @param {{full?: boolean}} options teljes nézetben a vendég adatai is látszanak
     */
    function dayAgenda(day, options) {
      var opts = options || {};
      var wrap = h('div', 'cal-agenda-wrap');

      var meta = h('p', 'cal-open');
      if (day.closure) {
        meta.classList.add('is-closed');
        meta.textContent = 'Szabadnap — ' + day.closure.label;
      } else if (!day.open) {
        meta.classList.add('is-closed');
        meta.textContent = 'Ezen a napon zárva tartunk.';
      } else {
        meta.textContent = 'Nyitva ' + day.open.from + ' – ' + day.open.to;
      }
      wrap.appendChild(meta);

      var bookings = day.items.filter(function (item) { return item.kind === 'booking'; });

      if (!day.items.length) {
        wrap.appendChild(h('p', 'cal-empty', 'Erre a napra nincs foglalás.'));
        return wrap;
      }

      var list = h('ol', 'cal-agenda');
      day.items.forEach(function (item) {
        list.appendChild(item.kind === 'booking'
          ? bookingRow(item, opts.full)
          : breakRow(item));
      });
      wrap.appendChild(list);

      if (bookings.length) {
        wrap.appendChild(h('p', 'cal-count',
          bookings.length + ' foglalás ezen a napon'));
      }
      return wrap;
    }

    function breakRow(item) {
      var row = h('li', 'cal-item cal-item--break');
      var time = h('span', 'cal-time');
      time.appendChild(h('strong', null, item.from));
      time.appendChild(h('span', null, '– ' + item.to));
      row.appendChild(time);

      var info = h('div', 'cal-info');
      info.appendChild(h('p', 'cal-name', item.label));
      info.appendChild(h('p', 'cal-service', 'Állandó szünet — erre az időre nem lehet foglalni.'));
      row.appendChild(info);
      return row;
    }

    function bookingRow(item, full) {
      var b = item.booking;
      var row = h('li', 'cal-item cal-item--booking');

      var time = h('span', 'cal-time');
      time.appendChild(h('strong', null, item.from));
      time.appendChild(h('span', null, '– ' + item.to));
      row.appendChild(time);

      var info = h('div', 'cal-info');
      info.appendChild(h('p', 'cal-name', b.name));
      info.appendChild(h('p', 'cal-service', b.serviceName + ' · ' + b.duration + ' perc'));

      if (full) {
        var contact = h('p', 'cal-contact');
        if (b.phone) {
          var tel = h('a', null, b.phone);
          tel.href = 'tel:' + b.phone.replace(/\s+/g, '');
          contact.appendChild(tel);
        }
        if (b.email) {
          if (b.phone) contact.appendChild(document.createTextNode(' · '));
          var mail = h('a', null, b.email);
          mail.href = 'mailto:' + b.email;
          contact.appendChild(mail);
        }
        if (b.phone || b.email) info.appendChild(contact);

        if (b.message) info.appendChild(h('p', 'cal-note', b.message));

        var rest = h('p', 'cal-rest', 'Pihenő ' + item.restTo + '-ig' +
          (b.source === 'admin' ? ' · telefonon felvéve' : ''));
        info.appendChild(rest);
      }
      row.appendChild(info);

      if (full) {
        row.appendChild(button('btn btn-ghost btn-sm cal-cancel', 'Lemondás', function () {
          cancelBooking(b);
        }));
      }
      return row;
    }

    function cancelBooking(b) {
      Admin.confirm(
        'Foglalás lemondása',
        b.name + ' — ' + longDate(b.date) + ' ' + b.start + ', ' + b.serviceName + '. ' +
        'A lemondás után az idősáv azonnal újra foglalhatóvá válik a weboldalon. ' +
        'A vendég erről NEM kap automatikus értesítést.',
        'Lemondom'
      ).then(function (confirmed) {
        if (!confirmed) return;
        return api('/api/admin/bookings/' + b.id, { method: 'DELETE' }).then(function () {
          toast('A foglalás lemondva.', 'success');
          render();
        });
      }).catch(Admin.reportError);
    }

    /* ══════════════════ HETI NÉZET ══════════════════ */
    function renderWeek() {
      body.textContent = '';

      var start = mondayOf(state.day);
      var end = addDays(start, 6);

      var bar = h('div', 'cal-bar');
      bar.appendChild(button('cal-nav', '‹', function () {
        state.day = addDays(state.day, -7); renderWeek();
      }));
      var label = h('div', 'cal-bar-label');
      label.appendChild(h('strong', null, shortDate(start) + ' – ' + shortDate(end)));
      bar.appendChild(label);
      bar.appendChild(button('cal-nav', '›', function () {
        state.day = addDays(state.day, 7); renderWeek();
      }));
      bar.appendChild(button('btn btn-ghost btn-sm', 'Ez a hét', function () {
        state.day = todayIso(); renderWeek();
      }));
      body.appendChild(bar);

      var slot = h('div', 'cal-week-slot');
      slot.appendChild(h('p', 'cal-empty', 'A hét betöltése…'));
      body.appendChild(slot);

      api('/api/admin/agenda?site=' + site + '&from=' + start + '&to=' + end)
        .then(function (data) {
          if (state.view !== 'week') return;
          slot.textContent = '';

          var grid = h('div', 'cal-week');
          var total = 0;

          data.days.forEach(function (day) {
            var col = h('div', 'cal-weekday');
            if (day.date === data.today) col.classList.add('is-today');
            if (day.closure || !day.open) col.classList.add('is-closed');

            var head = button('cal-weekday-head', null, function () {
              state.day = day.date;
              switchView('day');
            });
            head.appendChild(h('span', 'cal-weekday-name', DAY_SHORT[weekdayOf(day.date)]));
            head.appendChild(h('span', 'cal-weekday-num', String(parseDay(day.date).getUTCDate())));
            col.appendChild(head);

            var bookings = day.items.filter(function (item) { return item.kind === 'booking'; });
            total += bookings.length;

            if (day.closure) {
              col.appendChild(h('p', 'cal-weekday-note', day.closure.label));
            } else if (!day.open) {
              col.appendChild(h('p', 'cal-weekday-note', 'Zárva'));
            } else if (!bookings.length) {
              col.appendChild(h('p', 'cal-weekday-note', 'Szabad'));
            }

            bookings.forEach(function (item) {
              var card = button('cal-chip', null, function () {
                state.day = day.date;
                switchView('day');
              });
              card.appendChild(h('span', 'cal-chip-time', item.from));
              card.appendChild(h('span', 'cal-chip-name', item.booking.name));
              card.appendChild(h('span', 'cal-chip-service', item.booking.serviceName));
              col.appendChild(card);
            });

            grid.appendChild(col);
          });

          slot.appendChild(grid);
          slot.appendChild(h('p', 'cal-count', total
            ? 'Ezen a héten összesen ' + total + ' foglalás. Kattintson egy napra a részletekért.'
            : 'Ezen a héten még nincs foglalás.'));
        })
        .catch(function (error) {
          slot.textContent = '';
          slot.appendChild(h('p', 'cal-empty', 'A hetet nem sikerült betölteni.'));
          Admin.reportError(error);
        });
    }

    /* ══════════════════ HAVI NÉZET ══════════════════ */
    function renderMonth() {
      body.textContent = '';

      var bar = h('div', 'cal-bar');
      bar.appendChild(button('cal-nav', '‹', function () { stepMonth(-1); }));
      var label = h('div', 'cal-bar-label');
      label.appendChild(h('strong', null, monthTitle(state.month)));
      bar.appendChild(label);
      bar.appendChild(button('cal-nav', '›', function () { stepMonth(1); }));
      bar.appendChild(button('btn btn-ghost btn-sm', 'Aktuális hónap', function () {
        state.month = monthOf(todayIso()); renderMonth();
      }));
      body.appendChild(bar);

      /* Szabadnap-mód: bekapcsolva a napra kattintás nem a menetrendet nyitja,
         hanem szabadnappá teszi (vagy visszavonja). Külön kapcsoló kell, mert
         a napra kattintás alapesetben megnézést jelent — a kettő egy
         gesztusra nem fér rá félreértés nélkül. */
      var modeBar = h('div', 'cal-modebar');
      var toggle = h('label', 'cal-switch');
      var checkbox = input('checkbox');
      checkbox.checked = state.marking;
      checkbox.addEventListener('change', function () {
        state.marking = checkbox.checked;
        renderMonth();
      });
      toggle.appendChild(checkbox);
      toggle.appendChild(h('span', 'cal-switch-text', 'Szabadnap kijelölése'));
      modeBar.appendChild(toggle);
      modeBar.appendChild(h('span', 'cal-modebar-hint', state.marking
        ? 'Kattintson a napokra: a kijelölt napokra nem lehet foglalni. Újra rájuk kattintva visszavonható.'
        : 'Kattintson egy napra a menetrend megnézéséhez.'));
      body.appendChild(modeBar);

      var weekRow = h('div', 'cal-grid-weekdays');
      WEEK_ORDER.forEach(function (index) {
        weekRow.appendChild(h('span', null, DAY_SHORT[index]));
      });
      body.appendChild(weekRow);

      var slot = h('div', 'cal-month-slot');
      slot.appendChild(h('p', 'cal-empty', 'A hónap betöltése…'));
      body.appendChild(slot);

      var first = state.month + '-01';
      var days = new Date(Date.UTC(parseDay(first).getUTCFullYear(), parseDay(first).getUTCMonth() + 1, 0)).getUTCDate();
      var last = state.month + '-' + pad(days);

      /* A kiszolgáló egyszerre legfeljebb 45 napot ad — egy hónap belefér. */
      api('/api/admin/agenda?site=' + site + '&from=' + first + '&to=' + last)
        .then(function (data) {
          if (state.view !== 'month') return;
          slot.textContent = '';

          var byDate = {};
          data.days.forEach(function (day) { byDate[day.date] = day; });

          var grid = h('div', 'cal-grid');

          /* Vezető üres cellák, hogy a hónap a helyes hétnapra essen. */
          var lead = weekdayOf(first);
          lead = lead === 0 ? 6 : lead - 1;
          for (var i = 0; i < lead; i++) grid.appendChild(h('span', 'cal-cell cal-cell--empty'));

          data.days.forEach(function (day) {
            grid.appendChild(monthCell(day, data.today));
          });

          slot.appendChild(grid);

          var closures = state.schedule.closures.filter(function (item) {
            return item.to >= first && item.from <= last;
          });
          if (closures.length) {
            var note = h('p', 'cal-count', 'Szabadnapok ebben a hónapban: ' +
              closures.map(function (item) {
                return item.from === item.to
                  ? shortDate(item.from) + ' (' + item.label + ')'
                  : shortDate(item.from) + '–' + shortDate(item.to) + ' (' + item.label + ')';
              }).join(', '));
            slot.appendChild(note);
          }
        })
        .catch(function (error) {
          slot.textContent = '';
          slot.appendChild(h('p', 'cal-empty', 'A hónapot nem sikerült betölteni.'));
          Admin.reportError(error);
        });
    }

    function stepMonth(delta) {
      var parts = state.month.split('-').map(Number);
      var d = new Date(Date.UTC(parts[0], parts[1] - 1 + delta, 1));
      state.month = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
      renderMonth();
    }

    function monthCell(day, today) {
      var count = day.items.filter(function (item) { return item.kind === 'booking'; }).length;
      var cell = button('cal-cell', null, function () {
        if (state.marking) { toggleClosure(day); return; }
        state.day = day.date;
        switchView('day');
      });

      if (day.date === today) cell.classList.add('is-today');
      if (day.date < today) cell.classList.add('is-past');
      if (day.closure) cell.classList.add('is-closure');
      else if (!day.open) cell.classList.add('is-closed');
      if (state.marking) cell.classList.add('is-marking');

      cell.appendChild(h('span', 'cal-cell-num', String(parseDay(day.date).getUTCDate())));

      if (day.closure) {
        cell.appendChild(h('span', 'cal-cell-tag', 'szabadnap'));
      } else if (count) {
        cell.appendChild(h('span', 'cal-cell-count', String(count)));
      }

      cell.title = day.closure
        ? 'Szabadnap: ' + day.closure.label
        : (day.open ? count + ' foglalás' : 'Zárva');
      return cell;
    }

    /** Szabadnap ki- vagy bekapcsolása egyetlen napra. */
    function toggleClosure(day) {
      var next = cloneSchedule();

      if (day.closure) {
        /* Több napos szabadságból csak akkor vehető ki egy nap, ha az a
           széle — a közepén lyukat ütni félreérthető lenne, ezért ilyenkor a
           beállítások közt kell szerkeszteni. */
        var closure = next.closures.filter(function (item) { return item.id === day.closure.id; })[0];
        if (!closure) return;

        if (closure.from === closure.to) {
          next.closures = next.closures.filter(function (item) { return item.id !== closure.id; });
        } else if (day.date === closure.from) {
          closure.from = addDays(closure.from, 1);
        } else if (day.date === closure.to) {
          closure.to = addDays(closure.to, -1);
        } else {
          toast('Ez egy több napos szabadság közepe — a „Nyitvatartás” fülön szerkeszthető.', 'info');
          return;
        }
      } else {
        next.closures.push({ label: 'Szabadnap', from: day.date, to: day.date });
      }

      saveSchedule(next, day.closure ? 'A szabadnap visszavonva.' : 'A nap szabadnappá lett.')
        .then(renderMonth, function () { /* a hibát a saveSchedule már jelezte */ });
    }

    /* ══════════════════ NYITVATARTÁS ══════════════════ */
    function cloneSchedule() {
      return JSON.parse(JSON.stringify(state.draft || state.schedule));
    }

    function saveSchedule(next, message) {
      return api('/api/admin/schedule', {
        method: 'PUT',
        json: { site: site, schedule: next }
      }).then(function (data) {
        state.schedule = data.schedule;
        state.draft = null;
        state.dirty = false;
        if (message) toast(message, 'success');
        return data.schedule;
      }).catch(function (error) {
        Admin.reportError(error);
        throw error;
      });
    }

    function markDirty() {
      state.dirty = true;
      var bar = root.querySelector('.cal-savebar');
      if (bar) bar.hidden = false;
    }

    function renderSettings() {
      if (!state.draft) state.draft = JSON.parse(JSON.stringify(state.schedule));
      var draft = state.draft;

      body.textContent = '';

      /* ── Nyitvatartás naponként ── */
      var hoursPanel = h('section', 'cal-panel');
      hoursPanel.appendChild(h('h2', 'cal-panel-title', 'Nyitvatartás'));
      hoursPanel.appendChild(h('p', 'cal-panel-hint',
        'A foglalás a nyitástól indul, és az utolsó időpontnak zárásig be kell fejeződnie. ' +
        'A kipipálatlan nap zárva van.'));

      var hoursList = h('div', 'cal-hours');
      WEEK_ORDER.forEach(function (index) {
        hoursList.appendChild(hourRow(draft, index));
      });
      hoursPanel.appendChild(hoursList);
      body.appendChild(hoursPanel);

      /* ── Időzítés ── */
      var timingPanel = h('section', 'cal-panel');
      timingPanel.appendChild(h('h2', 'cal-panel-title', 'Időzítés'));
      timingPanel.appendChild(h('p', 'cal-panel-hint',
        'A pihenő minden foglalás UTÁN automatikusan hozzáadódik: ennyi idővel később ' +
        'kezdődhet a következő vendég. Ez a szabály visszafelé is működik — egy már ' +
        'lefoglalt időpont elé csak olyan kezelés fér be, ami a pihenővel együtt véget ér.'));

      var timing = h('div', 'cal-fields');
      timing.appendChild(numberField(draft, 'buffer', 'Pihenő két időpont között (perc)', 0, 180, 5));
      timing.appendChild(numberField(draft, 'step', 'Felkínált kezdések lépésköze (perc)', 5, 120, 5));
      timing.appendChild(numberField(draft, 'leadMinutes', 'Legkorábbi foglalás ennyi perc múlva', 0, 10080, 30));
      timing.appendChild(numberField(draft, 'horizonDays', 'Ennyi napra előre lehet foglalni', 1, 365, 1));
      timingPanel.appendChild(timing);
      body.appendChild(timingPanel);

      /* ── Vizsgálati hosszak (csak optika) ── */
      if (draft.serviceDurations) {
        var servicePanel = h('section', 'cal-panel');
        servicePanel.appendChild(h('h2', 'cal-panel-title', 'Vizsgálatok hossza'));
        servicePanel.appendChild(h('p', 'cal-panel-hint',
          'Ennyi ideig tart egy-egy vizsgálat. A weboldal foglalója ezt írja ki a ' +
          'szolgáltatás kártyájára, és ekkora sávot foglal le a naptárban.'));

        var serviceFields = h('div', 'cal-fields');
        (state.optikaServices || []).forEach(function (service) {
          var node = input('number', String(draft.serviceDurations[service.key]));
          node.min = 5; node.max = 300; node.step = 5;
          node.addEventListener('change', function () {
            var value = parseInt(node.value, 10);
            if (!isFinite(value) || value < 5) { node.value = draft.serviceDurations[service.key]; return; }
            draft.serviceDurations[service.key] = value;
            markDirty();
          });
          serviceFields.appendChild(field(service.name + ' (perc)', node));
        });
        servicePanel.appendChild(serviceFields);
        body.appendChild(servicePanel);
      }

      /* ── Állandó szünetek ── */
      var breakPanel = h('section', 'cal-panel');
      breakPanel.appendChild(h('h2', 'cal-panel-title', 'Állandó szünetek'));
      breakPanel.appendChild(h('p', 'cal-panel-hint',
        'Minden héten visszatérő szünetek: ebéd, uzsonna, bármi. Ezekre az időkre ' +
        'a weboldal nem kínál időpontot. A szünet maga is pihenés, ezért elé és mögé ' +
        'nem számítunk még egy pihenőt.'));

      var breakList = h('div', 'cal-rows');
      draft.breaks.forEach(function (item, index) {
        breakList.appendChild(breakEditor(draft, item, index));
      });
      if (!draft.breaks.length) {
        breakList.appendChild(h('p', 'cal-empty', 'Nincs beállított szünet.'));
      }
      breakPanel.appendChild(breakList);
      breakPanel.appendChild(button('btn btn-ghost btn-sm', '+ Új szünet', function () {
        draft.breaks.push({ label: 'Szünet', days: [1, 2, 3, 4, 5], from: '12:00', to: '12:30' });
        markDirty();
        renderSettings();
      }));
      body.appendChild(breakPanel);

      /* ── Szabadnapok ── */
      var closurePanel = h('section', 'cal-panel');
      closurePanel.appendChild(h('h2', 'cal-panel-title', 'Szabadnapok'));
      closurePanel.appendChild(h('p', 'cal-panel-hint',
        'Egy nap vagy egy egész időszak, amikor zárva van: szabadság, elutazás, ünnep. ' +
        'Egyetlen nap a „Hónap” nézetben egy kattintással is kijelölhető.'));

      var closureList = h('div', 'cal-rows');
      var sorted = draft.closures.slice().sort(function (a, b) { return a.from < b.from ? -1 : 1; });
      sorted.forEach(function (item) {
        closureList.appendChild(closureEditor(draft, item));
      });
      if (!draft.closures.length) {
        closureList.appendChild(h('p', 'cal-empty', 'Nincs beállított szabadnap.'));
      }
      closurePanel.appendChild(closureList);
      closurePanel.appendChild(button('btn btn-ghost btn-sm', '+ Új szabadnap', function () {
        var start = state.day >= todayIso() ? state.day : todayIso();
        draft.closures.push({ label: 'Szabadnap', from: start, to: start });
        markDirty();
        renderSettings();
      }));
      body.appendChild(closurePanel);

      /* ── Mentősáv ── */
      var saveBar = h('div', 'cal-savebar');
      saveBar.hidden = !state.dirty;
      saveBar.appendChild(h('span', 'cal-savebar-text', 'Nem mentett módosítások'));
      var saveActions = h('div', 'cal-savebar-actions');
      saveActions.appendChild(button('btn btn-ghost btn-sm', 'Elvetés', function () {
        state.draft = null;
        state.dirty = false;
        renderSettings();
      }));
      saveActions.appendChild(button('btn btn-primary btn-sm', 'Mentés', function () {
        saveSchedule(state.draft, 'A nyitvatartás elmentve.').then(renderSettings).catch(function () {});
      }));
      saveBar.appendChild(saveActions);
      body.appendChild(saveBar);
    }

    function hourRow(draft, index) {
      var row = h('div', 'cal-hour-row');
      var open = !!draft.hours[index];

      var check = input('checkbox');
      check.checked = open;
      var name = h('label', 'cal-hour-day');
      name.appendChild(check);
      name.appendChild(h('span', null, DAY_NAMES[index]));
      row.appendChild(name);

      var from = input('time', open ? draft.hours[index].from : '09:00');
      var to = input('time', open ? draft.hours[index].to : '17:00');
      from.disabled = !open;
      to.disabled = !open;

      function apply() {
        if (!check.checked) { draft.hours[index] = null; markDirty(); return; }
        if (clockToMinutes(to.value) <= clockToMinutes(from.value)) {
          toast('A zárásnak a nyitás után kell lennie.', 'error');
          to.value = minutesToClock(Math.min(23 * 60 + 55, clockToMinutes(from.value) + 60));
        }
        draft.hours[index] = { from: from.value, to: to.value };
        markDirty();
      }

      check.addEventListener('change', function () {
        from.disabled = !check.checked;
        to.disabled = !check.checked;
        apply();
      });
      from.addEventListener('change', apply);
      to.addEventListener('change', apply);

      var times = h('div', 'cal-hour-times');
      times.appendChild(from);
      times.appendChild(h('span', 'cal-dash', '–'));
      times.appendChild(to);
      row.appendChild(times);
      return row;
    }

    function numberField(draft, key, labelText, min, max, step) {
      var node = input('number', String(draft[key]));
      node.min = min; node.max = max; node.step = step;
      node.addEventListener('change', function () {
        var value = parseInt(node.value, 10);
        if (!isFinite(value) || value < min || value > max) { node.value = draft[key]; return; }
        draft[key] = value;
        markDirty();
      });
      return field(labelText, node);
    }

    function breakEditor(draft, item, index) {
      var row = h('div', 'cal-row');

      var label = input('text', item.label);
      label.maxLength = 60;
      label.addEventListener('input', function () { item.label = label.value; markDirty(); });
      row.appendChild(field('Megnevezés', label));

      var from = input('time', item.from);
      from.addEventListener('change', function () { item.from = from.value; markDirty(); });
      row.appendChild(field('Ettől', from));

      var to = input('time', item.to);
      to.addEventListener('change', function () {
        if (clockToMinutes(to.value) <= clockToMinutes(item.from)) {
          toast('A szünet vége a kezdete után kell legyen.', 'error');
          to.value = item.to;
          return;
        }
        item.to = to.value;
        markDirty();
      });
      row.appendChild(field('Eddig', to));

      var days = h('div', 'cal-days');
      days.appendChild(h('span', 'cal-field-label', 'Mely napokon'));
      var boxes = h('div', 'cal-daybuttons');
      WEEK_ORDER.forEach(function (dayIndex) {
        var toggle = button('cal-daybtn', DAY_SHORT[dayIndex], function () {
          var at = item.days.indexOf(dayIndex);
          if (at === -1) item.days.push(dayIndex);
          else item.days.splice(at, 1);
          toggle.classList.toggle('is-on', item.days.indexOf(dayIndex) !== -1);
          markDirty();
        });
        toggle.classList.toggle('is-on', item.days.indexOf(dayIndex) !== -1);
        boxes.appendChild(toggle);
      });
      days.appendChild(boxes);
      row.appendChild(days);

      row.appendChild(button('cal-remove', '×', function () {
        draft.breaks.splice(index, 1);
        markDirty();
        renderSettings();
      }));
      return row;
    }

    function closureEditor(draft, item) {
      var row = h('div', 'cal-row');

      var label = input('text', item.label);
      label.maxLength = 60;
      label.addEventListener('input', function () { item.label = label.value; markDirty(); });
      row.appendChild(field('Megnevezés', label));

      var from = input('date', item.from);
      from.addEventListener('change', function () {
        item.from = from.value;
        if (item.to < item.from) { item.to = item.from; renderSettings(); }
        markDirty();
      });
      row.appendChild(field('Ettől a naptól', from));

      var to = input('date', item.to);
      to.addEventListener('change', function () {
        if (to.value < item.from) {
          toast('A záró nap nem lehet korábbi a kezdőnél.', 'error');
          to.value = item.to;
          return;
        }
        item.to = to.value;
        markDirty();
      });
      row.appendChild(field('Eddig a napig', to));

      row.appendChild(button('cal-remove', '×', function () {
        var at = draft.closures.indexOf(item);
        if (at !== -1) draft.closures.splice(at, 1);
        markDirty();
        renderSettings();
      }));
      return row;
    }

    /* ══════════════════ FOGLALÁS FELVÉTELE ══════════════════
       Telefonon érkező vendéghez. Enélkül a telefonos foglalás nem kerülne
       be a naptárba, és a weboldal ugyanazt a sávot még egyszer felkínálná. */
    function openNewBooking(date) {
      if (!window.AdminBookingForm) return;
      AdminBookingForm.open({
        site: site,
        date: date >= todayIso() ? date : todayIso(),
        services: state.services,
        onSaved: function (saved) {
          state.day = saved.date;
          state.month = monthOf(saved.date);
          toast('A foglalás felvéve.', 'success');
          render();
        }
      });
    }

    /* ── A példány nyilvános felülete ─────────────────────────────────── */
    build();

    return {
      show: function () {
        /* Visszatéréskor frissítjük a naptárt: közben érkezhetett foglalás. */
        if (state.view !== 'settings') {
          state.schedule = null;
          state.draft = null;
        }
        render();
      },
      isDirty: function () { return state.view === 'settings' && state.dirty; }
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     PÉLDÁNYOK ÉS BEKÖTÉS
     ══════════════════════════════════════════════════════════════════ */
  var instances = {};

  document.addEventListener('admin:section', function (event) {
    var id = event.detail && event.detail.id;
    if (!id) return;

    var mount = document.querySelector('#section-' + id + ' .cal-mount');
    if (!mount) return;

    var site = mount.getAttribute('data-site');
    if (!site) return;

    if (!instances[site]) instances[site] = createCalendar(mount, site);
    instances[site].show();
  });

  /* Nem mentett nyitvatartás és lapelhagyás: a váz `beforeunload` figyelője a
     szekció `isDirty`-jét nézi, a naptár viszont nem szekció. Saját figyelő. */
  window.addEventListener('beforeunload', function (event) {
    var dirty = Object.keys(instances).some(function (site) { return instances[site].isDirty(); });
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
})();
