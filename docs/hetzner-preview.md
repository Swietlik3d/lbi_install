# Hetzner client previews

**2026-10-16:** the current four sites are now served at
https://www.lbi-helmond.nl/ and its `elektra`, `lekkage`, `gas` subdomains.
The panel is https://www.lbi-helmond.nl/beheer/projecten/ with its existing
password and private draft preserved. The older static previews below remain
available; their panel redirects to production and the old preview API returns
410. Production uses separate `/var/www/lbi-production/<site>` roots and
immutable source `source-production-c65279ed82a3d72d`. See
[current production evidence](production-readiness.md). The preview deployment
and backup commands below retain their original preview scope; they are not a
production updater or a scheduled backup of the new production roots.

The four previews use the existing Hetzner host `178.105.195.84` and separate
HTTPS virtual hosts. Their URLs do not use the BezwaarPilot domain.

| Site | Client URL |
| --- | --- |
| LBI Installaties | https://lbi-preview.178-105-195-84.sslip.io/ |
| Elektra | https://elektra-preview.178-105-195-84.sslip.io/ |
| Lekkage | https://lekkage-preview.178-105-195-84.sslip.io/ |
| Gas | https://gas-preview.178-105-195-84.sslip.io/ |

All four previews were updated on **2026-10-10** to release
`20261010T122434Z`. The password-protected project panel is live at
https://lbi-preview.178-105-195-84.sslip.io/beheer/projecten/ . Actual HTTPS
login, photo upload, isolated publication and logout passed; owned test data
was quarantined and the clean four-site release restored. See the
[deployment evidence and recovery record](hetzner-preview-2026-10-10.md).

## Preparing an update

```sh
npm run build:all
node scripts/package-hetzner-preview.mjs
node scripts/verify-hetzner-preview.mjs
```

Only the four explicit `dist/<site>` directories are packaged. The package
includes current working-tree changes, not just the last Git commit. The
packager rewrites site links, canonical URLs, and social metadata to the preview
origins in `deploy/hetzner-preview.json`. Source files and production builds keep
their production URLs. Preview HTML and robots.txt prohibit indexing; the
existing nginx configuration also sends `X-Robots-Tag`.

Admin files (both `/admin/` and `/beheer/`), concept routes, hidden files, and repository source are excluded.
The public phone, email, and WhatsApp links remain usable. Forms are currently
disabled in the site configuration.

The local output is recorded in `artifacts/hetzner-preview/latest-package.json`.
Each release directory contains its archive, SHA-256 manifest, and verification
report. Capture a fresh server preflight before deployment: it must contain the
current release path and homepage SHA-256 for every site, plus hashes of all
enabled nginx configurations. The deploy script rejects drift from that snapshot.

## Server update and recovery

Upload the archive, preflight JSON, and `scripts/deploy-hetzner-preview.py` to a
new staging directory. Run the script first without `--apply`:

```sh
python3 deploy-hetzner-preview.py --archive preview.tar.gz --sha256 <archive-sha256> --preflight preflight.json
# After a successful validation, repeat with --apply.
```

Every site is staged in `/var/www/strony/<site>/releases/<release-id>`; its
`current` symlink is then replaced atomically. The script verifies all deployed
files over HTTPS against the manifest, including JavaScript MIME types, and
checks robots.txt, indexing headers, and the blocked `/admin/` path. A failed
verification attempts to restore all switched sites and records any rollback
errors. A staging failure leaves current sites untouched; inspect any incomplete
new release directories before retrying.

Previous releases are retained. The server record
`/var/www/strony/lbi-preview-rollback-<release-id>.json` contains the previous and
current paths. For a deliberate rollback, first verify that each current link
still targets that release, then atomically replace it with its recorded previous
target and verify the sites again. Do not overwrite a later deployment.

Static updates do not require nginx edits or service restarts. Installing the
project panel separately changes only the LBI preview vhost and dedicated
`lbi-preview-*` services; unrelated applications and vhosts stay untouched.

After deployment, verify the public endpoints from the client machine:

```sh
node scripts/verify-live-hetzner-preview.mjs
```

## Password-protected project panel

The client panel URL is
https://lbi-preview.178-105-195-84.sslip.io/beheer/projecten/ . It uses a separate
password, without GitHub or a username. Generate fresh preview access with
`scripts/prepare-hetzner-preview-access.mjs` only inside a protected, ignored
local directory. Upload only its scrypt hash to a new root-only staging
directory; never include the password in Git, shell arguments, logs or public
packages. Share the local access file with the client separately.

