# LBI Installaties — multi-site (Astro + Tailwind + Decap CMS)

One codebase that builds **four separate static websites** from shared components,
a shared design system and a shared CMS:

| SITE_ID    | Brand                       | Domain                                   |
| ---------- | --------------------------- | ---------------------------------------- |
| `lbi`      | LBI Installaties            | https://www.lbi-helmond.nl               |
| `elektra`  | Elektra Storing Helmond     | https://www.elektrastoring-helmond.nl    |
| `lekkage`  | Lekkage Reparatie Helmond   | https://www.lekkage-reparatie-helmond.nl |
| `gas`      | Gasleiding Service Helmond  | https://www.gasleiding-service-helmond.nl|

The three microsites carry the subtitle **"Onderdeel van LBI Installaties"** and link
back to the main site, but each is a **standalone website** with its own domain,
canonical URLs, sitemap and robots.txt. Microsites are **not** canonicalised back to LBI.

- **Stack:** Astro 5 (static output), TypeScript (strict), Tailwind CSS v3, Decap CMS.
- **No SSR, no database, no server functions.** Pure static HTML per site.
- **Minimal JavaScript:** one tiny inline analytics-delegation script; menus and FAQ use
  native `<details>` (no framework).

> ⚠️ **This project was scaffolded but NOT built in the authoring environment**
> (the sandbox had no disk space to run `npm install`). Run the commands below locally;
> it is written against standard Astro 5 patterns and pinned versions. If anything fails,
> see **Troubleshooting**.

---

## 1. Requirements

- **Node.js ≥ 18.20** (or ≥ 20). Check with `node -v`.
- npm (ships with Node).

## 2. Install

```bash
npm install
```

## 3. Local development

Dev runs **one site at a time** (the active site is chosen by `SITE_ID`):

```bash
npm run dev:lbi       # http://localhost:4321
npm run dev:elektra
npm run dev:lekkage
npm run dev:gas
```

`npm run dev` is an alias for `dev:lbi`. The `cross-env` package makes `SITE_ID`
work on Windows, macOS and Linux.

## 4. Build

Each site builds into its own folder under `dist/`:

```bash
npm run build:lbi       # -> dist/lbi
npm run build:elektra   # -> dist/elektra
npm run build:lekkage   # -> dist/lekkage
npm run build:gas       # -> dist/gas

npm run build:all       # builds all four
```

Each build also writes `sitemap.xml` and `robots.txt` into that site's `dist/<site>/`
folder, using that site's own domain.

Preview a finished build locally:

```bash
npm run preview:lbi     # serves dist/lbi
```

## 5. Type checking

```bash
npm run check       # astro check for the lbi content set
npm run check:all   # astro check for all four SITE_IDs
```

---

## 6. How the multi-site mechanism works

- **`src/config/sites.json`** is the single source of truth (domains, brand, phone,
  WhatsApp, email, KVK/BTW/address placeholders, theme color). It is plain JSON so both
  the app and the Node build scripts can read it.
- **`SITE_ID`** (env var) selects the active site at build time.
  `astro.config.ts` reads it to set `site` (domain) and `outDir` (`dist/<site>`).
- **`src/pages/[...slug].astro`** is the only route. In `getStaticPaths()` it loads the
  `pages` content collection and keeps only entries whose `site` matches `SITE_ID` and
  that are not `draft`. The page's `path` frontmatter becomes the URL. A path that does
  not exist for the active site simply isn't generated → the per-site `404.astro` shows.
- **Layouts** are chosen by `page_type`: `home → HomeLayout`, `service → ServiceLayout`,
  `emergency → EmergencyLayout`, `contact → ContactLayout`, everything else → `PageLayout`.
- **Theming** is per-site via CSS variables on `<html data-site="…">`
  (see `src/styles/global.css`). Change a site's colors there.

---

## 7. Editing content in Decap CMS

The admin UI lives at **`/admin/`** (e.g. `https://www.lbi-helmond.nl/admin/`).
It edits the markdown/JSON files in this repo through Git.

