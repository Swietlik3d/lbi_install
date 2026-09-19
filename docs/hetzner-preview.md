# Hetzner client previews

The four previews use the existing Hetzner host `178.105.195.84` and separate
HTTPS virtual hosts. Their URLs do not use the BezwaarPilot domain.

| Site | Client URL |
| --- | --- |
| LBI Installaties | https://lbi-preview.178-105-195-84.sslip.io/ |
| Elektra | https://elektra-preview.178-105-195-84.sslip.io/ |
| Lekkage | https://lekkage-preview.178-105-195-84.sslip.io/ |
| Gas | https://gas-preview.178-105-195-84.sslip.io/ |

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

Admin files, concept routes, hidden files, and repository source are excluded.
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

No nginx edits, service restarts, firewall changes, or unrelated application
changes are required.

After deployment, verify the public endpoints from the client machine:

```sh
node scripts/verify-live-hetzner-preview.mjs
```

## Verified release, 2026-09-19

Release `20260919T002319Z` is active on all four sites. The archive SHA-256 is
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
