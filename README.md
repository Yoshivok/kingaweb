# Manula-Optic Med. — egyesített weboldal

A **Salvia Gyógymasszázs** és a **Lumina Optika** weboldala egyetlen domain alatt,
közös választóoldallal. A látogató középen érkezik, és egy kattintással balra a
masszázs, jobbra az optika oldalra úszik át — **újratöltés nélkül**.

```
manula_optic_med/
├── index.html          A választóoldal ÉS a keret, amely a három panelt tartja
├── assets/
│   ├── landing.css     A választó stíluslapja
│   ├── landing.js      A sáv mozgatása, előtöltés, részecskeréteg
│   ├── js/year.js      A láblécek évszáma (közös, hogy ne kelljen inline szkript)
│   ├── main_logo.jpg   Az eredeti logó (változatlanul)
│   ├── main_logo.webp  Ugyanaz, átlátszó háttérrel — ez látszik a medálon
│   └── favicon.png     A logó jelképéből
├── masszazs/           Salvia Gyógymasszázs
├── optika/             Lumina Optika
│   └── assets/
│       ├── css/products.css        Termékkártya + részletek — KÖZÖS az adminnal
│       ├── js/product-render.js    Ugyanezek felépítése — KÖZÖS az adminnal
│       └── products/               Az adminból feltöltött fotók (nincs git-ben)
├── admin/              Az admin felület (csak a /admins címen érhető el)
│   ├── index.html      Bejelentkezés + termékkezelő
│   ├── app.css         Az admin stíluslapja
│   └── app.js          Az admin logikája
├── server/             Node kiszolgáló + időpontkérés + termék-API
│   ├── server.js       Kiszolgálás, biztonsági fejlécek, útvonalak
│   ├── lib/
│   │   ├── security.js     Jelszó, munkamenet, CSRF, sebességkorlát
│   │   ├── store.js        Termékadatok + admin fiók, ellenőrzéssel
│   │   ├── uploads.js      Képfeltöltés, kvóta, árva fájlok takarítása
│   │   ├── image-probe.js  A feltöltött fájl VALÓDI kép-e?
│   │   └── api.js          A nyilvános és az admin végpontok
│   └── data/           products.json + admin.json (futásidejű, nincs git-ben)
├── _eredeti_kepek/     A WebP-re váltás előtti eredeti fotók (nem kiszolgált)
└── package.json
```

## Indítás

```bash
npm start          # vagy: node server/server.js
```

Alapértelmezetten a `http://127.0.0.1:8000` címen szolgál ki. A port a
`server/config.json` fájlban vagy a `PORT` környezeti változóval állítható.

## Hogyan működik az összekötés

Az `index.html` egy vízszintes sávot tart, benne három panellel:

```
┌───────────┬───────────┬───────────┐
│ masszazs/ │  VÁLASZTÓ │  optika/  │     a sáv 300% széles,
│  (iframe) │  (kezdés) │  (iframe) │     a nézet ezen csúszik
└───────────┴───────────┴───────────┘
```

* A két weboldal `<iframe>`-ben, a **saját mappájából, külön dokumentumként**
  fut. Ez szándékos: mindkét oldal ugyanazokat a CSS-változóneveket és
  osztályneveket használja (`.header`, `.logo`, `.btn`, `--color-accent` …),
  egy közös DOM-ba olvasztva ütköznének.
  A keret **vezérlésileg** nem nyúl hozzájuk: a `landing.js` csak üzen nekik
  (`mom:motion`), az elrendezésüket és a működésüket nem írja át. A saját
  fájljaikban viszont történtek teljesítményjavítások — lásd a *Második
  teljesítmény-kör* szakaszt.
* A választás csak a sáv `transform` értékét állítja át — **nincs oldalbetöltés**.
* Mindkét oldal a döntés előtt, a háttérben betöltődik, így a váltás azonnali.
  Ha a látogató korábban kattint, addig a saját háttérszínén egy töltésjelző fut.

