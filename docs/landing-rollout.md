# Główne landingi LBI — 19.09.2026

Zaakceptowane projekty 3D są teraz stronami głównymi trzech mikroserwisów. `HomeLayout.astro` wybiera wodę, prąd lub gaz według `SITE_ID`. Główna witryna LBI i jej projekty zachowują dotychczasowy układ.

| Serwis | Lokalny podgląd głównej strony | Docelowa domena |
| --- | --- | --- |
| Woda / lekkage | http://127.0.0.1:4322/ | https://www.lekkage-reparatie-helmond.nl/ |
| Prąd / elektra | http://127.0.0.1:4323/ | https://www.elektrastoring-helmond.nl/ |
| Gaz | http://127.0.0.1:4324/ | https://www.gasleiding-service-helmond.nl/ |

Podglądy na portach 4322–4324 serwują pliki z `dist`; po zmianie treści należy ponownie zbudować serwis. Jeden serwer deweloperski LBI działa na 4321. Unikamy równoległych serwerów `astro dev` w tym samym katalogu, ponieważ na Windows potrafią kolidować przy zapisie `.astro/data-store.json`.

## Treści

Źródłem jest folder `lbi_installaties_contentpakket_split`. Przeniesiono komplet tekstów dla 15 stron, w tym 90 odpowiedzi FAQ, opisy usług, listy sytuacji wymagających kontaktu, cztery kroki działania i linki. Dokładne mapowanie oraz wyłączenia instrukcji redakcyjnych są w [microsite-content-map.md](microsite-content-map.md).

Treści znajdują się w `src/content/pages/{lekkage,elektra,gas}/`. H1, wprowadzenie, opisy, FAQ i CTA są pobierane z kolekcji Astro. CMS zachowuje wielowierszowe nagłówki oraz identyfikatory sekcji `wanneer-bellen` i `werkwijze`. Modele 3D i ich scenariusze pozostają w kodzie.

Nowe główne strony mają własne adresy canonical, `index,follow`, metadane udostępniania z rzeczywistymi obrazami i JSON-LD zgodny z widocznymi FAQ. Linki do usług są lokalne, a przejścia między różnymi serwisami wskazują ich docelowe domeny. Dodatkowe trasy `/concept/` są dostępne tylko w dev lub przy `INCLUDE_DESIGN_PREVIEWS=1`, z `noindex,nofollow`.

Animacje startują automatycznie, bez Play/Pause. Etapy zmieniają się co 3000 ms; wybór ręczny rozpoczyna nowy okres. Ukryta karta wstrzymuje zegar, a scena poza ekranem wstrzymuje renderowanie. Woda kapie, gaz unosi się, a żarówka podczas awarii ledwo żarzy. Brak WebGL pozostawia ilustrację SVG.

W serwisie gazowym informacja o bezpieczeństwie i kontakt 0800-9009 / 112 poprzedzają komercyjny kontakt z LBI, także na podstronach. Stopki nie pokazują zastępczych danych rejestrowych ani dawnych, niepotwierdzonych obietnic 24/7.

## Weryfikacja

- `npm run check:all`: PASS, cztery serwisy, 0 błędów i 0 ostrzeżeń. Pozostaje wcześniejsza wskazówka Astro o skrypcie JSON-LD.
- `npm run build:all`: cztery osobne statyczne witryny; raport w `artifacts/landing-rollout/build-all.log`.
- `node artifacts/landing-rollout/verify-landings.mjs`: sprawdza zgodność pełnej treści źródłowej z Markdown i HTML, 15 stron, 90 FAQ, 378 odnośników/zasobów, canonical, robots, sitemap, JSON-LD, brak placeholderów i pola CMS.
- Niezależny przegląd integracji: PASS po zastąpieniu redakcyjnego pytania o nieuzupełniony adres pytaniem o umówienie wizyty.
- Kontrola przeglądarkowa: główne strony w widokach desktop, 390 i 320 px, wszystkie podstrony w 320 px; FAQ i klawiatura; automatyczne cykle trzech etapów. Wyniki są w `artifacts/landing-rollout/browser-audit.json`, a obrazy w tym samym folderze. Test wykrył przepełnienie starej karty kontaktowej; jej układ poprawiono.

Three.js pozostaje osobnym, dynamicznie ładowanym modułem (około 511 kB / 128 kB gzip); Vite zgłasza przekroczenie progu 500 kB. Nie dodano nowych zewnętrznych skryptów śledzących. Publikacja na domenach nie jest częścią tej lokalnej integracji.

## Ponowne uruchomienie podglądów

Po `npm run build:all`, w osobnych terminalach:

```powershell
npm run preview:lekkage -- --host 127.0.0.1 --port 4322
npm run preview:elektra -- --host 127.0.0.1 --port 4323
npm run preview:gas -- --host 127.0.0.1 --port 4324
```
