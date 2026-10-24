/* ═══════════════════════════════════════════════════════════════════════════
   SZEMBETEGSÉGEK — a Szemanatómia szekció alatti, lenyitható lista
   ─────────────────────────────────────────────────────────────────────────
   A tartalom a szakmai jegyzet I. fejezetéből készült. A listát csoportok
   (szemrészek) szerint lehet szűrni, és a fenti ábrán kiválasztott szemrészhez
   automatikusan a megfelelő csoport jelenik meg (`EyeDiseases.showForPart`).

   Minden szöveg kizárólag `textContent`-tel kerül a lapra, soha nem
   `innerHTML`-lel (ugyanaz a szabály, mint a product-render.js-ben).
   ═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* Csoportok. A `parts` az anatómiai ábra azonosítóit sorolja fel, amelyek
     ehhez a csoporthoz tartoznak (az ábrán kiválasztott rész ide képeződik le). */
  var GROUPS = [
    { id: 'cornea', label: 'Szaruhártya', parts: ['cornea'] },
    { id: 'sclera', label: 'Ínhártya', parts: ['sclera'] },
    { id: 'uvea', label: 'Szivárványhártya', parts: ['iris'] },
    { id: 'glaucoma', label: 'Zöldhályog', parts: ['aqueous'] },
    { id: 'retina', label: 'Érhártya, ideghártya, sárgafolt', parts: ['choroid', 'retina', 'macula'] },
    { id: 'optic', label: 'Látóideg', parts: ['optic'] },
    { id: 'lens', label: 'Szemlencse', parts: ['lens', 'ciliary'] },
    { id: 'vitreous', label: 'Üvegtest', parts: ['vitreous'] },
    { id: 'muscles', label: 'Szemmozgató izmok', parts: [] },
    { id: 'lids', label: 'Szemhéj, könnyrendszer', parts: ['conjunctiva'] }
  ];

  /* g: csoport · urgent: sürgős ellátást igényel · text: bevezető ·
     facts: [címke, szöveg] párok (tünetek, szövődmény, kezelés…) */
  var DISEASES = [
    /* ── Szaruhártya ─────────────────────────────────────────────────── */
    {
      g: 'cornea', name: 'Szaruhártya-gyulladás', latin: 'Keratitis',
      text: 'A szaruhártya normális állapotban teljesen érmentes és tükröző felszínű, a szem legfontosabb fénytörő közege (kb. +43 dioptria). Gyulladása a mélységtől függően kétféle lehet.',
      facts: [
        ['Felszínes forma', 'a hámréteget és a Bowman-membránt érinti.'],
        ['Mély forma', 'a szaruhártya saját állományába (stroma) terjed.'],
        ['Kezelés', 'szemcseppek, terápiás kontaktlencse; súlyos esetben szaruhártya-átültetés.']
      ]
    },
    {
      g: 'cornea', urgent: true, name: 'Szaruhártyafekély', latin: 'Ulcus corneae',
      text: 'Szövethiánnyal járó, gyakran gennyes folyamat. Leggyakrabban bakteriális, vírusos (pl. Herpes simplex) vagy gombás eredetű.',
      facts: [
        ['Veszély', 'a mélyülő fekély átlyukaszthatja a szaruhártyát (perforáció). Ilyenkor a csarnokvíz elfolyik, a szivárványhártya előreesik, és súlyos belső szemfertőzés (Endophthalmitis, Panophthalmitis) alakulhat ki, ami a szem elvesztésével járhat.'],
        ['Kezelés', 'szemcseppek, terápiás kontaktlencse, szaruhártya-átültetés (Keratoplastica: lamelláris vagy perforáló).']
      ]
    },
    {
      g: 'cornea', name: 'Kóros érbenövés a szaruhártyába', latin: 'Neovascularisatio',
      text: 'Az egészséges szaruhártyában nincs ér. Gyulladás vagy tartós oxigénhiány esetén azonban erek nőhetnek be.',
      facts: [
        ['Felszínes ereződés', 'a kötőhártya felől növekszik be, faágszerűen elágazó erekkel.'],
        ['Mély ereződés', 'az ínhártya felől lép be, ecsetszerű vagy seprűszerű, párhuzamos érkötegekkel.']
      ]
    },
    {
      g: 'cornea', name: 'Szaruhártya-hegek', latin: 'Macula, Leucoma',
      text: 'Gyulladás vagy sérülés után a szaruhártya átlátszósága csökkenhet.',
      facts: [
        ['Macula', 'enyhébb, szürkés homály.'],
        ['Leucoma', 'sűrű, fehér, mészszerű átlátszatlan heg a stromában.']
      ]
    },
    {
      g: 'cornea', name: 'Keratoconus', latin: 'Keratoconus',
      text: 'A szaruhártya középső részének kúp alakú elvékonyodása és előboltosulása. Súlyos, fokozódó, szabálytalan asztigmiát okoz, amely szemüveggel nehezen korrigálható.',
      facts: [
        ['Kezelés', 'kemény kontaktlencse vagy cross-linking kezelés, végső esetben szaruhártya-átültetés.']
      ]
    },
    {
      g: 'cornea', name: 'Alak- és méreteltérések', latin: 'Keratoglobus, Megalocornea, Microcornea',
      text: 'Ritkább, jórészt veleszületett eltérések.',
      facts: [
        ['Keratoglobus', 'a teljes szaruhártya gömbszerű, vékony előboltosulása.'],
        ['Megalocornea', 'veleszületetten megnagyobbodott átmérő (13 mm felett).'],
        ['Microcornea', 'kisméretű szaruhártya (10 mm átmérő alatt).']
      ]
    },

    /* ── Ínhártya ────────────────────────────────────────────────────── */
    {
      g: 'sclera', name: 'Felszínes ínhártya-gyulladás', latin: 'Episcleritis',
      text: 'A szem külső, kemény, védő rostos burkának felszínes gyulladása.',
      facts: [
        ['Tünetek', 'vörös, körülírt csomó vagy diffúz vérbőség, enyhe fájdalom.'],
        ['Lefolyás', 'gyakran spontán gyógyul, de reumatoid arthritis vagy más szisztémás autoimmun állapot kísérője lehet.']
      ]
    },
    {
      g: 'sclera', urgent: true, name: 'Mély ínhártya-gyulladás', latin: 'Scleritis',
      text: 'A mély ínhártyaszövet heves, fúró jellegű fájdalommal járó gyulladása.',
      facts: [
        ['Társuló betegségek', 'kötőszöveti autoimmun betegségek (RA, SLE, Granulomatosis polyangiitisszel), szisztémás vasculitis, TBC.'],
        ['Veszély', 'kezeletlenül az ínhártya elvékonyodását, perforációját okozhatja.']
      ]
    },
    {
      g: 'sclera', name: 'Ínhártya-kitüremkedés', latin: 'Staphyloma',
      text: 'Az ínhártya kóros elvékonyodása, amelyen keresztül a sötét érhártya kitüremkedik.',
      facts: [
        ['Okai', 'extrém tengelyi rövidlátásnál hátul (staphyloma posticum), vagy sérülés, gyulladás után.']
      ]
    },

    /* ── Szivárványhártya és sugártest ───────────────────────────────── */
    {
      g: 'uvea', urgent: true, name: 'Szivárványhártya- és sugártest-gyulladás', latin: 'Iridocyclitis, Uveitis anterior',
      text: 'A szivárványhártya és a sugártest együttes gyulladása. A szivárványhártya szabályozza a pupillán át a szembe jutó fény mennyiségét.',
      facts: [
        ['Tünetek', 'ciliáris vérbőség (mély, lilásvörös gyűrű a szaruhártya körül), heves szemfájdalom, erős fénykerülés, homályos látás.'],
        ['Szemészeti lelet', 'Tyndall-jelenség (fehérjék és sejtek lebegnek a csarnokvízben), precipitátumok (sejtes lerakódások a szaruhártya belső felszínén).'],
        ['Szövődmény', 'hátsó összenövések (Synechia posterior): a szivárványhártya hátsó felszíne rátapad a lencse elülső tokjára. Ez elzárhatja a csarnokvíz útját, ami másodlagos zöldhályogot eredményez.']
      ]
    },
    {
      g: 'uvea', name: 'Eltérő szivárványhártya-szín', latin: 'Heterochromia iridis',
      text: 'A két szem szivárványhártyájának eltérő színezete.',
      facts: [
        ['Eredete', 'lehet veleszületett vagy szerzett (pl. Horner-szindróma, Fuchs-féle heterochromiás iridocyclitis).']
      ]
    },

    /* ── Zöldhályog ──────────────────────────────────────────────────── */
    {
      g: 'glaucoma', urgent: true, name: 'Akut zárt zugú glaukóma (glaukómás roham)', latin: 'Glaucoma acutum',
      text: 'A szem belső folyadéknyomása (normál érték: 10–21 Hgmm) tartósan vagy hirtelen megemelkedik, ami a látóidegrostok pusztulásához, a látótér szűküléséhez és vaksághoz vezet. Rohamban a csarnokzug hirtelen elzáródik, a csarnokvíz elfolyása leáll, a szemnyomás pedig 50–100 Hgmm-re szökik.',
      facts: [
        ['Tünetek', 'elviselhetetlen féloldali szem-, homlok- és halántéktáji fejfájás, hányinger, hányás, a látásélesség drasztikus zuhanása, színes szivárványkarikák (halo-jelenség) a fényforrások körül, kőkemény tapintatú szemgolyó, tág, fénymerev pupilla.'],
        ['Sürgősségi állapot', 'órákon belüli orvosi ellátás szükséges a látóideg végleges elhalásának elkerülésére.']
      ]
    },
    {
      g: 'glaucoma', name: 'Krónikus nyitott zugú glaukóma', latin: 'Glaucoma simplex',
      text: '45 éves kor felett gyakori, lassan kialakuló forma. Teljesen fájdalmatlan és tünetszegény, ezért alattomos.',
      facts: [
        ['Oka', 'a csarnokzug szűrőrendszerének (trabeculáris hálózat) elöregedése vagy elzáródása.'],
        ['Lefolyás', 'a perifériás látótérben kezdődnek a kiesések (skotómák), és a látótér észrevétlenül szűkül. Mire a páciens észreveszi, a látóidegrostok nagy része elhalt.'],
        ['Megelőzés', 'rendszeres szemnyomás- és látótér-szűrés.']
      ]
    },
    {
      g: 'glaucoma', name: 'Veleszületett zöldhályog', latin: 'Buphthalmus, Hydrophthalmus',
      text: 'Csecsemőknél a még rugalmas ínhártya a magas nyomás miatt kitágul („ökörszem”), a szaruhártya pedig matt, opálos lesz.'
    },
    {
      g: 'glaucoma', name: 'Másodlagos glaukómák', latin: 'Glaucoma secundarium',
      text: 'Más betegség vagy sérülés következményeként emelkedik meg a szemnyomás.',
      facts: [
        ['Típusai', 'traumás, gyulladásos (synechiák miatti), lencseeredetű vagy neovascularis (pl. cukorbetegség talaján).']
      ]
    },

    /* ── Érhártya, ideghártya, sárgafolt ─────────────────────────────── */
    {
      g: 'retina', name: 'Érhártya-gyulladás', latin: 'Chorioretinitis (hátsó uveitis)',
      text: 'Mély gyulladás, amely kívülről egyáltalán nem látszik vörösnek. Az érhártya táplálja a retina külső rétegeit.',
      facts: [
        ['Tünetek', 'homályos látás, torzlátás (Metamorphopsia), látótérkiesés (Scotoma).']
      ]
    },
    {
      g: 'retina', name: 'Érhártya-daganat', latin: 'Melanoma malignum uveae',
      text: 'A felnőttkorban leggyakoribb elsődleges, a szem belsejében kialakuló rosszindulatú daganat. Gyakran tünetmentes, ezért rutin szemfenékvizsgálaton derülhet ki.'
    },
    {
      g: 'retina', name: 'Magas vérnyomás okozta szemfenékelváltozás', latin: 'Retinopathia hypertonica',
      text: 'Tartós magas vérnyomás következtében az artériák megnyúlnak és szűkülnek.',
      facts: [
        ['A szemfenéken', 'érkereszteződési tünetek (Salus–Gunn tünet), vérzések és fehér „vattacsomók” jelennek meg.']
      ]
    },
    {
      g: 'retina', name: 'Cukorbetegség okozta szemfenékelváltozás', latin: 'Retinopathia diabetica',
      text: 'A cukorbetegség szövődménye, felnőttkorban a vakság egyik vezető oka.',
      facts: [
        ['A szemfenéken', 'mikroaneurizmák, kemény exsudatumok, üvegtesti vérzések és kóros új erek képződése.'],
        ['Megelőzés', 'cukorbetegeknek rendszeres szemfenékvizsgálat szükséges.']
      ]
    },
    {
      g: 'retina', urgent: true, name: 'Ideghártya-leválás', latin: 'Ablatio retinae',
      text: 'Az érzékhám (neuroretina) elválik a pigmenthám rétegtől.',
      facts: [
        ['Vészjelző tünetek', 'fényvillanások, szikralátás (fotopszia), hirtelen megjelenő fekete lebegő foltok („koromhullás”), majd a periféria felől leereszkedő sötét „függöny” a látótérben.'],
        ['Kezelés', 'azonnali műtétet igényel.']
      ]
    },
    {
      g: 'retina', name: 'Időskori makuladegeneráció (AMD)', latin: 'Degeneratio maculae senilis',
      text: 'Az éleslátás központjának (macula lutea, fovea centralis) degenerációja. A centrális éleslátást, vagyis az olvasási képességet és az arcfelismerést teszi tönkre.',
      facts: [
        ['Száraz forma', 'sorvadásos, lassan romló központi látás.'],
        ['Nedves forma', 'kóros érnövekedéssel és ödémával jár, gyorsabban ront a látáson.']
      ]
    },
    {
      g: 'retina', name: 'Retinitis pigmentosa', latin: 'Retinitis pigmentosa',
      text: 'Örökletes betegség, amely a pálcikák pusztulásával kezdődik.',
      facts: [
        ['Lefolyása', 'farkasvakság (nyctalopia), majd koncentrikus látótér-beszűkülés („csőlátás”) és vakság.']
      ]
    },

    /* ── Látóideg ────────────────────────────────────────────────────── */
    {
      g: 'optic', urgent: true, name: 'Pangásos papilla', latin: 'Papillaödéma',
      text: 'Megnövekedett koponyaűri nyomás (pl. agydaganat, agyvérzés, hydrocephalus) hatására a látóidegfő előreboltosul, a határai elmosódnak.',
      facts: [
        ['Figyelem', 'életveszélyes neurológiai állapot tünete, azonnali kivizsgálást igényel.']
      ]
    },
    {
      g: 'optic', urgent: true, name: 'Látóideg-gyulladás', latin: 'Neuritis nervi optici (retrobulbaris neuritis)',
      text: 'A látóideg gyulladása. Gyakran a Sclerosis multiplex (SM) legelső tünete, vagy szervezetbeli gócfertőzések kísérője.',
      facts: [
        ['Tünetek', 'szemmozgatáskor jelentkező tompa fájdalom, hirtelen látásromlás, színlátási zavarok.']
      ]
    },
    {
      g: 'optic', name: 'Toxikus látóideg-károsodás', latin: 'Neuropathia optica toxica',
      text: 'Mérgező anyagok vagy gyógyszerek károsítják a látóideget.',
      facts: [
        ['Okok', 'metilalkohol (fakult mérgezésnél a látóideg azonnali bénulása és vakság), krónikus etilalkohol- és dohányfogyasztás (Amblyopia tabacica-alcoholica), nehézfémek (ólom, arzén), bizonyos gyógyszerek.']
      ]
    },
    {
      g: 'optic', name: 'Látóideg-sorvadás', latin: 'Atrophia nervi optici',
      text: 'A látóidegrostok végleges elhalása. A látóidegfő porcelánfehérré válik, a látásvesztés funkcionálisan visszafordíthatatlan.'
    },

    /* ── Szemlencse ──────────────────────────────────────────────────── */
    {
      g: 'lens', name: 'Szürkehályog', latin: 'Cataracta',
      text: 'A szemlencse anyagának vagy tokjának elhomályosodása. A lencse átlátszó, kétszerte domború törőközeg (nyugalomban kb. +19–+20 dioptria), amely az alkalmazkodásért felel.',
      facts: [
        ['Formái', 'időskori (Cataracta senilis, a leggyakoribb); veleszületett (pl. terhesség alatt átvészelt anyai rubeola miatt); traumás és sugárzási (sérülés, UV, infravörös sugárzás, „üvegfúvók hályoga”, röntgen); szövődményes (cukorbetegség, elhúzódó uveitis, tartós szteroidkezelés).'],
        ['Kezelés', 'műtét: fakoemulzifikáció (a saját lencse ultrahangos elfolyósítása) és mesterséges műlencse (IOL) beültetése. Később fellépő utóhályog esetén Nd:YAG lézeres kapszulotómia.']
      ]
    },
    {
      g: 'lens', name: 'A szürkehályog csalóka előjele: a „második látás”', latin: 'Indexes miópia',
      text: 'Kezdődő magi szürkehályognál a lencsemag sűrűbbé válik, törésmutatója megugrik, ami rövidlátó (mínuszos) irányba tolja a szem fénytörését. Az idős ember hirtelen úgy érzi, „megjavult a szeme”, mert szemüveg nélkül is el tudja olvasni az újságot. Ez valójában a szürkehályog kifejlődésének csalóka jele.'
    },
    {
      g: 'lens', name: 'Lencse helyzeti rendellenességei', latin: 'Subluxatio lentis, Luxatio lentis',
      text: 'A lencsét a lencsefüggesztő rostok (Zonula Zinnii) tartják a helyén.',
      facts: [
        ['Subluxatio', 'a rostok részleges szakadása, a lencse oldalra billen (pl. Marfan-szindróma esetén).'],
        ['Luxatio', 'a lencse teljes ficama az üvegtestbe vagy az elülső csarnokba.']
      ]
    },
    {
      g: 'lens', name: 'Öregszeműség', latin: 'Presbyopia',
      text: 'A szemlencse természetes, élettani öregedési folyamata, amely 40–45 éves kor körül mindenkinél jelentkezik. A lencse tömörül és elveszíti rugalmasságát, a sugárizom tónusa csökken, ezért a szem nem képes a lencsét kellően domborítani. A közelpont eltávolodik a szemtől (30 cm-ről 40, 50, 70 cm-re vagy még távolabbra), ezért „rövidül a kéz”.',
      facts: [
        ['Távollátóknál', 'jóval korábban, akár 35–40 évesen is panaszt okoz, mert az alkalmazkodási tartalékot már a távoli éleslátás is felemészti.'],
        ['Rövidlátóknál', 'egy kb. –2,50 – –3,00 dioptriás rövidlátó távolpontja természetes módon 33–40 cm-nél van, ezért szemüveg nélkül még 50–60 évesen is jól olvas.'],
        ['Korrekció', 'olvasószemüveg (pluszos addíció), bifokális vagy progresszív (multifokális) lencse.']
      ]
    },
    {
      g: 'lens', name: 'Ál-rövidlátás (akkomodatív miópia)', latin: 'Pseudomyopia',
      text: 'Nem valódi fénytörési hiba, hanem a sugárizom (M. ciliaris) görcsös összehúzódása hosszas közeli munka (pl. túlzott monitorhasználat) következtében. Pupillatágításos (cikloplegiás) vizsgálattal leleplezhető.'
    },

    /* ── Üvegtest ────────────────────────────────────────────────────── */
    {
      g: 'vitreous', name: 'Úszkáló foltok', latin: 'Mouches volantes',
      text: 'Lebegő „legyek”: apró kollagénrost-összecsapzódások az üvegtestben, amelyek árnyékot vetnek a retinára. Többnyire ártalmatlanok, de ha hirtelen sok új folt, villanás vagy sötét kieső mező jelenik meg, azonnal szemészhez kell fordulni.'
    },
    {
      g: 'vitreous', name: 'Csillogó üvegtesti kristályok', latin: 'Asteroid hyalosis',
      text: 'Kalcium- és zsírsav-vegyületekből álló, csillogó kristályok az üvegtestben.'
    },
    {
      g: 'vitreous', name: 'Koraszülöttek retinopátiája', latin: 'Retinopathia praematurorum (ROP)',
      text: 'Az inkubátorban adott magas koncentrációjú oxigén miatt az érhálózat fejlődése leáll, majd reaktív, kóros érnövekedés és hegesedés indul be, ami vakságot okozhat. Ezért kötelező a koraszülöttek szemészeti szűrése.'
    },

    /* ── Szemmozgató izmok ───────────────────────────────────────────── */
    {
      g: 'muscles', name: 'Bénulásos kancsalság', latin: 'Strabismus paralyticus',
      text: 'Az érintett izom működése kiesik.',
      facts: [
        ['Tünetek', 'kettőslátás (Diplopia), kényszerfejtartás, és a szem az érintett izom működésének irányában nem mozdul.']
      ]
    },
    {
      g: 'muscles', name: 'Kísérő kancsalság', latin: 'Strabismus concomitans',
      text: 'A kancsalsági szög minden tekintési irányban azonos. Gyermekkorban az agy a kancsal szem képét elnyomja, és kezelés nélkül a szem tompalátóvá (amblyopia) válik.',
      facts: [
        ['Fontos', 'a kezelést minél korábban meg kell kezdeni, ezért gyerekeknél a korai szemvizsgálat különösen fontos.']
      ]
    },
    {
      g: 'muscles', name: 'Szemtekerezgés', latin: 'Nystagmus',
      text: 'Akaratlan, ritmikus, oszcilláló szemmozgások.',
      facts: [
        ['Okai', 'veleszületett eltérés, belső fül (vesztibuláris) vagy kisagyi elváltozás.']
      ]
    },

    /* ── Szemhéj, könnyrendszer, szemgödör ───────────────────────────── */
    {
      g: 'lids', name: 'Árpa', latin: 'Hordeolum',
      text: 'A Zeis- vagy Moll-mirigyek heveny, bakteriális (staphylococcus), gennyes, kifejezetten fájdalmas gyulladása (külső árpa), vagy a Meibom-mirigyek akut gyulladása (belső árpa).'
    },
    {
      g: 'lids', name: 'Jégárpa', latin: 'Chalazion',
      text: 'A Meibom-mirigy kivezetőcsövének elzáródása miatt visszamaradt váladék által kiváltott krónikus, fájdalmatlan csomó (lipogranuloma) a szemhéjban.'
    },
    {
      g: 'lids', name: 'Befelé és kifelé fordult szemhéj', latin: 'Entropium, Ectropium',
      text: 'A szemhéjszél helyzetének eltérése.',
      facts: [
        ['Entropium', 'a szemhéjszél befelé fordul; a pillaszőrök súrolják a szaruhártyát, ami fekélyt idézhet elő.'],
        ['Ectropium', 'a szemhéjszél kifelé fordul; a könnypont elemelkedik a szemgolyótól, folyamatos könnycsorgást okozva.']
      ]
    },
    {
      g: 'lids', name: 'Csüngő szemhéj', latin: 'Ptosis',
      text: 'A felső szemhéj csüngése, például a harmadik agyideg (n. oculomotorius) sérülése vagy Myasthenia gravis miatt.'
    },
    {
      g: 'lids', name: 'Hiányos szemhéjzáródás', latin: 'Lagophthalmus',
      text: 'A szemrés tökéletlen záródása, például arcidegbénulás (n. facialis paresis) miatt. A szaruhártya kiszáradhat és kifekélyesedhet (Keratitis e lagophthalmo).'
    },
    {
      g: 'lids', name: 'Száraz szem szindróma', latin: 'Keratoconjunctivitis sicca',
      text: 'A könnyfilm minőségi vagy mennyiségi elégtelensége: égő, szúró érzés, váltakozóan homályos látás, különösen képernyő előtt.'
    },
    {
      g: 'lids', name: 'Könnymirigy-gyulladás', latin: 'Dacryoadenitis',
      text: 'A könnymirigy gyulladása, jellegzetes duzzadt, S-alakú felső szemhéjszéllel.'
    },
    {
      g: 'lids', name: 'Könnytömlő-gyulladás', latin: 'Dacryocystitis',
      text: 'A könnytömlő elzáródása és gyulladása. A belső szemzug alatt fájdalmas, vörös duzzanat alakul ki, amiből nyomásra genny ürül.'
    },
    {
      g: 'lids', name: 'Kidülledő szemgolyó', latin: 'Exophthalmus',
      text: 'A szemgolyó kóros előredülledése. Leggyakrabban a Basedow-kór (pajzsmirigy-túlműködés, endokrin orbitopathia) vagy szemgödri daganat okozza.'
    }
  ];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function init() {
    var filterBox = document.getElementById('eye-disease-filters');
    var listBox = document.getElementById('eye-disease-list');
    var countEl = document.getElementById('eye-disease-count');
    if (!filterBox || !listBox) return null;

    var current = 'all';

    function render() {
      listBox.textContent = '';
      var shown = 0;

      DISEASES.forEach(function (d) {
        if (current !== 'all' && d.g !== current) return;
        shown++;

        var item = el('details', 'eye-disease' + (d.urgent ? ' eye-disease--urgent' : ''));
        var summary = el('summary', 'eye-disease__summary');
        var head = el('span', 'eye-disease__head');
        var nameLine = el('span', 'eye-disease__name', d.name);
        if (d.urgent) nameLine.appendChild(el('span', 'eye-disease__tag', 'Sürgős ellátást igényel'));
        head.appendChild(nameLine);
        head.appendChild(el('span', 'eye-disease__latin', d.latin));
        summary.appendChild(head);
        summary.appendChild(el('span', 'eye-disease__chevron'));
        item.appendChild(summary);

        var body = el('div', 'eye-disease__body');
        body.appendChild(el('p', 'eye-disease__text', d.text));
        if (d.facts && d.facts.length) {
          var dl = el('dl', 'eye-disease__facts');
          d.facts.forEach(function (f) {
            if (f.length > 1) {
              dl.appendChild(el('dt', null, f[0]));
              dl.appendChild(el('dd', null, f[1]));
            }
          });
          body.appendChild(dl);
        }
        item.appendChild(body);
        listBox.appendChild(item);
      });

      if (countEl) countEl.textContent = shown + ' elváltozás';
    }

    function setFilter(id) {
      current = id;
      Array.prototype.forEach.call(filterBox.children, function (btn) {
        var active = btn.getAttribute('data-group') === id;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      render();
    }

    [{ id: 'all', label: 'Mind' }].concat(GROUPS).forEach(function (g) {
      var btn = el('button', 'eye-disease-filter', g.label);
      btn.type = 'button';
      btn.setAttribute('data-group', g.id);
      btn.addEventListener('click', function () { setFilter(g.id); });
      filterBox.appendChild(btn);
    });

    setFilter('all');

    return {
      /* Az ábrán kiválasztott szemrészhez tartozó csoportot mutatja; ha nincs
         ilyen (vagy nincs kijelölés), az összes elváltozást. */
      showForPart: function (partId) {
        var group = 'all';
        GROUPS.forEach(function (g) {
          if (partId && g.parts.indexOf(partId) !== -1) group = g.id;
        });
        setFilter(group);
      }
    };
  }

  var api = null;
  global.EyeDiseases = {
    init: function () { api = init(); return api; },
    showForPart: function (partId) { if (api) api.showForPart(partId); }
  };
})(window);