## Címek

| Cím | Mit ad |
|-----|--------|
| `/` | A választóoldal |
| `/#masszazs` | Egyből a masszázs oldal (a sáv animáció nélkül odaugrik) |
| `/#optika` | Egyből az optika oldal |
| `/masszazs/` | A masszázs oldal önállóan, keret nélkül |
| `/optika/` | Az optika oldal önállóan, keret nélkül |
| `/admins` | **Az admin felület** — bejelentkezés, majd termékkezelés |
| `POST /api/idopont` | Időpontkérés — a masszázs űrlap ezt hívja |
| `GET /api/products` | A közzétett termékek — az optika oldal ezt olvassa |
| `/api/admin/*` | Az admin végpontjai (munkamenet nélkül nem érhetők el) |

A két oldal önálló címe azért marad meg, mert a keresőrobotok és a
megosztott linkek így a teljes tartalmat kapják; a választóoldalon lévő
két hivatkozás valódi `<a href>`, tehát JavaScript nélkül is működik.

## Visszatérés a választóhoz

* A képernyő szélén lebegő **fül** — mindig a választó irányába mutat
  (a masszázs oldalon jobbra, az optikán balra).
* **Escape** billentyű. Csak akkor lép vissza, ha az adott weboldalnak nincs
  dolga vele: nyitott menünél (`aria-expanded="true"`), nyitott
  párbeszédablaknál (`<dialog open>`) vagy űrlapmezőben gépelés közben nem
  avatkozik közbe.
* A böngésző **vissza** gombja is működik.

## Billentyűzet és akadálymentesség

* A választón: `←` masszázs, `→` optika, `Tab` a két hivatkozás között.
* Ami nincs képen, az `inert` — a fókusz nem téved a rejtett panelekre.
* `prefers-reduced-motion` esetén elmarad a csúszás, a részecskék és a
  belépő animáció; a választás azonnali.

## Teljesítmény

A választóoldal első változata 8,6 kép/mp-et adott. Most **60 kép/mp**, és a
legrosszabb képkocka is 17 ms (egyetlen vsync) — tehát nincs képkocka-kiesés.

Mérve (szoftveres raszterizálással, ami a legrosszabb eset):

| Oldal | 1600×900 | 2560×1440 |
|---|---|---|
| **választóoldal** | **60 fps** | **60 fps** |
| `/masszazs/` önmagában | 37 fps | 22 fps |
| `/optika/` önmagában | 60 fps | 32 fps |

Amit a mérés kimutatott — erre figyeljen, aki hozzányúl:

| Ok | Hatás |
|---|---|
| `filter: blur(80px)` három képernyőnyi rétegen | 8,6 → 36 fps |
| `scale()` színátmenetes réteg kulcskockáiban | 36 → 46 fps |
| SVG-n **belüli** transform-animáció (az egész SVG újrarajzolódik) | 46 → 51 fps |
| Egy képernyőnyi, **mozgó** áttetsző réteg (aurora) | 34 → 60 fps (2560-on) |
| `top`/`left` animálása (elrendezést számoltat képkockánként) | −7% CPU |
| Két forgó DOM-réteg átköltöztetése a vászonra | −20% CPU |

Három szabály, ami ezekből következik:

1. **Csak `transform`-ot és `opacity`-t animáljunk.** A `top`, `left`, `width`
   elrendezést számoltat; a `scale()` színátmenetes felületen újrarajzoltat.
2. **SVG-ben az elem egészét mozgassuk, ne a belsejét.** Ezért került a forgó
   lencsemotívum saját elembe.
