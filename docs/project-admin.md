# Panel projektów LBI

Panel klienta działa pod `/beheer/projecten/`. Logowanie odbywa się osobnym hasłem, bez GitHuba. Publiczna strona pozostaje statyczna; panel wymaga osobnej usługi Node za Nginx. Samo skopiowanie `dist/lbi` nie uruchamia zapisu ani publikacji.

## Obsługa klienta

1. Zaloguj się i wybierz **Nieuw project**.
2. Dodaj jedno zdjęcie JPG, PNG lub WebP do 10 MB. Serwer sprawdza zawartość i tworzy WebP bez metadanych zdjęcia.
3. Uzupełnij nazwę, kategorię, datę, miejscowość, krótki opis i opis zdjęcia dla dostępności. Pełny adres klienta nie jest potrzebny.
4. **Concept opslaan** zachowuje szkic, również niekompletny. Nie pojawia się on na stronie.
5. Potwierdź prawo do publikacji zdjęcia i poprawność danych, następnie wybierz **Publiceren**. Publikacja przebudowuje stronę LBI i przełącza aktualne wydanie dopiero po weryfikacji wyniku.

Nowa realizacja pojawia się na `/projecten/`; strona główna pokazuje trzy najnowsze według daty. Panel zachowuje wcześniejsze realizacje z repozytorium, lecz edytuje tylko realizacje dodane przez ten panel. **Interne notitie** pozostaje w prywatnym rekordzie i nie trafia do procesu budowania ani strony. Zapis zmian opublikowanej realizacji zachowuje szkic; ponowne **Publiceren** aktualizuje stronę. Usuwanie i galerie wielu zdjęć nie są jeszcze częścią panelu.

## Lokalny podgląd i testy

Wymagane są Node >=22.12.0 oraz zainstalowane zależności:

```sh
npm run build:lbi
npm run admin:preview
```

Adres: `http://127.0.0.1:4335/beheer/projecten/`. Hasło **wyłącznie do lokalnego testowego podglądu**: `synthetic-project-admin-42`. Nie używać tego konta ani skryptu podglądu na serwerze produkcyjnym.

Podgląd kopiuje źródła do `.artifacts/project-admin-preview/source`, a projekty i wydania zapisuje w osobnych podkatalogach tego testowego katalogu. Nie zmienia realizacji w repozytorium ani serwera Hetzner. Odświeżenie źródeł następuje przy ponownym uruchomieniu skryptu. `.artifacts` jest ignorowany przez Git.

```sh
npm run test:admin
npm run test:admin:builder
# Przy działającym admin:preview, na jego danych testowych:
npm run test:admin:e2e
```

`test:admin` sprawdza uwierzytelnienie, CSRF, media, rozdzielenie szkiców i publikacji, awarie, odzyskiwanie oraz limity. `test:admin:builder` sprawdza protokół i odrzucenie niebezpiecznych lub niepełnych wyników; nie jest dowodem izolacji systemowej. `test:admin:e2e` wykonuje rzeczywisty build Astro i sprawdza realizację oraz zdjęcie na stronie głównej i osi projektów, a także brak drugiego szkicu. Każde uruchomienie dodaje rekordy tylko do testowego podglądu.

`scripts/preview-project-admin-ui.mjs` jest osobną atrapą API na porcie 4336 do testów wyglądu i formularza. Nie sprawdza prawdziwego logowania, uploadu ani publikacji i nie służy do obsługi klienta.

## Przygotowanie produkcji — jeszcze nie uruchomione

**Migracja zależności i izolacja buildera są wykonane i zweryfikowane na Linuksie, 10 października 2026.** HTTPS poza loopback odmawia startu bez konfiguracji izolowanego buildera. Dwie docelowe usługi mają używać osobnych kont: `lbi-project-admin` przechowuje hasło, rekordy, zdjęcia i wydania; `lbi-project-builder` buduje przez Unix socket, bez sieci i dostępu do tych danych. Lokalny runner pod kontem panelu pozostaje wyłącznie dla podglądu loopback.

