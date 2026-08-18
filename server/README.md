# Helyi kiszolgáló és levélküldés

```bash
node server/server.js      # → http://localhost:8000
```

Nincs `npm install`: a szerver csak a Node beépített moduljait használja
(`http`, `net`, `tls`, `fs`), az SMTP-kliens is saját.

## Beállítás

```bash
cp server/config.example.json server/config.json
```

Töltse ki a `config.json`-t:

| kulcs | mit jelent |
| :-- | :-- |
| `smtp.user` / `smtp.pass` | a küldő Gmail-fiók és a **16 karakteres app-jelszó** (nem a fiók jelszava!) |
| `from` | a feladó címe — Gmailnél ez ugyanaz, mint `smtp.user` |
| `to` | ide érkezik a masszőr értesítése (**a weboldalon sehol nem jelenik meg**) |

### Gmail app-jelszó — miért nem jó a saját jelszó?

A Google 2022 óta **nem engedi** a fiók saját jelszavával való SMTP-bejelentkezést
(a régi „kevésbé biztonságos alkalmazások" kapcsoló megszűnt). A kiszolgáló ilyenkor
`535-5.7.8 Username and Password not accepted` hibát ad.

Az app-jelszó menüpont **csak akkor jelenik meg, ha a fiókon be van kapcsolva a
kétlépcsős azonosítás** — ezért nem található meg elsőre. Sorrend:

1. [myaccount.google.com/security](https://myaccount.google.com/security) →
   **Kétlépcsős azonosítás** → bekapcsolás (telefonszám vagy Google-alkalmazás).
2. Utána: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   (ha a keresőbe írja: „app passwords" / „alkalmazásjelszavak").
3. Adjon nevet (pl. „Salvia weboldal") → a Google mutat **16 karaktert**,
   szóközökkel tagolva. A szóközök elhagyhatók.
4. Ezt írja a `smtp.pass` mezőbe — a saját jelszavát soha.

Ha a fiók **Google Workspace**-hez tartozik, a rendszergazda letilthatta az
app-jelszavakat; ilyenkor másik küldőre van szükség (lásd lentebb).

### Ha nincs app-jelszó — más SMTP is jó

Az SMTP-kliens bármelyik szolgáltatóval működik, csak a `config.json` változik.
Ezeknél nincs app-jelszó, hanem sima felhasználó + kulcs:

| szolgáltató | host / port | megjegyzés |
| :-- | :-- | :-- |
| Brevo (ex-Sendinblue) | `smtp-relay.brevo.com` : 587 | napi 300 levél ingyen |
| Mailjet | `in-v3.mailjet.com` : 587 | API-kulcs a felhasználó/jelszó |
| Tárhelyszolgáltató | általában `mail.sajatdomain.hu` : 465 | ha a domainhez jár postafiók |

A `to` cím ilyenkor is szabadon beállítható — akár Gmail-cím.

### A beállítás tesztelése

```bash
node server/test-mail.js                  # a config.json `to` címére
node server/test-mail.js cim@example.com  # megadott címre
```

Két próbalevelet küld (mindkét sablonból egyet), és hiba esetén emberi nyelven
megmondja, mi a baj (rossz jelszó, hiányzó app-jelszó, elérhetetlen kiszolgáló).

A `config.json` jelszót tartalmaz, ezért verziókövetésbe ne kerüljön bele
(a `.gitignore` már kizárja).

Környezeti változóval is megadható (ezek erősebbek a fájlnál):

```bash
SMTP_USER=cim@gmail.com SMTP_PASS='app jelszo' MAIL_TO=cel@gmail.com node server/server.js
```

## Száraz futás

Ha nincs `config.json` és környezeti változó sem, a szerver **nem küld levelet**,
hanem a `server/outbox/` mappába írja a két HTML-levelet — így a sablonok
böngészőben megnézhetők. Az űrlap ilyenkor is sikeres visszajelzést kap.

## Végpont

`POST /api/idopont` — JSON törzs (az űrlap ezt küldi), válasz `{"ok":true}`.
Ellenőrzés: kötelező mezők, e-mail formátum, fejlécinjektálás elleni szűrés,
IP-nként 5 kérés / óra.