3. **Ami már úgyis rajzolódik, oda tegyük.** A forgó lencsemotívum és a
   fénycsík a részecske-vászonra került: külön compositor-rétegként ezek voltak
   a legdrágább elemek, a vásznon viszont — ahol amúgy is történik rajzolás
   minden képkockán — gyakorlatilag ingyen vannak. Ha a vászon nem fut
   (csökkentett mozgás vagy gyenge gép), a `.orn--lens` SVG lép a helyébe, így
   a motívum mindig látszik, csak nem mindig forog.

Ezen felül:

* A képen kívüli panel **leparkol** (`visibility: hidden` + megállított
  animációk). Enélkül a rejtett választó a weboldalak böngészése közben végig
  futtatta az animációit egy képernyőnyi `blur(7px)` réteggel.
* A vászon ~30 kép/mp-pel rajzol, és megáll, ha elhagyjuk a választót vagy a
  lap háttérbe kerül.
* A `<canvas>` helyettesített elem: `inset: 0` önmagában nem feszíti ki, ezért
  kap explicit `width/height: 100%`-ot. Enélkül 300×150 pixel marad.
* **Önszabályozás:** belépés után a `landing.js` megméri a valódi képkockaidőt.
  Ha a gép nem bírja, előbb feleannyi szemcsét rajzol, nagyon lassú gépen pedig
  `body.is-lowfx`-re vált — a mozgás megáll, de a kompozíció, a színek és az
  elrendezés változatlanok.

## Második teljesítmény-kör (képek, kiszolgáló, backdrop-filter)

Az első kör a **választóoldal** animációit rendezte. A második kör a
**két beágyazott weboldalt** és a hálózati oldalt.

### 1. Képek — 17 MB → 2 MB

A fényképek 1024×1024-es JPEG-ek voltak, alig tömörítve (500–900 kB
darabonként), kettő pedig PNG-ként (1,5 MB). Több `.png` kiterjesztésű fájl
valójában JPEG volt. Mind WebP (q85) lett, `ffmpeg -c:v libwebp`-vel:

| | előtte | utána |
|---|---|---|
| `masszazs/assets/img/` (16 anatómiai kép) | 11 MB | 1,2 MB |
| `optika/assets/` (szimulátor + kezelésfotók) | 6,5 MB | 1,3 MB |
| `assets/main_logo` (átlátszó háttérrel) | 191 kB | 60 kB |

Az eredeti fájlok a **`_eredeti_kepek/`** mappában maradtak — nincs rájuk
hivatkozás, a kiszolgálás nem érinti őket. Ha nem kell belőlük biztonsági
másolat, a mappa törölhető.

### 2. Kiszolgáló — tömörítés és érvényes gyorsítótár

* **Brotli/gzip** a szöveges válaszokra. `masszazs/index.html` 124 → 26 kB,
  `optika/index.js` 124 → 37 kB, `optika/index.css` 72 → 14 kB. A tömörített
  változat a fájl módosítási ideje szerint gyorsítótárazódik, tehát
  kérésenként nem fut újra.
* **`Last-Modified` + 304.** A korábbi hiba nem a `no-cache` volt, hanem hogy
  a válasz nem hozott mivel ellenőrizni: sem `Last-Modified`, sem `ETag`. Így
  a böngésző nem *rákérdezni* tudott, hanem csak újra letölteni — minden
  oldalbetöltésnél az összes képet és szkriptet. HTML/CSS/JS marad
  `no-cache` (mindig friss), kép/betűtípus egy napig él.

A választóoldal teljes betöltése (keret + mindkét weboldal, 19 kérés):
**2,18 MB → 0,61 MB**, −72%.

### 3. `backdrop-filter` — a masszázs oldal 30 kép/mp-es plafonja

A masszázs oldal 30 kép/mp-en járt, miközben a CPU-mutatók üresek voltak
(`ScriptDuration` 4 ms, `LayoutDuration` 1 ms). Nem a JavaScript és nem az
elrendezés volt a szűk keresztmetszet, hanem a **raszterizálás**: a keret nem
fért bele 16,7 ms-ba, ezért a kompozitor minden második vsync-et kihagyta.