Builder otrzymuje tylko Markdown wybranych do publikacji projektów i manifest SHA-256. Nie otrzymuje szkiców, notatek wewnętrznych, hasha hasła ani prywatnych zdjęć. Panel kopiuje zatwierdzone WebP do wydania dopiero po poprawnym buildzie. Protokół sprawdza identyfikator, nonce, ścieżki, hashe, kompletność i limity. Symlinki/pliki specjalne oraz wynik, którego procesów lub workspace nie udało się posprzątać, blokują publikację.

Jednorazowy test systemd z innym UID potwierdził kernelową odmowę dostępu do danych i środowiska panelu, źródła tylko do odczytu, oddzielną sieć, limity cgroup, zakończenie drzewa procesów oraz prawdziwą publikację przez daemon Astro. Usługi i katalogi testowe zostały usunięte; aktywne podglądy i Nginx zachowały te same hashe i PID. To nie uruchamia jeszcze produkcyjnych kont, domen ani panelu.

Przykłady wymagające dostosowania i testu:

- [systemd](../deploy/project-admin.service.example)
- [systemd — builder](../deploy/project-admin-builder.service.example)
- [właściciele i prawa katalogów](../deploy/project-admin-builder.tmpfiles.example)
- [Nginx](../deploy/project-admin.nginx.example)
- [Aktualny audyt przed produkcją](production-readiness.md)

Źródła, prywatne dane i wydania muszą mieć rzeczywiste, absolutne, rozłączne ścieżki, bez symlinków/junctionów w tych ścieżkach. Konfiguracja usługi:

```ini
LBI_ADMIN_ORIGIN=https://www.lbi-helmond.nl
LBI_ADMIN_SOURCE_DIR=/srv/lbi/source
LBI_ADMIN_DATA_DIR=/var/lib/lbi-project-admin
LBI_ADMIN_PUBLISH_ROOT=/srv/lbi/published
LBI_ADMIN_PORT=4335
LBI_ADMIN_BUILDER_SOCKET=/run/lbi-project-builder/builder.sock
LBI_ADMIN_BUILDER_REQUEST_DIR=/var/spool/lbi-project-builder/requests
```

Hasła nie zapisuje się w tej konfiguracji. Node nasłuchuje na `127.0.0.1`. Nginx obsługuje HTTPS, przekierowania HTTP/apex → HTTPS/www, certyfikat, limit prób logowania według IP i proxy `/beheer/`. Publiczny root wskazuje `/srv/lbi/published/current`. Przykład Nginx zawiera bloki HTTPS; port 80 i certyfikaty należy połączyć z istniejącą konfiguracją hosta, bez duplikowania virtual hostów.

Utwórz odrębne konta z wyłączonym logowaniem oraz grupę `lbi-project-build`. Tylko admin należy dodatkowo do grupy buildera; builder nie może należeć do grupy admina. Źródła i zależności należą do operatora/root, bez zapisu dla obu usług. Zachowaj prawa binariów z `npm ci`. Prywatne dane należą do admina, cache do buildera; katalog żądań ma właściciela admin, grupę buildera i setgid zgodnie z tmpfiles. Utwórz też `/etc/lbi` i ścieżki z `InaccessiblePaths` przed startem usług. Plik środowiska admina nie może być plikiem środowiska buildera.

Builder kopiuje do jednego workspace tylko stałą allowlistę źródeł, podłącza zależności read-only i tworzy oba zapisywalne cache: `ASTRO_CACHE_DIR=<job>/.cache/astro` oraz `LBI_VITE_CACHE_DIR=<job>/.cache/vite`. Nie udostępniaj zapisu w `source/node_modules`. Limit daemonu wynosi 1536 MiB/128 tasks/200% CPU, a pojedynczy build ma pięć minut i limit 1 GiB/50 000 plików. Publiczne wydania mają uprawnienia katalogów 0755 i plików 0644; prywatne dane odpowiednio 0700 i 0600. Zweryfikuj, że użytkownik Nginx czyta wydanie, a nie może czytać danych panelu.

