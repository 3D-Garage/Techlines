# FOXPOST csomagautomata, kézi feladás

A katalógustermékek pénztárában a `shippingMethod` értéke `standard`, `express` vagy `foxpost`. A FOXPOST díja 1 490 Ft; 10 000 Ft vagy magasabb termékösszegnél ingyenes. Az egyedi nyomtatási kérelmek folyamata változatlan.

## Automatalista és kiválasztás

Hivatalos források: [választó dokumentációja](https://cdn.foxpost.hu/apt-finder/v1/documentation/), [beágyazott widget](https://cdn.foxpost.hu/apt-finder/v1/app/), [automatalista](https://cdn.foxpost.hu/foxplus.json), [feladási kód és telefonszám szabályai](https://foxpost.hu/uzleti-partnereknek/integracios-segedlet/tomeges-csomagfeltoltes).

`GET /api/shipping/foxpost/lockers` a `{ lockers: [...] }` választ adja. Az azonosító `place_id` (szöveg), a kézi feladáshoz használható célautomata-kód `operator_id`. A normalizált pillanatkép további mezői: `name`, `type` (`A-BOX` vagy `Z-BOX`), `address` (teljes cím), `street`, `city`, `postalCode`, `country`.

Csak `FOXPOST A-BOX` és `FOXPOST Z-BOX` típusú, `HU` országú, `pick up` szolgáltatású pontok engedélyezettek. A bezárt és `overloaded` pontok nem választhatók. A lista szerverenként egy órára kerül memóriába; a párhuzamos frissítések egy lekérést használnak. A lekérés időkorlátja 10 másodperc. Lejárt lista sikertelen frissítésekor a végpont és az új FOXPOST-fizetés 503-as hibát ad, elavult listával nem hoz létre fizetést.

A widget JSON üzeneteit a kliens csak `https://cdn.foxpost.hu` eredetről és az aktuális iframe ablakból fogadja el. Az üzenetből csak a pontazonosítót használja, a megjelenített pontot a szerver engedélyezett listájából veszi.

Az iframe betöltésére 20 másodperces időkorlát vonatkozik. A `load` esemény kizárólag a keret betöltését jelzi; a hivatalos dokumentáció nem ír le működéskész üzenetet. Belső térkép- vagy listahibát ezért nem próbálunk automatikusan felismerni. A segítségszöveg és az újratöltési gomb mindig elérhető; az ablak bezárása után másik szállítási mód választható.

## Fizetés és helyreállítás

FOXPOST esetén az új `POST /api/paypal/create-order` kérésben `items`, `requestId`, `expectedTotal`, `shippingMethod: "foxpost"`, `foxpostLockerId`, `recipientPhone` szükséges. Saját `shippingAddress` nem szükséges; a beküldött cím és automataadatok nem írják felül a hivatalos adatokat. A magyar mobiltelefonszám `+36` formára normalizálódik; elfogadott előhívók: 20, 30, 31, 50, 51, 70, utánuk hét számjeggyel. Ugyanez a szabály érvényes a felületen, a backendben és a rendelésmodellben. A címzett neve és e-mailje a hitelesített fiókból származik.

Minden szállítási mód új fizetésénél kötelező az `expectedTotal`, a megjelenített ajánlat egész forintos végösszege. A szerver újraszámolja az ajánlatot. Eltéréskor `409` válasz érkezik `{ code: "QUOTE_CHANGED", creationRejected: true, quote }` adatokkal, checkout-mentés és PayPal-hívás nélkül. A felület megmutatja a korábbi és az új végösszeget, frissíti az összesítést, és letiltja a fizetést az „Új összeg elfogadása” gomb megnyomásáig. Nincs automatikus fizetésindítás. Elfogadás után a következő kérés új `requestId`-t és az új `expectedTotal` értéket kapja. Újabb árváltozás újabb elfogadást igényel. A függő elfogadást a `checkoutQuoteChange:<userId>` kulcs újratöltés után is megőrzi.

Az `expectedTotal` nem része a bemeneti ujjlenyomatnak. A már mentett checkout ismétlése a rögzített ajánlatot használja, és régi kérés `expectedTotal` nélkül is folytatható.

A szerver a `(user, requestId)` párhoz tartós `CheckoutRequest` döntést ment. A létrehozási döntés és a checkout-pillanatkép ugyanabban a MongoDB-tranzakcióban készül; a végleges elutasítás külön döntést ment, checkout és PayPal-megrendelés nélkül. Az egyedi index több szerverpéldány között is egyetlen eredményt választ: ha az elutasítás nyer, későn befejeződő kérés sem hozhat létre fizetést; ha a checkout nyer, az ismétlés annak mentett összegét kapja. Az elutasított kérésazonosító ismétlése az eredeti hibát adja, ezért javított adatokkal is új `requestId` szükséges. A döntések nem járnak le. A korábban mentett checkoutok döntésrekord nélkül is folytathatók; adatbázis-visszatöltés nem szükséges.

Az új rendelés és a checkout-pillanatkép menti a szállítási módot, a normalizált telefonszámot és a teljes `foxpostLocker` objektumot. A hagyományos `shippingAddress` az automata utcájából, városából, irányítószámából és országából készül; ezt kapja a PayPal is. A rendeléslisták a teljes automata-címet mutatják. Az admin táblázat a célautomata-kódot és a telefonszámot is megjeleníti a kézi feladáshoz.

Az ismételt kérés az aggregált termékmennyiségeket, a szállítási módot, a pontazonosítót és a normalizált telefonszámot hasonlítja össze. Azonos kérés a már mentett pillanatképet használja új listalekérés nélkül. A lista későbbi változása vagy kiesése nem akadályozza a meglévő fizetés folytatását és visszaellenőrzését.

A pénztár piszkozatát a `shippingDraft:<userId>`, az aktív fizetést az `activeCheckout:<userId>` helyi tárkulcs őrzi. A házhozszállítási cím módváltáskor megmarad. Az előkészített és folyamatban lévő fizetés szállítási adatai zároltak. Új fizetéshez aktuális szerveroldali árajánlat, elérhető pont és érvényes telefonszám kell. Lista-, widget- és ajánlathiba esetén újratöltés lehetséges.

A szállítási űrlap csak az aktuális fiók piszkozatát tölti vissza. Be- és kijelentkezéskor a szállítási Redux-adatok és a kiválasztott szállítási mód alaphelyzetbe állnak, a fiókhoz tartozó helyi piszkozat és fizetéshelyreállítás viszont megmarad. Másik fiók nem örökölhet címet, telefonszámot vagy automatát a közös memóriabeli állapotból.

`CREATING`, `READY`, `PROCESSING`, `REVIEW` állapotban a tételek és a szállítási adatok zároltak. Kizárólag `READY` fizetés folytatható a PayPal-gombbal. Elveszett válasz esetén az eredeti kérés és a helyi automata-/telefonpillanatkép megmarad. `FAILED` és `EXPIRED` után az „Új fizetés előkészítése” gomb törli az aktív helyreállítási bejegyzést. Ez új ajánlatlekérést és FOXPOST-listaellenőrzést indít; a következő fizetés új kérésazonosítót használ.

### PayPal-megszakítás és a rendelés módosítása

A PayPal `onCancel` eseménye az előkészített fizetés szerveroldali megszakítását kéri a `POST /api/checkout/:id/cancel` végponton. A korábban beragadt vagy tovább már nem kívánt `READY` checkout a „Rendelés módosítása” gombbal is elhagyható. Ez a művelet kizárólag a saját checkoutra engedélyezett.

A megszakítás ugyanazt a feldolgozási zárat használja, mint a visszaigazolás és az egyeztető worker. Csak még nem feldolgozott, készletfoglalás és capture-kísérlet nélküli `READY` fizetést zár le. A PayPal-adatokat ellenőrzi; capture-bizonyíték vagy eltérés esetén `REVIEW` marad, hálózati hiba vagy párhuzamos feldolgozás esetén a helyreállítási bejegyzés megmarad. A puszta kliensoldali megszakítás nem bizonyítja, hogy pénzmozgás nem történt.

Ellenőrzött megszakításkor az eredeti pillanatkép megmarad, a checkout `FAILED` állapotot és `CHECKOUT_CANCELLED` jelzést kap. Az aktív helyi fizetés törlődik, a kosár és a szállítási piszkozat megmarad. A felület az aktuális kosarat mutatja, ismét engedi az automatacserét, új ajánlatot és FOXPOST-listát kér. A következő fizetés új checkoutot és kérésazonosítót használ. Elveszett megszakítási válasz esetén az állapotlekérés is felismeri a szerveren lezárt checkoutot. Későn érkező régi PayPal-esemény vagy állapotválasz nem írhatja felül az új fizetést.

A böngészőteszt SDK-adaptere külön szimulálja a tényleges `onCancel` eseményt és az esemény nélküli, bizonytalan ablakbezárást. Az előbbi feloldja a checkoutot; az utóbbi a mentett fizetés megőrzését ellenőrzi. [PayPal eseménydokumentáció](https://developer.paypal.com/sdk/js/v1/reference/).

## Kézi feladás és utólag használhatatlan automata

Az admin a mentett rendelésből veszi át a címzett nevét, e-mailjét, telefonszámát és az `operator_id` célautomata-kódot. Hiányzó `operator_id` esetén a pont eleve nem választható; a `place_id` nem helyettesítheti a feladási kódot.

Ha a fizetés után az automata használhatatlanná válik, az admin kapcsolatba lép a vásárlóval, és egyezteti a kézi feladást. Másik automatát kizárólag a vásárló jóváhagyásával választ, az egyeztetést a rendelésazonosítóhoz kapcsolva dokumentálja. Megállapodás hiányában a meglévő PayPal-visszatérítési folyamaton keresztül visszatérítést intéz. Az eredeti checkout-pillanatképet nem írja felül. Ez kézi eljárás; új adminfunkció nem készült hozzá.

A régi rendelések és fizetések új mezők nélkül is olvashatók; ismeretlen rendelési szállítási mód neve „Házhoz szállítás”. Adatbázis-visszatöltés nem szükséges.

## Ellenőrzés

- `npm run test:server`: backend, valós MongoDB tranzakciós checkout-integráció, determinisztikus FOXPOST-listával és PayPal-adapterrel.
- `npm test --prefix client -- --watchAll=false --runInBand`: frontend és widgetüzenetek tesztjei.
- `npm run build --prefix client`, majd `npm run test:browser`: determinisztikus checkout böngészőtesztek, mobil modális megjelenéssel is.
- `npm run test:foxpost:live`: külön élő ellenőrzés, a build elkészülte után. A hivatalos automatalistát és widgetet használja, a webshop végpontjait tesztadatokkal helyettesíti. Asztali (1440×1000) és mobil (390×844) képernyőn keres és választ automatát; a `.test-artifacts/foxpost-widget` könyvtárba képernyőképet ment. Nem indít valódi fizetést.

Automatikus csomaglétrehozás, címkenyomtatás, státuszkövetés és utánvét nincs ebben az integrációban.

### Ellenőrzött állapot – 2026. október 5.

157 backendteszt, 77 frontendteszt és 24 checkout-böngészőteszt sikeres; a frontend production build elkészült. A böngészőtesztek a növekvő és csökkenő ár elfogadását mindhárom szállítási módnál, az ismételt árváltozást, minden zárolt állapotot, a terminális állapot utáni újraindítást és az elveszett létrehozási válasz helyreállítását is lefedik.

A backend regressziós tesztjei mindhárom szállítási módnál késleltetik a korábbi kérés pillanatkép-validációját: a közben véglegesen elutasított kérésből később sem keletkezhet checkout vagy PayPal-megrendelés. Ellenőrzik az újraindítás utáni elutasítás-visszajátszást, a létrehozás győzelmét késleltetett árváltozási hiba ellen, a párhuzamos elutasításokat és a döntés tranzakciós visszagörgetését is. A frontend regressziós tesztjei a fiókváltás utáni üres szállítási adatokat és az eredeti fiók saját piszkozatának visszaállítását ellenőrzik.

A megszakítás regressziós tesztje tényleges PayPal `onCancel` eseményt szimulál, majd a webshop kosár- és termékoldali gombjaival törli az A terméket, hozzáadja a B terméket, új automatát választ, és új checkoutot indít. Külön teszt ellenőrzi a korábban beragadt `READY` fizetés kézi feloldását. Backendtesztek igazolják, hogy a megszakítás és a capture versenye ugyanazt a zárat használja, továbbá bizonytalan vagy már feldolgozott fizetés nem veszhet el.

Az élő hivatalos widget keresése és automatakiválasztása 1440×1000 asztali és 390×844 mobil nézetben is sikeres. Az ellenőrzés képernyőképei: `.test-artifacts/foxpost-widget/widget-1440.png` és `.test-artifacts/foxpost-widget/widget-390.png`.

### Élő teszt javítása és újraellenőrzése – 2026. október 7.

A korábbi időtúllépést az ellenőrző script okozta. A widget 400 ms-os billentyűfelengedés-kezelése és a térkép animációja mellett a gyors, csak helyi szűrést végző névkeresés találatai lecserélődhettek. Mobilon a részletekben lévő szöveges kiválasztógomb rejtett; az automata sorában külön ikonos gomb használható.

A javított teszt városra keres, a widget időzítéséhez igazodva gépel, és megvárja az Enterrel elküldött keresés tényleges HTTP-válaszát. Ellenőrzi, hogy a válasz tartalmazza a kívánt `place_id` értéket, és csak ennek az automatának a sorában használja az adott nézetben látható kiválasztógombot. A pénztárban a név és a cím mellett a mentett szállítási piszkozat automataazonosítóját és a választó bezáródását is ellenőrzi. Minden böngészőműveletnek időkorlátja van.

Három egymást követő futtatás sikeres volt mindkét nézetben, a valódi FOXPOST-listával, keresési végponttal és widgetüzenettel. Az alkalmazás integrációs kódját nem kellett módosítani; a teszt továbbra sem indít fizetést.