Két ok, egymást erősítve:

| Ok | Mérés |
|---|---|
| `--glass-blur: blur(18px) saturate(150%)` a ragadós fejlécen, alatta mozgó háttérrel | `blur(18px)` → 30 fps, `blur(12px)` → 60 fps, `blur(8px)` → 60 fps |
| 12 elem `backdrop-filter`-rel, amiből 11-en nem is látszott | levételük után SSIM 0,9994 / PSNR 55 dB — azaz szemmel azonos |
| `.halo__ring--2` **folytonos** vonalú kör, ami a saját középpontja körül forgott | láthatatlan animáció, képkockánkénti újrarajzolással |

Utána: **60 kép/mp a lap minden szakaszán** (hero, Kezelések, Anatómia,
Tudnivalók, Áraink, Kapcsolat), ingadozás nélkül.

Amit ebből érdemes megjegyezni: a `backdrop-filter` költsége a sugár
**négyzetével** nő, és minden képkockában újra lefut, ha bármi mozog az elem
mögött. Ha az elem háttere 95%-ban átlátszatlan (vagy fordítva: alig 3–8%-os
fátyol egy lágy átmenet fölött), az elmosás nem látszik — csak fizet érte.

### 4. Egyéb, ugyanebből a családból

* **Animált `filter` levéve a választó két feléről.** A hover korábban
  `filter: saturate(0.45)`-öt úsztatott át 0,7 mp alatt egy *fél
  képernyőnyi* elemen; most csak `opacity`.
* **Animált `backdrop-filter` levéve az optika párbeszédablakáról.** A
  `blur(0px) → blur(6px)` átmenet képkockánként új sugárral raszterizálta
  újra az egész képernyőt. A sugár most állandó, csak a sötétítő szín úszik be.
* **`filter: blur(0px)` → `filter: none`** a látásszimulátor rétegein. A
  nulla erősségű szűrő is saját rajzfelületet nyit; három egész felületű
  rétegen ez tiszta veszteség volt.
* **Állandó `will-change: transform` levéve** a szimulátor konténeréről: a
  nagy, elmosott réteget a böngésző akkor is GPU-textúrában tartotta, amikor
  a szekció ki volt görgetve — sőt akkor is, amikor az egész weboldal a
  keretben parkolt.
* **Betűtípusok:** az optika 4 családot kért (25 statikus fájl), de csak
  kettőt használ — az `Outfit` és a `Cormorant Garamond` sehol nem szerepel.
  Most 2 család, változó betűként, 3 fájlban.
* **Előtöltés:** a keret takarékos módban, lassú kapcsolaton (`saveData`,
  2g/3g) vagy 4 GB alatti memóriánál már nem tölti le előre *mindkét*
  weboldalt. A váltás ilyenkor sem törik el, csak nem azonnali.
* **Saját ikon az optika oldalain.** Enélkül minden oldalbetöltés egy
  404-es `/favicon.ico` kérést indított.

## Harmadik teljesítmény-kör (a választó gyengébb gépen)

A választó erős gépen 60 kép/mp-et adott, gyengébb gépen viszont továbbra is
akadozott. A maradék költségeknek közös vonásuk volt: **nem a mozgás volt
drága, hanem a RAJZOLÁS, amit a mozgás kikényszerített.**