Do powtórzenia izolowanego proof potrzebne są Linux, root, systemd/cgroup v2, konto `nobody`, Node >=22.12.0 i osobny publiczny snapshot z zależnościami. `npm run test:admin:linux` tworzy wyłącznie disposable `/var/lib/lbi-builder-proof-*` i własne transient units; nie uruchamiaj go przeciw drzewu z prywatnymi danymi. Pierwszy rzeczywisty test wykrył domyślny cache Vite w read-only dependencies; po przeniesieniu cache do jobu pełna publikacja przeszła.

### Ustawienie i rotacja hasła

Na serwerze, w terminalu z ukrytym wprowadzaniem, ustaw hasło co najmniej 12 znaków:

```sh
npm run admin:password -- /var/lib/lbi-project-admin/auth/password.json
```

Ustaw właściciela pliku i prywatne uprawnienia. Hash jest zapisywany przez scrypt; hasła nie umieszcza się w Git, poleceniu shell, czacie ani logach. Dla istniejącego pliku:

```sh
npm run admin:password -- --force /var/lib/lbi-project-admin/auth/password.json
sudo systemctl restart lbi-project-admin
```

**Restart jest obowiązkową częścią rotacji.** Usługa ładuje hash przy starcie. Dopiero restart odrzuca stare hasło i unieważnia wcześniejsze sesje. Sprawdź oba zachowania i logowanie nowym hasłem.

### Dane i kopie zapasowe

Katalog danych zawiera `auth`, `records`, `media`, `snapshots` oraz ewentualny dziennik przerwanej publikacji. Nie wysyłaj tych danych do publicznego repozytorium ani webrootu. Kopia musi obejmować też konfigurację i odpowiadające jej wydania/`current`; przechowuj ją poza webrootem, z ograniczonym dostępem i dodatkową kopią poza serwerem. Wykonuj spójną kopię przy zatrzymanej usłudze, bez trwającej publikacji. Przed produkcją przeprowadź odtworzenie w odizolowanym miejscu i sprawdź logowanie, rekordy, zdjęcia i aktywną stronę.

Publikacja zapisuje dziennik przed przełączeniem wydania. Restart dokończy lub cofnie tę transakcję, nie nadpisując późniejszego wydania. Nierozwiązany dziennik blokuje kolejną publikację. Nie usuwaj go ręcznie bez ustalenia stanu rekordów i `current`.

### Limity i utrzymanie

| Zasób | Domyślny limit |
| --- | --- |
| Rekordy | 500 / 32 MiB |
| Zdjęcia i metadane | 2000 plików (do 1000 par) / 2 GiB |
| Migawki | 1000 / 128 MiB |
| Zachowane wydania | 100 katalogów / 500 000 plików / 10 GiB |
| Jedno wydanie | 50 000 plików / 1 GiB |
| Staging | 100 000 plików / 2 GiB |

Upload wymaga 512 MiB wolnego miejsca. Publikacja wymaga 2 GiB na filesystemie wydań i 512 MiB na prywatne dane. Po przekroczeniu limitu zapis/publikacja się zatrzymuje. Usługa nie usuwa automatycznie starych wydań, zdjęć ani kopii; potrzebna jest kontrolowana retencja, chroniąca aktualne wydanie, rollback, referencje zdjęć i kopie zapasowe. Restart nie zwalnia miejsca.

Sesje trwają do 8 godzin i są w pamięci; restart je kończy. Cookie produkcyjne jest Secure, HttpOnly i SameSite=Strict. Zapis sprawdza origin i CSRF. Stary `/admin/` pozostaje technicznym edytorem Decap; nie służy do logowania klienta na Hetznerze.
