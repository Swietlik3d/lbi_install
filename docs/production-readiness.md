# LBI — gotowość produkcyjna

Stan sprawdzony **10 października 2026, Europe/Berlin**. **Migracja zależności i izolacja buildera: PASS.** Poprawki są gotowe w repozytorium i przeszły rzeczywisty test na Linuksie. Cztery aktywne podglądy klienta i dotychczasowa strona pod domeną LBI nie zostały przełączone. Instalacja docelowych usług, hasło klienta, domeny i końcowe dane wymagają przygotowania przed uruchomieniem produkcji.

## Migracja bez zmiany wyglądu

- Astro **7.3.8**, Sharp **0.35.5**, Tailwind CSS i integracja Vite **4.3.3**. Wymagany Node.js **>=22.12.0**; Linux proof wykonano na Node **22.22.2**.
- Pełny `npm audit` i audyt `--omit=dev`: **0 podatności**. Usunięto podatne zależności Astro 5 i zastąpiono dawny runtime Tailwind 3; nie zastosowano `npm audit fix --force`.
- Zachowano Three.js **0.180.0**, sceny, komponenty, układy i istniejące treści. Osiem sprawdzanych plików 3D pozostaje identycznych; wspólny zegar etapów dostał wyłącznie obsługę `prefers-reduced-motion`. Domyślna animacja co 3000 ms i ręczny wybór etapów pozostają. Reset, kolory i pozostałe domyślne tokeny Tailwind 3 są statycznymi arkuszami z licencją MIT, bez starego runtime'u.
- Zachowano implementację automatycznych animacji 3D, interwał etapów 3000 ms oraz obsługę ograniczenia ruchu i braku WebGL. Wynik weryfikacji zachowania w przeglądarce opisano osobno poniżej.