| Ok | Miért drága |
|---|---|
| `backdrop-filter: blur(6px)` a két „Belépés” gombon | A gombok a részecskevászon FÖLÖTT ülnek, az pedig minden képkockán újrarajzol — így a mögöttes képet képkockánként újra kellett kiolvasni, elmosni és visszakeverni. Sötét háttéren az elmosás nem is látszott. |
| `stroke-dashoffset` a bal oldali dísz négy vonalán | Nem kompozitor-tulajdonság: a fél képernyőnyi (kb. 960×1080) SVG-textúra rajzolódott újra 2,6 mp-en át, pont a belépő animáció alatt. |
| `opacity`-animáció az SVG **gyermekén** (nyomáspontok) | A böngészők nem egységesen viszik a kompozitorra; ahol nem, ott az egész dísz-SVG újrarajzolódik 60-szor másodpercenként, örökké. |
| `text-shadow: 0 0 46px` átmenete a címeken hoverkor | A teljes címsort újra kell raszterezni minden képkockán, amíg az átmenet tart. |
| `box-shadow` átmenete a fénypászmán | 2 képpont széles, de teljes magasságú elem, 34 képpontos fényudvarral — minden egérmozdulatra. |
| `scale(1.035)` a medálon hoverkor | A medál gyermekei maszkolt kúpos színátmenetek; skálázáskor újraraszterizálódnak. |
| `will-change: transform` álló elemen (`.orn--rays`) | Animáció nélkül is lefoglal egy 900×900-as GPU-textúrát. |
| `min(dpr, 1.5)` a részecskevásznon | 1920×1080-on 4,6 millió, 4K-n 18 millió képpont képkockánként. Integrált GPU-n ez volt a vászon fő költsége — nem a szemcsék száma. |
| `createLinearGradient` képkockánként a fénycsíkhoz | A színátmenet felállítása újraindult minden képkockán, holott a csík mindvégig ugyanaz. |
| Mindkét weboldal előtöltése **egyszerre**, fix 1,5 mp-nél | Két teljes dokumentum letöltése, értelmezése és első kirajzolása ugyanazon a fő szálon, amelyen a belépő animáció fut. |

### A megoldás: három szint

A stíluslap alapértelmezése mostantól a **takarékos** változat — minden szabály
kimaradt belőle, ami képkockánként rajzolást kérne. Erre jön két kapcsoló,
amit a `landing.js` tesz a `<body>`-ra:

| Osztály | Mit ad hozzá / vesz el |
|---|---|
| `body.fx-high` | A rajzolással járó díszek: lüktető nyomáspontok, megrajzolódó vonalak, cím-fényudvar, medálnagyítás, erősödő pászmafény, a visszatérő fül üvege. |
| *(alapértelmezett)* | Ugyanaz a kompozíció, ugyanazok a színek és arányok, csak a fenti extrák nélkül. |
| `body.is-lowfx` | A padló: minden mozgás megáll, a vászon eltűnik. |

A szintet a gép adottságai (`hardwareConcurrency`, `deviceMemory`, felbontás)
döntik el **még az első kirajzolás előtt** — a korábbi megoldás csak 3,8 mp
után kezdett mérni, addigra a belépő animáció már le is futott akadozva.
A mért képkockaidő ezután **már csak lefelé** módosíthat, több ablakban mérve
(felfelé lépni futás közben zavaró lenne: a díszek a semmiből ugranának be).

A vászon rajzfelülete ezen felül **felülről kötött** (szintenként 2,4 / 1,3
millió képpont): nagy vagy sűrű kijelzőn kisebb felbontáson készül, és a
böngésző nagyítja ki. Lágy fényfoltokon ez nem látszik.

Az **előtöltés** két ponton változott: a két weboldal már nem egyszerre, hanem
**egyesével** töltődik (a második az első `load`-ja után indul), és nem fix
időzítéssel, hanem a belépő animáció **és** az első képkockaidő-mérés után.
Gyenge gépen — vagy ha a mérés minősíti annak — teljesen elmarad; a váltás
ilyenkor sem törik el, csak nem azonnali. A látogató amúgy is a fél fölé viszi
az egeret kattintás előtt, és a `pointerenter` már ott elindítja a betöltést.

### Ellenőrzés a gyengébb gépen

```
/?fx=debug     képkocka-számláló a bal alsó sarokban (a mért szinttel)
/?fx=high      kényszerített szint — így nézhető meg erős gépen is,
/?fx=mid       mit lát a gyengébb
/?fx=low
```

