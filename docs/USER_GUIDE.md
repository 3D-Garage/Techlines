# Techlines webáruház felhasználói útmutató

A weboldal napjainkban ellenőrzött működéssel rendelkezik, és a fejlesztési környezetben helyi megjelenítéssel elérhető: http://localhost:3001

A referencia projekt a React + Chakra UI alapú e-kereskedelmi felületet mutatja be, és jól használható bővítésre a saját webshopedben. A funkciók átvehetők, a stílus azonban a saját designedhez igazítható.

## 1. A projekt felépítése és bővíthetőség

A funkcionális modulok a következő fájlokban találhatók:

- Navigáció, kezdőlap: [client/src/components/Navbar.jsx](../client/src/components/Navbar.jsx), [client/src/screens/LandingScreen.jsx](../client/src/screens/LandingScreen.jsx)
- Terméklista: [client/src/screens/ProductsScreen.jsx](../client/src/screens/ProductsScreen.jsx), [client/src/components/ProductCard.jsx](../client/src/components/ProductCard.jsx)
- Kosár: [client/src/screens/CartScreen.jsx](../client/src/screens/CartScreen.jsx)
- Login / regisztráció: [client/src/screens/LoginScreen.jsx](../client/src/screens/LoginScreen.jsx), [client/src/screens/RegistraionScreen.jsx](../client/src/screens/RegistraionScreen.jsx)
- Checkout: [client/src/screens/CheckOutScreen.jsx](../client/src/screens/CheckOutScreen.jsx)
- API és backend: [server/routes/productRoutes.js](../server/routes/productRoutes.js), [server/routes/userRoutes.js](../server/routes/userRoutes.js)

Ez azt jelenti, hogy a weboldal funkciói már rendelkezésre állnak, és a designed a saját arculatodra szabd acélozással megőrizhető.

---

## 2. Használati útmutató a weboldalról

### 2.1 Főoldal / Kezdőlap

A kezdőoldal a webshop első benyomását adja. A felhasználó itt látja a márkát, a fő üzenetet és a legfontosabb call-to-action gombot.

A kezdőlap fő elemei:
- logó és márkanév a bal felső sarokban,
- fő szöveg: „Bringing your ideas to life, one layer at a time”,
- CTA gomb: „Discover now”,
- nagy hero kép a jobb oldalon,
- navigációs menü a tetején.

Screenshot 1 — kezdőlap
- Bal oldalon: brand + főszöveg + CTA gomb
- Jobb oldalon: 3D nyomtatóhoz kapcsolódó képi elemek
- Felső sávban: Products, Cart, Sign In, Sign Up

A kezdőlap célja, hogy a látogató azonnal megértse: ez egy 3D nyomtatási/technológiai webshop, és rögtön tovább tud menni a termékekhez.

---

### 2.2 Termékek oldala

A termékek oldal az e-kereskedelmi felület legfontosabb része. Itt a felhasználó megtekintheti az összes elérhető terméket.

A termékoldalon látható:
- termék képe,
- név,
- ár,
- értékelés (csillagok),
- „Add to cart” gomb,
- új termék vagy sold out jelölés.

Ha a termék már a kosárban van, a rendszer értesítést ad a felhasználónak, hogy ne duplikálja a terméket.

Screenshot 2 — terméklista
- Kártyák egyenletes rácsban,
- termék kép és cím,
- ár és értékelés,
- jobb oldalon kosár ikon a gyors hozzáadáshoz.

A felhasználó innen a termék részletes oldalára is léphet, ahol tovább bővebb információt kap a termékről.

---

### 2.3 Termék részletes oldal

A termék részleteinél a felhasználó a következő információkat tekintheti meg:
- termék név,
- részletes leírás,
- ár,
- készletinformáció,
- mennyiségválasztás,
- „Add to cart” gomb.

Ez a rész a vásárlás döntését támogató oldal, ezért a tömör és jól olvasható elrendezés fontos.

Screenshot 3 — termék részletes nézet
- termék nagy képe,
- leírás szövege,
- darabszám választó,
- kosárba helyezés gomb.

---

### 2.4 Kosár oldal

A kosár az a hely, ahol a felhasználó ellenőrzi, módosítja és véglegesíti a kiválasztott termékeket.