Dowody: [pełny audit](../artifacts/production-audit-2026-10-10-after.json), [audit produkcyjny](../artifacts/production-audit-2026-10-10-after-prod.json), [porównanie źródeł wyglądu](../artifacts/production-design-baseline.json). Kontekst migracji: [Astro 7](https://docs.astro.build/en/guides/upgrade-to/v7/) i [advisory Astro](https://github.com/withastro/astro/security/advisories/GHSA-26w7-cxv4-gfx2).

## Izolacja procesu budowania

Panel i builder działają w oddzielnych procesach i pod oddzielnymi UID. Konfiguracja produkcyjna panelu odmawia startu bez izolowanego buildera. Lokalny runner używany przez testy nie jest dozwolony dla publicznego środowiska produkcyjnego.

Do buildera przechodzi wyłącznie zatwierdzony publiczny frontmatter projektów wybranych do danego wydania oraz manifest z SHA-256: aktualizacja publikowanego projektu i wcześniej opublikowane projekty panelu. Prywatne notatki, szkice, hasło, sesje, środowisko panelu i magazyn mediów nie są udostępniane. Panel kopiuje zatwierdzone zdjęcia dopiero po odbiorze i sprawdzeniu builda. Komunikacja odbywa się przez Unix socket, bez dostępu buildera do sieci.

Builder ma kod i zależności tylko do odczytu, osobny zapisywalny katalog na każde zadanie oraz osobne cache Astro i Vite. Usługa ogranicza pamięć do 1536 MiB, CPU do 200%, liczbę procesów do 128, czas zadania do pięciu minut oraz wynik do 1 GiB i 50 000 plików. Weryfikacja strumienia obejmuje nonce, ścieżki, liczbę i rozmiar plików oraz hashe; dowiązania i pliki specjalne są odrzucane. Sukces jest akceptowany dopiero po usunięciu procesów zadania i sprzątnięciu jego katalogu.

**Rzeczywisty Linux proof: PASS**, 10.10.2026 o 11:51 CEST, na odrębnej publicznej kopii kodu i transient services. Potwierdzono odmowę odczytu prywatnych danych i środowiska panelu przez kernel, brak sieci, granice cgroup, zakończenie procesów potomnych oraz rzeczywistą publikację przez daemon i API panelu. Vite pierwotnie próbował pisać do `node_modules/.vite`; poprawka kieruje jego cache do katalogu zadania, zachowując zależności tylko do odczytu.

Wszystkie katalogi i usługi testowe na Hetznerze usunięto. PID i konfiguracja aktywnego Nginx, cztery wskaźniki wydań oraz hashe stron przed i po teście są identyczne. Snapshot `81470702-0b30-45e6-8ea2-235e95390a7a`, SHA-256 `bb1a6167fdeec00bb1ce2bf75fc8962a1c32255e62145e2c8edcfa98e6325d6d`: **166/166 plików zgodnych w chwili tego testu**. Po teście zmieniono wyłącznie dwa pliki: zegar etapów dla reduced motion i skrypt raportujący kontrolę wyglądu. Niezależne porównanie manifestu potwierdziło, że kod panelu/buildera, usługi, konfiguracja i zależności pozostają identyczne. Linux proof jest dowodem tych zabezpieczeń; końcowy frontend podlega osobnemu buildowi i testowi przeglądarki.

Dowody: [wynik Linux proof](../artifacts/linux-production-proof/81470702-0b30-45e6-8ea2-235e95390a7a/result.json), [sprzątanie i kontrola aktywnych stron](../artifacts/linux-production-proof/81470702-0b30-45e6-8ea2-235e95390a7a/cleanup.log), [porównanie z końcowym kodem](../artifacts/linux-production-proof-current-source.json). Instalacja i obsługa: [panel projektów](project-admin.md), [usługa buildera](../deploy/project-admin-builder.service.example), [tmpfiles](../deploy/project-admin-builder.tmpfiles.example), [usługa panelu](../deploy/project-admin.service.example).

## Walidacja aplikacji i czterech stron

| Kontrola | Wynik i zakres |
| --- | --- |
| `npm run test:admin` | PASS, 103 asercje: walidacja, upload, sesje, CSRF, publikacja, rollback, limity i rotacja hasła |
| `npm run test:admin:builder` | PASS, 22 asercje: protokół, cache, ograniczona diagnostyka i odmowa sukcesu przy błędzie sprzątania |
| `npm run test:admin:e2e` | PASS: prawdziwe logowanie/API, upload, build Astro 7, strona główna, timeline, zdjęcie i ukrycie drugiego szkicu |
| `npm run build:all` | PASS: LBI, Elektra, Lekkage, Gas; końcowy build po poprawce reduced motion |
| `npm run check:all` | PASS dla czterech stron: 0 błędów, 0 ostrzeżeń; dwa nieblokujące hints na stronę |
| `npm run test:sites` | PASS o 12:36 CEST: 39 HTML, 27 indeksowanych stron, 1065 lokalnych odwołań; sitemap 12/5/5/5, robots, canonicale, JSON-LD, nagłówki, alt i prywatne ścieżki; osiem plików scen identycznych, jedna jawna zmiana zegara etapów |
| Przeglądarka po migracji — LBI | PASS, 390×844, 768×1024, 1440×900; hero, projekty, nawigacja, CTA i porównanie z wersją zatwierdzoną |
| Przeglądarka po migracji — Elektra | PASS, trzy rozdzielczości; renderer 3D, trzy etapy, nawigacja, CTA i brak regresji wyglądu |
| Przeglądarka po migracji — Lekkage | PASS, trzy rozdzielczości; renderer 3D, trzy etapy, nawigacja, CTA i brak regresji wyglądu |
| Przeglądarka po migracji — Gas | PASS, trzy rozdzielczości; renderer 3D, trzy etapy, bezpieczeństwo, nawigacja, CTA i brak regresji wyglądu; 92/92 polecenia, bez błędów JS, własna sesja zamknięta |
| Automatyczna zmiana etapów i ręczny wybór | PASS po końcowym buildzie: na Elektra, Lekkage i Gas etap 0 zmienia się na 1 po odczekaniu 3,1 s; źródło ustala interwał 3000 ms. Brak przycisków play/pause |
| `prefers-reduced-motion` — automatyczna zmiana etapów | PASS na trzech landingach: etap 0 pozostaje 0 po 3,1 s, ręczny wybór 1 i 2 działa, etap 2 pozostaje 2 po kolejnym odczekaniu. Ten test dotyczy zegara etapów, nie pomiaru wszystkich klatek WebGL |
| WebGL fallback | PASS na Elektra, Lekkage i Gas przy 1440×900: WebGL faktycznie wyłączony, renderer `fallback`, statyczna ilustracja, treść i CTA widoczne, brak nieobsłużonych błędów JS; własna sesja zamknięta |
| Niezależny przegląd bezpieczeństwa | PASS dla migracji, kodu i rzeczywistego Linux proof; bez otwartych usterek High/Medium |

Dowody: `artifacts/project-admin-tests/1791624728563-992d40d5`, `artifacts/project-admin-tests/builder-1791625676860-c9ba1a9d`, [API/E2E](../artifacts/project-admin-e2e.json), [build](../artifacts/production-migration-build-all.log), [Astro check](../artifacts/production-migration-check-all.log), [kontrola statyczna](../artifacts/production-static-verification.json). Raporty przeglądarki są w `.artifacts/browser-qa/`: LBI `6b6e5441-d00a-46f3-aafa-0e1a571159c6`, Elektra `79eeb08d-eeb1-41ed-9483-a52ca35535b6`, Lekkage `96facef8-a050-48c2-99cc-d80cbb2485ce`. Gaz: [polecenia i wyniki](../artifacts/security-migration-browser-qa/unique/evidence/gas-functional-round-2/commands.jsonl), SHA-256 `03f0b5d59daa2bc9d9b572e83ae5ce7a313d1b508f4129463636629a8edbc8e8` oraz zrzuty w tym samym katalogu.

Końcowy test etapów: [Elektra](../artifacts/security-migration-browser-qa/unique/evidence/timing-round-3/elektra/commands.jsonl), [Lekkage](../artifacts/security-migration-browser-qa/unique/evidence/timing-round-3/lekkage/commands.jsonl), [Gas](../artifacts/security-migration-browser-qa/unique/evidence/timing-round-3/gas/commands.jsonl). Wszystkie własne sesje zamknięto, błędy JS i console są puste. Próba gazu przed przewinięciem klikała poza widocznym viewportem; po przewinięciu i potwierdzeniu położenia przycisków ręczny wybór etapów ma PASS. Nie wymagało to zmiany aplikacji. Wcześniejsze próby czasowania używały zachowanej emulacji reduced motion; końcowe próby używają świeżych sesji i jawnego ustawienia preferencji.

Końcowy test bez WebGL: [polecenia i wyniki](../artifacts/security-migration-browser-qa/unique/evidence/fallback-round-3/commands.jsonl), SHA-256 `a20366b09512e6b24b1ca3cb6f4ee6a4d4d9b39d23f3c7d657b80f645d1f1e18`. Wszystkie 41 poleceń zakończyły się poprawnie. Flaga `--disable-webgl` była utrzymywana w konfiguracji całej sesji; inne ustawienia uruchomienia i komunikat przeglądarki potwierdzają jej zastosowanie. Console zawiera oczekiwane, obsłużone komunikaty Three.js o wyłączonym WebGL; `errors` pozostaje puste. Wcześniejsza próba podawała flagę tylko przy pierwszym poleceniu, więc nie została uznana za dowód fallbacku. Poprawiono konfigurację testu, bez dodatkowej zmiany aplikacji.

Zbiorczy [raport przeglądarki](../artifacts/security-migration-browser-qa/final-report.md) i [dane z hashami dowodów](../artifacts/security-migration-browser-qa/final-report.json) mają PASS. Niezależny końcowy przegląd potwierdził bezpieczeństwo, migrację, izolację, build i funkcjonalne QA; nie stwierdził otwartych usterek High/Medium. Wynik nie zastępuje kontroli docelowej instalacji ani pomiarów wydajności opisanych niżej.

Zachowane nieudane przebiegi dokumentują również błędy selektorów i czasowania testu oraz konflikt zasobów narzędzia; nie uznano ich za defekty aplikacji. Hints dotyczą istniejącego `beforeunload` i skryptu JSON-LD. Ostrzeżenie builda o rozmiarze pakietu Three.js pozostaje; nie ma potwierdzenia wyniku Lighthouse >=95 ani wydajności na słabszym fizycznym telefonie. Dowody są lokalne i ignorowane przez Git.

Wcześniejsze testy przeglądarki panelu z 9.10.2026 obejmowały ekran logowania i formularz z atrapą API w trzech rozdzielczościach. Nie są dowodem produkcyjnego logowania przez przeglądarkę; rzeczywiste uwierzytelnienie i publikację sprawdziły oddzielne testy API/E2E. Procedura: [TEST-CHECKLIST.md](../TEST-CHECKLIST.md).

## Domeny — dostępność rejestracji, DNS i HTTPS

Odczyt **10.10.2026**, według SIDN RDAP. HTTP 404 dla nazwy domeny oznacza status `free` zgodnie z [instrukcją SIDN](https://www.sidn.nl/downloads/1l3dvAfH8Ppqnjl0Y7p0jL/eb1fed1298c825dbca6c0e95c2f9c6aa/RDAP_Manual_v1.3.pdf). Brak DNS sprawdzono oddzielnie; sam brak DNS nie był podstawą oceny dostępności rejestracji.

| Domena | Rejestracja w chwili odczytu | Godzina CEST | DNS/HTTPS |
| --- | --- | --- | --- |
| `elektrastoring-helmond.nl` | Wolna, SIDN `free` | 11:12 | Apex/www ENOTFOUND |
| `lekkage-reparatie-helmond.nl` | Wolna, SIDN `free` | 11:20 | Apex/www ENOTFOUND |
| `gasleiding-service-helmond.nl` | Wolna, SIDN `free` | 11:21 | Apex/www ENOTFOUND |
| `lbi-helmond.nl` | Rejestracji nie sprawdzano | 11:12 | Istniejąca strona HTTPS 200; apex `77.111.243.64`, www `142.250.27.121`, poza Hetznerem `178.105.195.84` |

Wynik nie stanowi rezerwacji. Nie zakupiono domen i nie zmieniono DNS. Dowód: [raport domen](../artifacts/production-domain-availability-2026-10-10.json); ponowny odczyt: `node scripts/check-production-domains.mjs`.

## Pozostałe czynności przed uruchomieniem produkcji

1. **Domeny i HTTPS.** Zarejestrować uzgodnione domeny, zapewnić dostęp do DNS i zabezpieczyć obecną stronę LBI. Sprawdzić rekordy pocztowe, certyfikaty apex/www, przekierowania HTTP→HTTPS→www, cztery virtual hosty oraz canonicale po przełączeniu.
2. **Docelowe usługi.** Zainstalować konta, grupy, katalogi, systemd/tmpfiles i Nginx zgodnie z dokumentacją. Ustawić produkcyjne hasło klienta przez ukryty prompt. Test transient services potwierdza architekturę izolacji; po trwałej instalacji trzeba potwierdzić uprawnienia Nginx, limity logowania według rzeczywistego IP, HTTPS cookie, Origin/CSRF i odmowę dostępu buildera do prywatnych danych.
3. **Eksploatacja.** Ustawić spójne kopie danych, mediów, hashu i wydań poza webrootem oraz kopię poza serwerem. Wykonać odtworzenie backupu i pełny scenariusz klienta na HTTPS staging. Sprawdzić rotację hasła z restartem i unieważnieniem sesji, retencję, monitoring miejsca i obsługę błędu publikacji. Lokalne testy rollbacku i crash recovery mają PASS; restore wdrożonego backupu pozostaje nieprzetestowany.
4. **Dane klienta.** Potwierdzić KVK, BTW, adres, kontakt i prawa do zdjęć. Trzy obecne realizacje zawierają oznaczone przykładowe daty/miejscowości; nie przedstawiać ich jako zweryfikowanych. Uzupełnić privacy/cookies o panel, sesję, zdjęcia, logi i uzgodnione przechowywanie danych. Formularze i śledzenie pozostają wyłączone.

## Hetzner — aktywne podglądy

Kontrola z **10.10.2026** potwierdziła aktywny Nginx i `current` do `20260919T002319Z` dla czterech podglądów. Test izolacji nie zmienił ich konfiguracji ani zawartości. Testowe buildy i publikacja przeszły bez błędu braku miejsca; wolne miejsce nadal wymaga monitorowania. `/run` jest mniejszym tmpfs, dlatego duże katalogi testowe tworzono pod `/var/lib` i następnie usunięto.

Adresy i procedura: [Hetzner client previews](hetzner-preview.md). Kod z tego zadania wymaga osobnego commit/push oraz kontrolowanego wdrożenia po przygotowaniu domen, usług i danych.