## Az admin felület és a termékkezelés

A **Kiemelt Termékeink** szakasz tartalma már nem az `optika/index.html`-ben
áll kézzel megírva, hanem szerkeszthető adat. A `/admins` címen bejelentkezve
új termék vehető fel, a meglévő módosítható, elrejthető vagy törölhető — és a
mentés után azonnal ez látszik a weboldalon.

```
                     szerkeszt                       olvas
   /admins  ────────────────────►  server/data/  ◄────────────  /optika/
   (admin)      /api/admin/*        products.json   /api/products   (látogató)
                                          +
                              optika/assets/products/
                                  (a feltöltött fotók)
```

### Belépés

| | |
|---|---|
| Cím | `/admins` |
| Felhasználó | `kinga` |
| Jelszó | `admin` |

**Ez a kettő ideiglenes.** A kiszolgáló minden indításnál figyelmeztet rá,
és az admin felület tetején is látszik egy sáv, amíg érvényben van. Cseréje:
a fejlécben a **Jelszó** gomb. Az új jelszó legalább 12 karakter, kis- és
nagybetűvel, számmal; a felhasználónév is átírható vele egy lépésben.
Csere után minden eszközön újra be kell jelentkezni.

A jelszó **soha nem kerül fájlba nyílt szövegként**: a `server/data/admin.json`
csak a `scrypt` levezetett kulcsát tárolja, véletlen sóval. Ezt a fájlt a
kiszolgáló nem is adja ki böngészőnek, és a `.gitignore` is kizárja.

### Amit az admin tud

* **Új termék** — név, márka, ár, kategória, rövid leírás.
* **Jelvény** a kép sarkába: *Prémium*, *Új kollekció*, *Akció*, *Újdonság*,
  *Kifutó* — vagy egyedi szöveg, három színben.
* **Fotók** — húzással vagy tallózással, legfeljebb 8 termékenként. Az első a
  borítókép; a sorrend nyilakkal állítható, és minden fotóhoz megadható
  képleírás (ezt olvassa fel a képernyőolvasó, és ez látszik, ha a kép nem
  töltődik be).
* **Részletes leírás** — bevezető (üres sor = új bekezdés), pipás felsorolás,
  táblázatos adatok, záró megjegyzés. Ez nyílik meg az *Érdekel* gombra.
* **Előnézet** — ugyanaz a kód rajzolja, mint a weboldalon (`product-render.js`
  + `products.css`), tehát nem hasonlít a végeredményre, hanem az.
* **Megjelenik / rejtett** — a rejtett termék piszkozat: csak az adminban
  látszik, a `/api/products` válaszába be sem kerül.
* **Sorrend** — a nyilakkal; ez a sorrend a weboldalon is érvényes.
* **Keresés és szűrés** kategóriára, állapotra, névre.

Mobilon a szerkesztő teljes képernyős, a fülek vízszintesen görgethetők, és
minden gomb legalább 44 képpont — hüvelykujjal is pontosan találhatók.

### Mi történik a feltöltött képpel

1. **A böngészőben** átméreteződik (1200 és 600 képpontos változat készül) és
   WebP-be tömörödik. Ezzel a fényképezőgép EXIF-adatai — köztük a
   **GPS-koordináta** — eltűnnek, mert a kép újrakódolódik.
2. **A kiszolgálón** ellenőrzés következik: a fájl SZERKEZETÉBŐL olvassuk ki a
   képméretet (`server/lib/image-probe.js`). Ami nem valódi WebP/PNG/JPEG, azt
   elutasítjuk — beleértve a `GIF89a<script>…` típusú vegyes fájlokat is.
3. A fájl **gépi nevet** kap (24 hexa jegy), tehát a feltöltő nem szólhat bele
   az útvonalba. SVG-t nem fogadunk el: az XML, és futtathat szkriptet.
