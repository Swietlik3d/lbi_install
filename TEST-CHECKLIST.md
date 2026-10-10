# Test checklist — pre-launch QA

Run these after `npm ci`. Tick per site where relevant. Checked items below have evidence from 10 October 2026; see [production readiness](docs/production-readiness.md). A local or transient Linux PASS does not mark the final HTTPS deployment checks complete.

## Build & types

- [x] `npm ci --ignore-scripts` completes on the fresh public Linux proof snapshot.
- [x] `npm run check:all` passes (no TypeScript / Astro errors) for lbi, elektra, lekkage, gas.
- [x] `npm run build:all` completes; `dist/lbi`, `dist/elektra`, `dist/lekkage`, `dist/gas` exist.
- [x] Each `dist/<site>/` contains `sitemap.xml` and `robots.txt`.
- [x] `sitemap.xml` lists only that site's pages, with that site's domain, and **no** `/admin/`, `/beheer/` or `/404`.
- [x] `robots.txt` references `https://www.<that-domain>/sitemap.xml` and disallows `/admin/` and `/beheer/`.
- [x] Full and production audits show zero vulnerabilities after the controlled Astro/Tailwind migration; appearance review is recorded separately below.

## Per-site smoke test (`npm run preview:<site>`)

For each of the four sites:

- [x] Home renders with a clear hero and a visible call CTA above the fold at all three tested widths; Gas keeps its emergency/safety CTA first.
- [ ] All navigation links work and match the per-site menu.
- [ ] Sticky bottom call bar (Bel direct + WhatsApp) shows on mobile, hidden on desktop.
- [ ] Footer shows correct brand; microsites show **"Onderdeel van LBI Installaties"** and link to lbi-helmond.nl.
- [x] Every public page has exactly **one `<h1>`**, verified in all four static builds.
- [ ] No broken images (placeholder.svg shows where no photo is set yet).
- [ ] Visiting a non-existent URL shows the branded 404 page.

## SEO

- [ ] Each page has a unique `<title>` and meta description.
- [ ] `<link rel="canonical">` uses the **active site's own domain** (microsites are NOT canonicalised to LBI).
- [ ] Open Graph + Twitter tags present (`og:title`, `og:url`, `og:image`, `twitter:card`).
- [ ] JSON-LD validates (paste page source into https://validator.schema.org/):
  - [ ] `LocalBusiness` on every page; microsites include `parentOrganization` = LBI Installaties.
  - [ ] `BreadcrumbList` on inner pages.
  - [ ] `Service` on service pages; `FAQPage` on pages with FAQs.
  - [ ] **No** `aggregateRating` / `Review` schema (none until real reviews exist).
- [ ] No `address`, `KVK` or opening hours appear while still placeholders.

## Gas safety (site = gas)

- [ ] The safety block appears on gas pages where `safety_alert: true` (home, all subpages, contact).
- [ ] On `/veiligheid-bij-gaslucht/` the safety block appears **above** the commercial CTA.
- [ ] Safety text matches exactly and `0800-9009` / `112` are tap-to-call links.

## Accessibility

- [ ] Keyboard: Tab reaches the skip link, menu, all links/buttons; focus ring is visible.
- [ ] Mobile menu (`<details>`) opens/closes with keyboard and has an aria-label.
- [ ] Color contrast passes AA (check brand buttons + text on each site theme).
- [ ] All `<img>` have meaningful `alt` (replace TODO alts with real descriptions).
- [ ] Headings are in order (no skipped levels).

## Content integrity (no fabrication)

- [ ] No invented reviews, ratings, certifications, guarantees, years of experience or 24/7 claims.
- [ ] `[KVK-NUMMER]`, `[BTW-ID]`, `[ADRES]` either replaced or intentionally still placeholder.
- [ ] Privacy & cookies page filled in and legally checked.

## Links

- [x] Internal/cross-site local targets, anchors and assets resolve — `npm run test:sites`, 1065 references across all four builds.
- [x] Cross-site links between LBI and microsites use full `https://www.…` URLs.

## Performance (Lighthouse on a preview build)

- [ ] Performance & SEO ≥ 95, Accessibility ≥ 95 on mobile.
- [ ] No layout shift on the hero (image has width/height / fixed aspect ratio).
- [x] Three.js scenes start automatically, stages advance every 3 seconds, and water/gas/electricity effects match the accepted version (three viewport sizes plus the fresh-session timing test).
- [x] Automatic stage cycling stops with reduced motion; manual stage selection remains available on all three landing pages.
- [x] WebGL fallback shows the static illustration, content and contact CTA on Elektra, Lekkage and Gas (desktop, WebGL disabled for the full isolated session).
- [ ] Hidden scenes pause work; reduced-motion behavior of all WebGL frames is verified.
- [ ] Measure actual Three.js bundle/network cost, frame rate and mobile power impact; do not assume the old analytics-only JS budget.

## Client project panel — local and HTTPS staging

- [x] `npm run test:admin` passes (103 assertions); synthetic real-build `test:admin:e2e` passes on the disposable local preview.
- [x] `npm run test:admin:builder` passes (22 assertions); malformed output, cache configuration and cleanup failure are checked.
- [ ] Client logs in with a separate password, without GitHub. Invalid login and expiry show usable errors.
- [ ] Photo validation/conversion, title/date/place/summary/alt, draft save, reload/edit and explicit publish work.
- [ ] Other drafts stay hidden; old projects stay present. Published project/photo appear on timeline and newest-three homepage selection.
- [ ] Busy controls prevent losing edits; keyboard and mobile/tablet/desktop layouts work.
- [x] Isolated builder cannot access private records, password hash or unpublished media; verified with a separate UID and kernel restrictions on the disposable Linux proof. Recheck after persistent service installation.
- [ ] Nginx real-IP login limit, HTTPS cookie, origin/CSRF and public/private permissions verified on staging.
- [ ] Production password set through hidden prompt. Rotation includes service restart; old password and sessions stop working.
- [ ] Backup outside webroot/off-server and isolated restore tested. Rollback/crash recovery/free-space failures verified.
- [ ] Retention preserves current release, rollback, referenced media and backups; limits are monitored.

## Technical CMS (optional)

- [ ] `/admin/` loads; `npx decap-server` + local backend lets you edit and save a page.
- [ ] Editing a page in the CMS changes the rendered output after rebuild.
- [ ] Saving "Bedrijfsgegevens" preserves all `sites.json` fields (nothing dropped).
