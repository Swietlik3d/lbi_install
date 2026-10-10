# Hetzner — podgląd klienta, 10.10.2026

**PASS: cztery strony i panel są aktywne przez HTTPS.** Podglądy używają
osobnych hostów sslip.io, bez domeny BezwaarPilot. Zachowano wygląd i animacje
3D. Własne dane QA przeniesiono do prywatnego archiwum; klient widzi czyste
strony z dotychczasowymi realizacjami.

| Strona | Adres |
| --- | --- |
| LBI | https://lbi-preview.178-105-195-84.sslip.io/ |
| Prąd | https://elektra-preview.178-105-195-84.sslip.io/ |
| Woda | https://lekkage-preview.178-105-195-84.sslip.io/ |
| Gaz | https://gas-preview.178-105-195-84.sslip.io/ |
| Panel | https://lbi-preview.178-105-195-84.sslip.io/beheer/projecten/ |

Panel używa osobnego hasła, bez nazwy użytkownika i GitHub. Dane dostępu są
oddzielnie w chronionym lokalnym katalogu ignorowanym przez Git. Hasła,
cookies, tokenów CSRF ani stanu uwierzytelnienia nie zapisano w repozytorium,
pakietach stron lub raportach testów.

## Tożsamość wdrożenia

- Wszystkie cztery statyczne wydania: `20261010T122434Z`, **163 pliki**.
  SHA-256 archiwum:
  `6708d5dee9975cbeffca505fb31a77aa6b411cfd3468e10d81c76242bcd1ce38`.
- Panel/builder: commit `d4d6098c0ec785883331750770d43cd6dbcb7962`, katalog
  `/srv/lbi-preview/source-d4d6098c0ec785883331750770d43cd6dbcb7962`.
  Pakiet `6a381032-2767-46d9-9bb6-965c4184d42d`, SHA-256
  `145759c99f75bcee3e3227ecc41f2657d097ecb840628b036d8b762e97426cb5`.
  Końcowa kontrola potwierdziła **175/175 plików** źródła z manifestu.
- Obie usługi `lbi-preview-admin` i `lbi-preview-builder` są active/enabled.
  API nasłuchuje wyłącznie na `127.0.0.1:4335`, przez proxy HTTPS.
- Zmieniono tylko vhost LBI; jego hash:
  `56a4dfe7d88d956dfcd5c59044d93c7cc3d5fbdcd71e31cf9fdd7a4c0bb9f8f8`.
  Pozostałe sześć konfiguracji Nginx zachowało pierwotne hashe.

Statyczne wydanie powstało przed poprawkami backendu i narzędzi. Późniejsze
commity nie zmieniły frontendu; kolejny commit dokumentacji również nie wymaga
przebudowy publicznego wydania.

## Potwierdzone testy

| Kontrola | Wynik |
| --- | --- |
| API panelu | PASS, 106 asercji |
| Protokół buildera na Linuksie | PASS, 40 asercji jako nieuprzywilejowany admin; prawa zamrożonych requestów, sprzątanie i odmowa przejścia przez dowiązanie |
| Operator preview | PASS, 30 asercji, w tym rzeczywiste 12 stron LBI + `404.html`; poprawne hosty i zachowany kontakt |
| HTTPS E2E, 15:02 CEST | PASS: logowanie, zdjęcie/WebP, publikacja na homepage i timeline, ukryty szkic, preview sitemap/robots/noindex, Origin/CSRF, cookie Secure/HttpOnly/SameSite, wylogowanie i odrzucenie starej sesji |
| Publiczne HTTPS, 15:04 CEST | PASS: 27 stron, 40 zasobów, przekierowania, robots/noindex i blokada `/admin/` |
| Przeglądarka | PASS: cztery strony i ekran logowania przy 390×844, 768×1024, 1440×900; 36 obejrzanych zrzutów, renderery 3D, ręczne etapy, nawigacja i CTA |
| Automatyczna zmiana scen | PASS: trzy landingi `0→1` po 3,1 s; jawne reduced motion zatrzymuje zegar, ręczne `1/2` działają; brak play/pause |
| Sprzątanie i stan końcowy | PASS: records/media/snapshots = 0, brak journalu, puste requests/workspaces, wszystkie `current` do czystego wydania |