4. Az el nem mentett szerkesztésből maradt képeket a kiszolgáló óránként
   kitakarítja — csak a gépi nevű, egy óránál régebbi, egyetlen termék által
   sem hivatkozott fájlokat.

### Ha a kiszolgáló nem fut

Az `optika/index.html`-ben megmaradt a négy eredeti termékkártya **tartalék
tartalomként**. Ezt látja, akinél nincs JavaScript, és ez marad a képernyőn,
ha a `/api/products` nem válaszol. A tartalék párja a `server/lib/store.js`
`seedProducts()` függvénye — a kettő induláskor azonos. A kiszolgáló első
indításakor ez a négy termék kerül a `products.json`-be, onnantól
szerkeszthetők.

## Biztonság

A weboldal nyilvános fele nem kezel személyes adatot, az admin fele viszont
írhat a kiszolgálóra — a védelem ezért oda összpontosul. Az elv végig ugyanaz:
**több, egymástól független zár**, hogy egy réteg hibája ne legyen elég.

### Belépés és munkamenet

| Amit véd | Hogyan |
|---|---|
| A jelszó lemezen | `scrypt` (N=2¹⁵, ~100 ms és 32 MB próbánként), véletlen só, időfüggetlen összehasonlítás |
| Jelszótalálgatás | IP-nként 8 próba / 15 perc, felhasználónként 15 / óra, utána zárolás |
| Felhasználónév kitalálása | Azonos hibaüzenet és azonos válaszidő létező és nem létező névre (mérve: 75,7 vs 76,6 ms) |
| A süti ellopása szkripttel | `HttpOnly` — a JavaScript hozzá sem fér |
| A süti ellopása hálózaton | `Secure` + `__Host-` előtag HTTPS-en (ez utóbbi aldomainről sem írható felül) |
| Munkamenet-rögzítés | Belépéskor mindig ÚJ azonosító készül, a régi azonnal érvénytelen |
| Ellopott süti más gépen | A munkamenet a böngésző ujjlenyomatához kötött; eltérésnél megszűnik |
| Ottfelejtett bejelentkezés | 30 perc tétlenség vagy 8 óra után magától lezárul |

### Kérés-hamisítás (CSRF)

Módosító kéréshez **három** dolog kell egyszerre: érvényes süti, a
munkamenethez tartozó token az `X-CSRF-Token` fejlécben, és azonos eredetű
`Origin`. Idegen oldal egyiket sem tudja előállítani: a süti `SameSite=Strict`,
egyedi fejlécet CORS-engedély nélkül nem küldhet, az `Origin`-t pedig a
böngésző tölti ki, nem a lap.

### Beszúrt kód (XSS)

Három, egymástól független réteg:

1. **CSP** — `script-src 'self'`, `object-src 'none'`, `base-uri 'none'`.
   Beágyazott `<script>` és `onerror=` nem fut le. Ezért került minden inline
   szkript külön fájlba (`assets/js/year.js`). A strukturált adat (JSON-LD)
   blokkjait nem `'unsafe-inline'` engedi be, hanem a kiszolgáló indításkor
   kiszámolt SHA-256 lenyomatuk — így nem tud elavulni, és egy beszúrt szkript
   nem csúszhat át egy meglévő engedélyen.
2. **`textContent` mindenhol** — az adminból jövő szöveg soha nem `innerHTML`-lel
   kerül a lapra. Ha valaki `<script>`-et ír a termék nevébe, az szövegként
   jelenik meg.
3. **Kiszolgálóoldali ellenőrzés** — a beérkező terméket nem javítgatjuk, hanem
   engedélyezett mezőkből, hosszkorláttal újraépítjük.

### Fájlrendszer

* A `server/`, `admin/`, `_eredeti_kepek/` és `node_modules/` mappa, valamint
  minden ponttal kezdődő fájl (`.git`, `.gitignore`) kiszolgálhatatlan.
