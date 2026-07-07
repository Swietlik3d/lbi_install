# LBI Installaties multisite

Static Astro project for one main company site and three emergency microsites:

- `lbi`: `https://www.lbi-helmond.nl`
- `elektra`: `https://www.elektrastoring-helmond.nl`
- `lekkage`: `https://www.lekkage-reparatie-helmond.nl`
- `gas`: `https://www.gasleiding-service-helmond.nl`

The project uses one codebase, shared components, shared content schemas and separate static output folders.

## Installation

```bash
npm install
```

## Local Development

Run the default LBI site:

```bash
npm run dev:lbi
```

Run a microsite:

```bash
npm run dev:elektra
npm run dev:lekkage
npm run dev:gas
```

The active site is selected with `SITE_ID`. Valid values are `lbi`, `elektra`, `lekkage` and `gas`.

## Builds

```bash
npm run build:lbi
npm run build:elektra
npm run build:lekkage
npm run build:gas
npm run build:all
```

Output folders:

- `dist/lbi`
- `dist/elektra`
- `dist/lekkage`
- `dist/gas`

Each build creates its own `sitemap.xml`, `robots.txt`, canonical URLs and metadata.

## Deployment

Deploy each domain from its own output folder:

- `lbi-helmond.nl` -> `dist/lbi`
- `elektrastoring-helmond.nl` -> `dist/elektra`
- `lekkage-reparatie-helmond.nl` -> `dist/lekkage`
- `gasleiding-service-helmond.nl` -> `dist/gas`

Use static hosting only. No SSR, database or server-side functions are required.

## Decap CMS

Admin route:

```text
/admin/
```

Config files:

- `public/admin/index.html`
- `public/admin/config.yml`

Collections:

- LBI pages
- Elektra pages
- Lekkage pages
- Gas pages
- Projects
- Reviews
- Global settings

Local Decap development usually requires the Decap local backend:

```bash
npx decap-server
```

Then run the Astro dev server for the site you want to edit.

## Content

Page content lives in:

```text
src/content/pages/lbi
src/content/pages/elektra
src/content/pages/lekkage
src/content/pages/gas
```

The starter content intentionally uses TODO placeholders where real business data is missing. Do not invent:

- KVK number
- BTW ID
- address
- reviews
- certifications
- warranty terms
- opening hours
- 24/7 availability

Add real projects only in `src/content/projects` after photos and permission are available. Add reviews only in `src/content/reviews` when the review is real and allowed to be published.

## Adding Pages

1. Add a Markdown file in the correct site folder under `src/content/pages`.
2. Set `site`, `path`, `page_type`, metadata, H1, hero, CTAs and sections.
3. Add the page to `src/config/navigation.ts` if it belongs in the menu.
4. Build the active site and check the generated page.

## Image Guidelines

Use site-specific folders:

```text
public/images/lbi
public/images/elektra
public/images/lekkage
public/images/gas
```

Use real or approved generated images with clear alt text. Avoid fake logos, readable invented labels, fake badges, fake certificates and stock-like images that do not show the actual service context.

## Safety

Gas pages support `safety_alert: true`. When enabled, the gas safety block appears above the commercial CTA and says:

```text
Ruikt u gas? Open ramen en deuren indien dit veilig kan, gebruik geen vuur en schakel geen elektrische apparaten aan of uit. Sluit de hoofdkraan indien dit veilig kan, ga naar buiten en bel het Nationaal Storingsnummer 0800-9009. Bij direct gevaar: bel 112.
```

## Basic Test Checklist

- Run `npm run check`.
- Run `npm run build:all`.
- Confirm each `dist/*` folder contains `index.html`, `404.html`, `sitemap.xml` and `robots.txt`.
- Open each homepage and at least one service page.
- Check desktop and mobile widths.
- Verify header nav, footer links, phone links and WhatsApp links.
- Verify gas pages show the safety alert.
- Verify no fake reviews or fake legal claims were added.
