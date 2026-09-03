/* A láblécben megjelenő évszám. Külön fájlban, nem a HTML-be írva:
   így a Content-Security-Policy `script-src 'self'` maradhat, azaz a
   böngésző SEMMILYEN oldalba ágyazott szkriptet nem futtat. Egy beszúrt
   `<script>alert(1)</script>` vagy `onerror=` ettől néma marad.

   Két azonosítót ismer, mert a két weboldal máshogy nevezte el. */
(function () {
  'use strict';
  var year = String(new Date().getFullYear());
  var ids = ['year', 'footer-year'];
  for (var i = 0; i < ids.length; i += 1) {
    var node = document.getElementById(ids[i]);
    if (node) node.textContent = year;
  }
})();