### Local editing (no login)

```bash
npm run dev:lbi          # terminal 1 (any site works)
npx decap-server         # terminal 2  (the "local backend")
# open http://localhost:4321/admin/
```

`local_backend: true` in `public/admin/config.yml` enables this.

### Production editing (choose a backend)

`config.yml` ships with the **git-gateway** backend (works with **Netlify Identity**):

1. Host the `lbi` build on Netlify (or use Netlify only as the identity/gateway).
2. Enable **Identity** and **Git Gateway** in the Netlify site settings.
3. Invite editors; they log in at `/admin/`.

Prefer GitHub auth instead? Replace the backend block in `config.yml` with:

```yaml
backend:
  name: github
  repo: your-org/your-repo
  branch: main
```

(and host an OAuth provider, e.g. via Netlify or a small worker).

### What editors can change

- **Pages** per site (LBI / Elektra / Lekkage / Gas): meta title & description, H1, hero,
  sections, bullets, FAQ, CTA text, internal links, images + alt text, safety toggle, draft.
- **Projects** and **Reviews** (shared; assign a site). Reviews stay **draft** until you
  publish a real, verifiable one.
- **Global settings**: trust badges + footer note.
- **Bedrijfsgegevens** (`Company`): contact + legal fields, written back to `sites.json`.

> The CMS only writes the fields defined in `config.yml`. For `sites.json`, structural
> fields (id, domain, brand, theme color) are kept as **hidden** fields so they are
> preserved on save — don't remove them from the config.

---

## 8. Replacing placeholder data (do this before launch)

Search the repo for `TODO` and `[` placeholders. The important ones:

- **`src/config/sites.json`** — replace `[KVK-NUMMER]`, `[BTW-ID]`, `[ADRES]` with real
  values (or via the CMS "Bedrijfsgegevens" screen). Phone, WhatsApp and email are
  already filled in.
- **Reviews** — only publish **real, verifiable** reviews. The repo ships none.
- **Projects** — the LBI homepage and `/projecten/` share three projects with real photos
  from `pics/`. Their dates and locations are examples, visibly marked by
  `exampleDetails: true`. Replace these values and turn that flag off when confirmed.
  Add entries through **Projecten** in the CMS or `src/content/projects/*.md`.
  Published entries require a title, summary, photo, alt text, date and location.
  The timeline sorts by date (newest first); the homepage shows the first three.
  `order` breaks date ties. Drafts stay hidden. The visible description comes from
  `summary`; the Markdown body can hold internal source notes.
- **Privacy & cookies** (`src/content/pages/lbi/privacy-cookies.md`) — fill in and have it
  legally checked.
- **Opening hours / availability** — none are claimed anywhere. Add them only if true.
  Do **not** add "24/7", certifications, guarantees or experience claims unless factual.

## 9. Adding a new page

1. Create a markdown file in `src/content/pages/<site>/your-page.md`.
2. Required frontmatter: `site`, `path` (e.g. `/your-page/` with leading & trailing slash),
   `page_type`, `meta_title`, `meta_description`, `h1`. Everything else is optional.
3. Add it to the menu in **`src/config/navigation.ts`** if it should appear in the nav.
4. (Optional) link to it from other pages via their `internal_links`.

Example minimal page:

```markdown
---
site: "lbi"
path: "/nieuwe-dienst/"
page_type: "service"
meta_title: "Nieuwe dienst | LBI Installaties Helmond"
meta_description: "Korte, wervende omschrijving van max ~155 tekens."
h1: "Nieuwe dienst in Helmond"
hero:
  subtitle: "Eén zin die de dienst samenvat."
sections:
  - heading: "Wat we doen"
    body: "Lopende tekst…"
    bullets: ["Punt 1", "Punt 2"]
faqs:
  - question: "Een vraag?"
    answer: "Een antwoord."
internal_links:
  - { label: "Contact", href: "/contact/", description: "Plan een afspraak." }
---

Optionele extra tekst (markdown).
```

## 10. Images