Końcowa kontrola potwierdziła konfigurację aktywnego buildera: osobny UID,
PrivateNetwork, AF_UNIX, źródło/deps tylko do odczytu oraz ustawienia odmowy
dostępu do danych/środowiska panelu i publicznych wydań. Rzeczywistą odmowę
kernela potwierdził wcześniejszy Linux proof opisany w
[gotowości produkcyjnej](production-readiness.md). Limity: 1536 MiB, brak swapu, 200% CPU,
128 zadań, ProtectSystem=strict i NoNewPrivileges. Rzeczywista publikacja
odbyła się przez trwałe usługi.

Pierwsze trzy pomiary autoplay przy niejawnej preferencji ruchu były
niejednoznaczne. Osobna sesja z jawnymi preferencjami rozstrzygnęła je:
111/111 komend i 46/46 asercji PASS. Konsole i błędy JS są puste; obie własne
sesje zamknięto. Nie jest to pomiar wszystkich klatek WebGL, Lighthouse ani
wydajności na słabszym fizycznym telefonie.

## Kopie i odtwarzanie plików

Archiwa są pod `/var/backups/lbi-preview`, poza webrootem, z uprawnieniami
0700/0600. Zawierają dane, media, hash hasła, konfigurację i publiczne wydanie,
bez hasła jawnego. Obie kopie pobrano również do lokalnego katalogu Windows
z ACL wyłącznie dla bieżącego użytkownika i SYSTEM.

| Kopia | SHA-256 | Restore na serwerze i poza nim |
| --- | --- | --- |
| `snapshot-20261010T130313Z` — QA | `ab7ad445ebadebd7601c79c7156a9363350b0bd956dd87ba364d6f43847eee77` | PASS: 63 pliki, 2 rekordy, 1 zdjęcie |
| `snapshot-20261010T130446Z` — czysty panel | `3b23caf55993822f4c5a16bc0ee0533782677c2316d364fd2602e503097fe281` | PASS: 52 pliki, 0 rekordów/zdjęć, odtworzone puste katalogi |

Sprawdzono inventory, rozmiary i hashe wszystkich plików, format hashu hasła,
rekordy JSON, dekodowanie zdjęcia, publiczne entrypointy i robots. Odtworzenie
było izolowanym testem plików. **Nie symulowano odtworzenia działających usług
po utracie serwera.**

## Recovery i dalsze czynności

Poprzednie cztery wydania `20260919T002319Z` zachowano. Dwa nieaktywne
lipcowe katalogi o starym formacie nazw przeniesiono do prywatnego archiwum
z manifestami SHA, aby nie blokowały walidacji magazynu. Własne QA i
nieaktywne wersje kodu również zachowano. Zweryfikowany rollback nieudanej
aktualizacji przywrócił poprzednie unity/środowisko bez błędów recovery.

Procedura aktualizacji, backupu i recovery: [Hetzner client previews](hetzner-preview.md).
Przed domenami produkcyjnymi pozostają uzgodnienie domen i danych klienta,
automatyczne kopie poza serwerem, retencja, monitoring i pełna procedura
odtworzenia usług. Nie zmieniono DNS ani obecnej produkcyjnej strony LBI.
Lista: [gotowość produkcyjna](production-readiness.md).

## Dowody lokalne, ignorowane przez Git

- [Deploy statyczny](../artifacts/hetzner-preview-install/final-static-deployment.json)
  i [końcowe HTTPS](../artifacts/hetzner-preview/20261010T122434Z/external-verification.json).
- [Bieżący kod](../artifacts/hetzner-preview-install/upgrade-current.json),
  [regresja API](../artifacts/hetzner-preview-install/backend-regression-final.log),
  [Linux spool](../artifacts/hetzner-preview-install/linux-spool-regression.log),
  [operator preview](../artifacts/project-admin-tests/preview-profile-latest.json).
- [HTTPS E2E](../artifacts/hetzner-preview-install/panel-live-e2e.json),
  [sprzątanie](../artifacts/hetzner-preview-install/qa-cleanup.json),
  [końcowy stan serwera](../artifacts/hetzner-preview-install/final-server-state.json).
- [Przeglądarka i zdjęcia](../artifacts/staging-public-browser-qa/final-report.md).
- [QA — restore serwer](../artifacts/hetzner-preview-install/backup-with-qa-restore.json)
  i [poza serwerem](../artifacts/hetzner-preview-install/backup-with-qa-offserver-restore.json).
- [Czysty panel — restore serwer](../artifacts/hetzner-preview-install/backup-clean-restore.json)
  i [poza serwerem](../artifacts/hetzner-preview-install/backup-clean-offserver-restore.json).
