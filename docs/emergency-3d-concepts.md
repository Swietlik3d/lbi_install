# LBI Elektra i Gas — projekty podstron z animacją 3D

Od 19.09.2026 zaakceptowane projekty są głównymi stronami trzech serwisów, z pełnymi treściami kolekcji Astro. Szczegóły integracji: [Główne landingi](landing-rollout.md).

Dodatkowe podglądy projektów rozwijających kierunek strony awarii wody:

- Prąd: http://127.0.0.1:4321/concept/elektra/
- Gaz: http://127.0.0.1:4321/concept/gas/
- Woda: http://127.0.0.1:4321/concept/water/

Menu „Water / Elektra / Gas” pozwala przełączać projekty. Teksty są po holendersku, zgodnie z witrynami LBI. Dane kontaktowe pochodzą z konfiguracji projektu.

## Wygląd i interakcja

**Elektra:** jasne tło, grafit, bursztynowe akcenty. Scena zawiera zamkniętą rozdzielnicę, cztery moduły, przewód i lampę. Etapy „Storing / Controle / Herstel” zmieniają pozycje przełączników, oznaczenie stanu i światło żarówki. Podczas awarii żarówka ledwo, ciepło żarzy; po naprawie świeci jasno.

**Gas:** ciepły beż, miedź i mosiądz. Scena zawiera rurę, zawór, manometr oraz pierścienie zaznaczające sprawdzane połączenie. Przy nieszczelności unosi się miękka, półprzezroczysta smuga gazu, która zanika podczas zamykania zaworu. Etapy „Onderzoek / Afsluiten / Controle” obracają dźwignię i zaznaczają sprawdzone połączenie. Po ostatnim etapie zawór pozostaje zamknięty. Manometr jest ilustracją bez liczbowego odczytu.

Obie strony mają pełne sekcje usług, sposobu pracy, FAQ i kontaktu. Model reaguje na ruch kursora. Od 19.09.2026 animacja startuje automatycznie, bez Play/Pause, również przy systemowym ograniczeniu ruchu — zgodnie z życzeniem autora projektu. Etapy zmieniają się co 3000 ms w pętli 1 → 2 → 3 → 1. Ręczny wybór myszą lub klawiaturą rozpoczyna nowe 3 sekundy. Scena zatrzymuje się poza widokiem oraz w ukrytej karcie, a zegar etapów wstrzymuje się w ukrytej karcie. Automatyczna zmiana nie ogłasza komunikatów czytnika ekranu co 3 sekundy.

Modele powstają proceduralnie w Three.js; nie pobierają zewnętrznych modeli ani tekstur. Przy braku WebGL lub błędzie pobrania modułu strona wyświetla SVG z działającymi etapami. Bez JavaScript pozostają treść, statyczna ilustracja, FAQ i kontakt, a przyciski animacji są ukryte.

## Informacje o awarii

Na stronie gazu komunikat bezpieczeństwa i telefon 0800-9009 poprzedzają ofertę LBI. Numer jest opisany jako połączenie z zewnątrz, z bezpiecznej odległości. Przy bezpośrednim zagrożeniu wskazano 112. Kontakt z LBI dotyczy prac po zabezpieczeniu sytuacji. W elektryce wyróżniono awarię sieci obejmującą również sąsiadów.

Treść sprawdzono na stronach Enexis:

- https://www.enexis.nl/storingen-en-onderhoud/meld-een-storing/gaslucht
- https://www.enexis.nl/storingen-en-onderhoud/meld-een-storing/stroomstoring
- https://www.enexis.nl/storingen-en-onderhoud/hoe-lost-enexis-gas-en-stroomstoringen-op

Nie dodano niepotwierdzonych certyfikatów, ocen, gwarancji dojazdu ani dostępności LBI przez całą dobę. Animacje pokazują ilustrację pracy fachowca.

## Uruchomienie

```powershell
npm run dev:lbi -- --host 127.0.0.1 --port 4321
```

Oddzielny build zawierający wszystkie trzy projekty:

```powershell
npx cross-env SITE_ID=lekkage INCLUDE_DESIGN_PREVIEWS=1 astro build --outDir ./dist/emergency-concepts
```

Standardowy build generuje nowe landingi pod `/` dla `lekkage`, `elektra` i `gas`, z `index,follow` i własnymi adresami canonical. Nie generuje tras `/concept/`; tylko dodatkowe podglądy mają `noindex,nofollow`. Ta zmiana nie publikuje witryn. Poniższe wcześniejsze wyniki opisują etapy powstawania prototypów; aktualny raport jest w `landing-rollout.md`.

## Sprawdzenie 19.09.2026

- PASS: `npm run check` — 0 błędów, 0 ostrzeżeń, jedna istniejąca wskazówka w `SchemaJsonLd.astro`.
- PASS: build prototypów zawierający wodę, prąd i gaz.
- PASS: WebGL startuje bez klikania; brak przycisków Play/Pause we wszystkich trzech projektach.
- PASS: pomiar w przeglądarce potwierdza pełną sekwencję 0 → 1 → 2 → 0; na każdej stronie dokładnie jeden etap jest aktywny.
- PASS: ręczny wybór etapu i klawiatura; opis stanu odpowiada wybranemu etapowi.
- PASS: wizualnie sprawdzona unosząca się smuga gazu i słabe żarzenie żarówki przy awarii.
- WARN: wspólny moduł Three.js ma 511,25 kB / 128,04 kB gzip; osobny moduł scen prądu/gazu 14,53 kB / 6,20 kB gzip. Pozostaje ostrzeżenie Vite o przekroczeniu progu 500 kB.

Dowody: `artifacts/emergency-concepts/autoplay-verification.json`, `gas-autoplay.png`, `elektra-dim-glow.png`.

## Sprawdzenie 18.09.2026 — wcześniejsza wersja z pauzą

| Wynik | Sprawdzenie |
| --- | --- |
| PASS | `npm run check`: 0 błędów, 0 ostrzeżeń, jedna istniejąca wskazówka w `SchemaJsonLd.astro`. |
| PASS | `npm run build:all`: wszystkie cztery witryny. |
| PASS | Osobny build prototypów zawiera wodę, prąd i gaz. |
| PASS | Normalne buildy nie zawierają tras prototypów ani odwołań do ich skryptów na stronach głównych. |
| PASS | Oba modele renderują się w WebGL; klatki zmieniają się podczas odtwarzania i pozostają identyczne po pauzie. |
| PASS | Trzy etapy, jedna aktywna opcja i opis stanu; obsługa klawiaturą. |
| PASS | Preferencja ograniczonego ruchu oraz jej zmiana w trakcie działania. |
| PASS | Widoki 1280, 390 i 320 px bez poziomego przepełnienia. |
| PASS | FAQ otwiera się kliknięciem i zamyka klawiszem Enter. |
| PASS | Nawigacja pomiędzy projektami, renderowanie dotychczasowej sceny wody. |
| PASS | Zablokowany moduł sceny: widoczna ilustracja SVG, działające etapy. |
| PASS | Wyłączony JavaScript: dostępne treść i kontakt, ukryte przyciski animacji. |
| WARN | Wspólny moduł Three.js ma 503,75 kB / 126,37 kB gzip. Vite zgłasza przekroczenie progu 500 kB. Moduł scen elektryki/gazu ma dodatkowo 13,56 kB / 5,82 kB gzip. Ładowanie 3D jest oddzielone od treści, a obecne strony produkcyjne go nie pobierają. |

Podglądy zapisano w `artifacts/emergency-concepts/`: `elektra-desktop.png`, `elektra-desktop-full.png`, `elektra-mobile.png`, `gas-desktop.png`, `gas-desktop-full.png`, `gas-mobile.png` oraz `gas-fallback.png`.

Główne pliki: `EmergencyConcept.astro`, `emergency-concepts.ts`, `emergency-concept.css`, `emergency-concept.ts`, `emergency-scene.ts` i wspólne `ConceptNavigation.astro`.