See **`public/images/README.md`**. In short: put files in `public/images/<site>/`,
reference them as `/images/<site>/<file>`, keep them < ~250 KB, always add alt text,
and add a `1200×630` `og-default.jpg` per site for social previews.

## 11. Deployment (per domain)

Each domain is a separate static deploy of its `dist/<site>` folder. Works on any static
host (Netlify, Vercel, Cloudflare Pages, or plain hosting / FTP).

### Option A — four Netlify sites (recommended; needed for CMS git-gateway)

For **each** site create a Netlify site from the same repo with:

| Setting          | lbi                 | elektra                 | lekkage                 | gas                 |
| ---------------- | ------------------- | ----------------------- | ----------------------- | ------------------- |
| Build command    | `npm run build:lbi` | `npm run build:elektra` | `npm run build:lekkage` | `npm run build:gas` |
| Publish directory| `dist/lbi`          | `dist/elektra`          | `dist/lekkage`          | `dist/gas`          |

Then point each custom domain (with `www`) at its Netlify site and enable HTTPS.
Enable Identity + Git Gateway on the **lbi** site for the CMS.

### Option B — Cloudflare Pages / Vercel

Create four projects, each with the matching `build:<site>` command and `dist/<site>`
output directory, and attach the matching domain.

### Option C — manual / FTP

```bash
npm run build:all
# upload the contents of dist/lbi      to lbi-helmond.nl
# upload the contents of dist/elektra  to elektrastoring-helmond.nl
# upload the contents of dist/lekkage  to lekkage-reparatie-helmond.nl
# upload the contents of dist/gas      to gasleiding-service-helmond.nl
```

Make sure each host serves `404.html` as the not-found page and (for the bare domain)
redirects to the `www` host to match the canonical URLs.

The existing online client previews and the update procedure are documented in
[Hetzner client previews](docs/hetzner-preview.md).

## 12. Contact form (optional)

Forms are **off by default** — phone and WhatsApp are the primary conversions.
To enable a form on a site, in `sites.json` set `enableContactForm: true` and
`formProvider` to `netlify`, `formspree` or `custom`. For Formspree/custom, set
`PUBLIC_CONTACT_ENDPOINT` in a `.env` file (see `.env.example`).

## 13. Analytics (optional)

No tracking IDs are hardcoded. Every phone/WhatsApp/submit element emits
`data-event`, `data-site` and `data-page`. A tiny inline script forwards clicks to
`window.dataLayer` if a tag manager is present. Add your GTM/GA snippet in
`src/layouts/BaseLayout.astro` (and disclose cookies in the privacy page).

## 14. Troubleshooting

- **`Cannot find module 'astro:content'` / missing types** → run `npx astro sync`
  (build/dev/check do this automatically).
- **Tailwind classes not applying** → ensure `tailwindcss@^3` is installed (this project
  uses the `@astrojs/tailwind` integration, not Tailwind v4).
- **A page 404s** → check its `path` has a leading **and** trailing slash and that `site`
  matches the build you ran (`SITE_ID`).
- **Decap can't save `sites.json`** → keep all fields (incl. hidden ones) in the `company`
  collection; the CMS only writes fields it knows about.

## 15. Project structure

```
src/
  components/    UI building blocks (Header, Footer, Hero, FAQ, SafetyAlert, …)
  config/        sites.json (+ sites.ts), navigation.ts, schema.ts (JSON-LD)
  content/       pages/<site>/*.md, projects/, reviews/, settings/
  content.config.ts   content-collection schemas (zod)
  layouts/       BaseLayout + Home/Page/Service/Emergency/Contact layouts
  lib/           small helpers (settings)
  pages/         [...slug].astro (router) + 404.astro
  styles/        global.css (Tailwind + per-site theme vars)
public/
  admin/         Decap CMS (index.html + config.yml)
  images/        per-site media folders + placeholder.svg
scripts/         build-site / build-all / generate-sitemap / generate-robots / check-all
```

See **`TEST-CHECKLIST.md`** for a pre-launch QA list.
```