* A kiterjesztések **engedélyező** listán vannak: ami nincs rajta, az 404.
  Egy véletlenül a gyökérbe kerülő `.env` vagy `.bak` így sem tölthető le.
* Az útvonal feloldása után a kiszolgáló ellenőrzi, hogy a fájl tényleg a
  gyökér alatt van — a szimbolikus linkek feloldása (`realpath`) **után** is.
* Az admin lapjai csak a `/admins` néhány, névvel felsorolt útvonalán át
  érhetők el; magához az `admin/` mappához nincs hozzáférés.

### Kiszolgálás

* **Biztonsági fejlécek** minden válaszon: CSP, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
  `Cross-Origin-Resource-Policy`; HTTPS-en `Strict-Transport-Security`.
  Az admin szigorúbbat kap: `frame-ancestors 'none'`, `noindex`, `no-store`.
* **Méretkorlátok**: JSON-törzs 128 kB, kép 6 MB, összesen 600 fájl / 300 MB.
  Túllépéskor szabályos `413`-as válasz megy — nem a kapcsolat bontása.
* **Lassú kapcsolat (slowloris)**: fejlécre 20 mp, kérésre 60 mp időkorlát.
* **Hibák**: a veremkiírás a naplóba megy, a látogató általános üzenetet kap.

### Amit üzembe helyezés előtt meg KELL tenni

1. **Cserélje le az admin jelszót** a felület *Jelszó* gombjával.
2. **`trustProxy: true`** a `server/config.json`-ban, ha fordított proxy
   (nginx, Caddy, Render, Railway) mögött fut. Enélkül két baj van egyszerre:
   a sebességkorlát minden látogatót egy IP-nek lát, és a munkamenet-süti nem
   kapja meg a `Secure` jelzőt.
3. **HTTPS.** A `Secure` süti és a HSTS csak akkor lép életbe.
4. **`server/config.json` nem kerülhet git-be** — SMTP-jelszót tartalmaz.
   (A fájl 2026. szeptember 2-án ki lett véve a verziókövetésből; a lemezen
   megmaradt.)

### Mentés

A teljes termékkatalógus két helyen él, és egyik sincs a verziókövetésben:

```
server/data/              products.json (termékek) + admin.json (jelszó-hash)
optika/assets/products/   a feltöltött fotók
```

Ezt a kettőt együtt érdemes rendszeresen félretenni a szerverről.

## Üzembe helyezés

A `server/` mappa a gyökérben van, ezért a kiszolgáló `ROOT` értéke
automatikusan az egyesített gyökér lesz — a `server.js`-t nem kellett átírni.
A `server/` tartalma nem kiszolgálható kívülről (a `config.json` sem).

Éles indulás előtt a `server/config.json` fájlban töltse ki az SMTP adatokat
és a `to` mezőt. Amíg ezek hiányoznak, a kiszolgáló nem küld levelet, hanem a
`server/outbox/` mappába írja őket — így biztonságosan próbálható.
A minta a `server/config.example.json`; a `config.json` **nincs
verziókövetve**, mert jelszót tartalmaz.

A `server/data/` mappa az első indításkor jön létre magától: ide kerül a
termékkatalógus és az admin fiók. Nem kell előkészíteni.

Az oldal a domain **gyökeréből** szolgálandó ki (`example.hu/`, nem
`example.hu/valami/`): a termékképek útvonala a gyökérhez képest adott, hogy
a weboldal és az admin előnézet ugyanazt a képet lássa.

## Ha a két weboldal frissül

Cserélje ki a `masszazs/`, illetve `optika/` mappa tartalmát az új verzióra.
A választóoldal semmit nem feltételez a belsejükről, csak azt, hogy van bennük
`index.html`. Kivétel: az Escape-visszalépés a szabványos `aria-expanded`,
`<dialog open>` és `aria-modal` jelöléseket figyeli — ha ezek megmaradnak,
az is változatlanul működik.