`scripts/preflight-hetzner-preview.py` captures the existing sites and all enabled
vhost hashes. `scripts/install-hetzner-preview-panel.py prepare` verifies a
manifest-approved public source archive and installs immutable source/dependencies,
dedicated users, private state, systemd/tmpfiles and the operator preview profile.
Nothing is activated or exposed during preparation. Deploy the four validated
static releases, then run `activate`. Activation verifies loopback availability,
changes only the backed-up LBI vhost, checks nginx and public HTTPS, and enables
the two isolated services. A failed activation records guarded recovery status.
Use the exact static deployment record with `scripts/recover-hetzner-preview.py
rollback-static` only after stopping the owned panel; it refuses intervening
releases. Failed preparations preserve dedicated paths for inspection and refuse
an implicit overwrite.

Preview paths are `/srv/lbi-preview/source-<commit>`,
`/var/lib/lbi-preview-project-admin`, `/etc/lbi-preview`, and separate builder
cache/spool/runtime directories. Nginx continues to serve
`/var/www/strony/lbi/current`, which the panel can replace atomically. The admin
and builder have separate users; the builder cannot read admin data, credentials,
published releases or environment and has no network access.

Set `LBI_ADMIN_PREVIEW_PROFILE` to the immutable source's
`deploy/hetzner-preview.json`. Every panel publication then rewrites all four
site origins to the preview hosts, validates its canonical URLs, excludes static
admin routes, and keeps deny-all robots/noindex. Omit this setting for a real
production-domain installation. Static `YYYYMMDDTHHMMSSZ` release names and
panel-generated release names must both be supported by guarded rollback and
crash recovery.

For an already installed panel, use `scripts/upgrade-hetzner-preview-panel.py`
with a fresh four-site/Nginx preflight, the exact previous source directory,
and a manifest-approved committed source archive. It installs a new immutable
source/dependency version, checks imports under both runtime users before
stopping services, backs up the three owned configuration files, and switches
only those source references. It verifies both services and exact UI bytes over
HTTPS. A failed switch restores the previous configuration and records any
incomplete recovery. Private data, password hash, static releases and Nginx
configuration are preserved; the first-install workflow refuses to overwrite
an existing panel.

`scripts/test-hetzner-preview-panel-live.mjs` is an explicitly invoked staging
API test. It creates two marked synthetic records and one photo, publishes one
project, checks HTTPS authentication/CSRF and the actual public result, and logs
out. Secrets stay in memory. Afterwards `recover-hetzner-preview.py clean-qa`
uses the exact QA report and pre-test current release to quarantine only those
owned records/media/snapshot/release outside the webroot and restore the clean
static release. Inventory/current drift causes a refusal.

`scripts/backup-hetzner-preview-panel.py backup` briefly stops only the panel and
copies consistent private records, media, auth hash, current public release and
configuration into a root-only archive under `/var/backups/lbi-preview`.
`verify --archive <exact-path> --sha256 <exact-hash>` restores files into an
isolated scratch directory and checks inventory/hashes, auth record, project
JSON, image decoding and public entrypoints. It does not switch the live site.
Keep an additional protected copy off the server. Scheduling, retention,
ongoing off-server replication and monitoring remain operator tasks before
production use.

## Verified release, 2026-09-19

Release `20260919T002319Z` was active on all four sites at that inspection and
is retained as the previous release. The archive SHA-256 is
`d47d56a882fb0b128ed03329ec356433cdd43eab33d937e207865dbc93d38bd8`.
The server verified all 163 live files against the manifest. A separate client
check passed for 27 page routes and 48 resources, HTTPS, HTTP redirects,
robots.txt, and `/admin/` protection. All seven existing nginx configuration
hashes remained unchanged. Reports are saved beside this release's local
archive as `deployment.json` and `external-verification.json`.
Browser checks confirmed the current LBI homepage and all three rendered WebGL
scenes. Water-to-electricity-to-gas navigation stays on the preview hosts. The
stage controls remain available without play/pause buttons; water and electricity
advanced automatically during observation. The gas page also passed a 390 px
viewport check without horizontal overflow. Public screenshots are saved in the
same release directory.

## Capacity observation, 2026-09-19

The server filesystem had no free space available to ordinary users. Root still
had approximately 5.8 GB in the filesystem reserve; this four-site payload is
about 72 MB. The deploy script requires at least twice the payload size plus
256 MiB before staging. This observation is separate from successful website
checks: the server needs a scoped disk-space investigation. No unrelated data,
logs, or old releases are deleted by the deployment.

### Capacity recheck, 2026-10-09

A read-only SSH check confirmed 73,901,281,280 bytes (about 68.8 GiB) available
to ordinary users, active Nginx and the same four `current` release targets.
The September full-disk observation is no longer a current blocker. No server
files or services were changed during that capacity inspection. The panel was
subsequently installed on 2026-10-10; its current deployment is documented
[here](hetzner-preview-2026-10-10.md). Production-domain requirements are in
[Production readiness](production-readiness.md).
