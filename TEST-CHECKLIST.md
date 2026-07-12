# Test checklist — pre-launch QA

Run these after `npm install`. Tick per site where relevant.

## Build & types

- [ ] `npm install` completes without errors.
- [ ] `npm run check:all` passes (no TypeScript / Astro errors) for lbi, elektra, lekkage, gas.
- [ ] `npm run build:all` completes; `dist/lbi`, `dist/elektra`, `dist/lekkage`, `dist/gas` exist.
- [ ] Each `dist/<site>/` contains `sitemap.xml` and `robots.txt`.
- [ ] `sitemap.xml` lists only that site's pages, with that site's domain, and **no** `/admin/` or `/404`.
- [ ] `robots.txt` references `https://www.<that-domain>/sitemap.xml` and disallows `/admin/`.

## Per-site smoke test (`npm run preview:<site>`)

For each of the four sites:

- [ ] Home renders with a clear hero and a visible **Bel direct** button above the fold.
- [ ] All navigation links work and match the per-site menu.
- [ ] Sticky bottom call bar (Bel direct + WhatsApp) shows on mobile, hidden on desktop.
- [ ] Footer shows correct brand; microsites show **"Onderdeel van LBI Installaties"** and link to lbi-helmond.nl.
- [ ] Every page has exactly **one `<h1>`**.
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

- [ ] Internal links resolve (no 404s) — crawl with e.g. `npx linkinator dist/lbi --recurse`.
- [ ] Cross-site links between LBI and microsites use full `https://www.…` URLs.

## Performance (Lighthouse on a preview build)

- [ ] Performance & SEO ≥ 95, Accessibility ≥ 95 on mobile.
- [ ] No layout shift on the hero (image has width/height / fixed aspect ratio).
- [ ] Total JS is tiny (only the inline analytics delegator).

## CMS

- [ ] `/admin/` loads; `npx decap-server` + local backend lets you edit and save a page.
- [ ] Editing a page in the CMS changes the rendered output after rebuild.
- [ ] Saving "Bedrijfsgegevens" preserves all `sites.json` fields (nothing dropped).
```