A kosárban a felhasználó:
- látja a termékeket,
- módosíthatja a darabszámot,
- eltávolíthatja a terméket,
- megnézheti az összesített árat,
- tovább tud lépni a checkoutre.

Ha a kosár még üres:
- megjelenik egy üzenet,
- közvetlen link a termékek oldalára.

Screenshot 4 — kosár
- középen a produktek listája,
- jobb oldalon összegezés,
- „Checkout” felirat és gomb.

---

### 2.5 Bejelentkezés

A bejelentkezéshez a felhasználó megadja az email címét és a jelszót. A rendszer ellenőrzi a hitelesítő adatokat, és a sikeres bejelentkezés után a felhasználó továbbjut a terméklistához vagy a korábban megnyitott oldalra.

A bejelentkezési űrlap elemei:
- Email mező,
- Password mező,
- Sign in gomb,
- link a regisztrációhoz.

Screenshot 5 — bejelentkezés
- középen nagy, jól olvasható űrlap,
- lila színű fő gomb,
- „Don’t have an account? Sign up” link.

---

### 2.6 Regisztráció

Új felhasználók számára a regisztrációs oldalon meg kell adni:
- teljes nevet,
- email címet,
- jelszót,
- jelszó megerősítést.

A rendszer ellenőrzi:
- hogy a mezők ki vannak-e töltve,
- hogy az email helyes formátumú-e,
- hogy a jelszavak megegyeznek-e,
- és hogy a jelszó elegendően hosszú-e.

Screenshot 6 — regisztráció
- „Create an account” cím,
- mezők: Full name, Email, Password, Confirm your password,
- Sign up gomb.

---

### 2.7 Profil oldal

A profiloldalon a felhasználó tudja frissíteni az adatait. Itt például:
- a név módosítása,
- email frissítése,
- új jelszó beállítása,
- profile mentése.

Ez különösen fontos, ha a felhasználó szeretné frissíteni vagy ellenőrizni a fiókadatait.

Screenshot 7 — profil
- név és email mezők,
- jelszó mező,
- mentés gomb.

---

### 2.8 Checkout / fizetés

A checkout az utolsó lépés a vásárlási folyamatban. Itt a felhasználó ellenőrzi
- a kosár tartalmát,
- a rendelés összegét,
- a szállítási adatokhoz kapcsolódó felületet,
- a fizetési lehetőséget.

A projektben a PayPal integráció is megjelenik, ezért ez a funkció jó alap a valódi online pénzügyi végrehajtáshoz.

Screenshot 8 — checkout
- bal oldalon szállítási információk,
- jobb oldalon összesítés,
- fizetés / rendelés gomb.

---

## 3. A saját projektben történő bővítés módja

A legjobb megoldás az, ha a funkciók maradnak, de a stílus a saját arculatodhoz igazodik.

### Javasolt lépésrendszer:

1. A funkciók átvétele
   - terméklista,
   - kosár,
   - profil,
   - login,
   - checkout.

2. A stílus leválasztása
   - színpaletta cseréje,
   - betűtípus és méretek beállítása,
   - gombok és input mezők designja,
   - card layout és margók átalakítása.

3. A saját brand felé igazítás
   - cégnév,
   - ikonok,
   - fő színek,
   - feliratok,
   - képek és termékkategóriák.

4. Testreszabás a vevői élményhez
   - különböző termékkategóriák,
   - ajánlott termékek,
   - kedvezmények,
   - részletes termékoldalak.

---

## 4. Összegzés

A referencia projektben a legértékesebb az, hogy már rendelkezésre áll a teljes e-kereskedelmi funkciókészlet:
- főoldal,
- termékek,
- kosár,
- login,
- regisztráció,
- profil,
- checkout,
- backend API.

A stílus azonban nem kötelező a meglévő lila/modern Chakra design. A saját projektedben ez a meglévő funkciókészletet használhatod fel, miközben megtartod a saját vizuális identitásodat.

Ha szeretnéd, a következő lépésben elkészíthetek egy konkrét "átalakítási tervet" is, hogy pontosan mely fájlokat kell átvenned a példaprojektből, és hogyan kell a saját stílusodhoz igazítani őket.
