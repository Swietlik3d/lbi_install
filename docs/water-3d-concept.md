# LBI Water — interaktywny projekt strony awarii wody

Od 19.09.2026 zaakceptowany projekt jest główną stroną serwisu `lekkage` pod `/` i korzysta z pełnych treści kolekcji Astro. Szczegóły integracji: [Główne landingi](landing-rollout.md).

Trasa `/concept/water/` pozostaje dodatkowym podglądem projektu. Standardowy build generuje nową stronę główną, a trasę podglądu pomija.

## Uruchomienie

```powershell
npm run dev:lbi -- --host 127.0.0.1 --port 4321
```

Podgląd projektu: http://127.0.0.1:4321/concept/water/. Główna strona wody jest pod http://127.0.0.1:4322/ w statycznym podglądzie opisanym w `landing-rollout.md`.

Opcjonalne zbudowanie prototypu do osobnego katalogu:

```powershell
npx cross-env SITE_ID=lekkage INCLUDE_DESIGN_PREVIEWS=1 astro build --outDir ./dist/water-concept
```

## Kierunek

- Jasna, spokojna paleta z zielononiebieskimi akcentami i pomarańczowym detalem LBI.
- Duży holenderski nagłówek: „Lekkage? Wij brengen weer rust.”
- Proceduralny model rury: metalowe kolanka, zawór, wyciek, krople i kręgi na wodzie.
- Trzy sterowane przez użytkownika etapy: wykrycie, odcięcie wody, naprawa połączenia.
- Telefon i WhatsApp dostępne od razu. Na telefonie dodatkowy stały przycisk kontaktu.
- Sekcje: rodzaje awarii, sposób pracy, FAQ, końcowy kontakt.
- Kontakt pochodzi z `src/config/sites.json`. Brak wymyślonych ocen, gwarantowanych czasów dojazdu lub deklaracji dostępności 24/7.

## Zachowanie i ograniczenia

Model korzysta z Three.js i WebGL2. Geometria oraz oświetlenie powstają lokalnie, bez pobierania modeli i tekstur z zewnętrznych serwerów. Moduł 3D ładuje się osobno od treści strony.

Od 19.09.2026 animacja startuje automatycznie, bez przycisków Play/Pause. Zgodnie z zamówionym zachowaniem sceny 3D uruchamiają się również przy systemowym ograniczeniu ruchu. Trzy etapy przełączają się co 3000 ms w pętli. Ręczny wybór etapu rozpoczyna nowy okres 3 sekund. Animacja zatrzymuje się poza widokiem i w ukrytej karcie; zegar etapów zatrzymuje się w ukrytej karcie i wznawia po powrocie. Brak WebGL lub utrata kontekstu pokazuje ilustrację zastępczą.

To wizualizacja sposobu obsługi, nie instrukcja naprawy instalacji. Etapy nie uruchamiają żadnego zgłoszenia ani kontaktu.

Normalny build zawiera nowy landing pod `/`, z własnym adresem canonical i `index,follow`. Tylko opcjonalny podgląd `/concept/water/` ma `noindex,nofollow`. Kontakty i linki usług są prawdziwymi odnośnikami projektu. Zmiana w repozytorium nie publikuje witryny.

## Sprawdzenie 19.09.2026

- PASS: `npm run check` — 0 błędów, 0 ostrzeżeń; istniejąca wskazówka `SchemaJsonLd.astro`.
- PASS: build z `INCLUDE_DESIGN_PREVIEWS=1`, obejmujący wszystkie trzy podstrony.
- PASS: w przeglądarce wszystkie trzy modele startują samodzielnie, bez kontrolek odtwarzania.
- PASS: automatyczna sekwencja 0 → 1 → 2 → 0 oraz jedna aktywna opcja na każdej podstronie; nadal działa ręczny wybór klawiaturą.
- Automatyczna zmiana nie odczytuje komunikatu `aria-live` co 3 sekundy; komunikat pojawia się tylko po ręcznym wyborze.

Wyniki odczytów: `artifacts/emergency-concepts/autoplay-verification.json`.

## Sprawdzenie 18.09.2026 — wcześniejsza wersja z pauzą

| Wynik | Sprawdzenie |
| --- | --- |
| PASS | `npm run check`: 0 błędów i ostrzeżeń; istniejąca wskazówka dotycząca `SchemaJsonLd.astro`. |
| PASS | `npm run build:all`: LBI, elektra, lekkage i gas. |
| PASS | Osobny build z `INCLUDE_DESIGN_PREVIEWS=1` zawiera `/concept/water/index.html`. |
| PASS | Normalne buildy nie zawierają strony prototypu ani odwołań do jej skryptów na stronach głównych. |
| PASS | Różne klatki podczas ruchu, identyczne podczas pauzy. |
| PASS | Trzy etapy, opis stanu, jedna aktywna opcja; obsługa przyciskiem Enter. |
| PASS | Domyślna pauza przy ograniczonym ruchu i reakcja na zmianę tej preferencji. |
| PASS | Widoki 1280, 390 i 320 px: brak poziomego przewijania, widoczny kontakt mobilny. |
| PASS | FAQ: otwarcie kliknięciem, zamknięcie klawiaturą. |
| PASS | Zablokowany moduł 3D: ilustracja zapasowa i działające etapy. |
| PASS | Wyłączony JavaScript: treść, ilustracja i kontakt dostępne; kontrolki animacji ukryte. |
| PASS | Brak błędów konsoli w działającym podglądzie. |
| WARN | Osobno ładowany moduł 3D ma 511,53 kB / 129,39 kB gzip; przekracza próg informacyjny Vite 500 kB. Nie jest pobierany przez obecne strony produkcyjne. |

Zrzuty: `artifacts/water-concept/desktop.png`, `desktop-full.png`, `mobile.png`, `repaired.png`.
