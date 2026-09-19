# Microsite content map

Visitor-facing content for the three microsites was transferred from the local split source packs into the corresponding Astro page frontmatter. The rendered Markdown bodies are intentionally empty: the landing UI consumes `hero`, `sections`, `faqs`, `internal_links`, and CTA fields.

| Site | Route pages | Source | Transfer per page | Excluded source material |
| --- | --- | --- | --- | --- |
| Elektra Storing Helmond | `/`, `/kortsluiting-groep-valt-uit/`, `/meterkast-groepen/`, `/werkwijze-faq/`, `/contact/` | `elektrastoring-helmond_nl.md`, pages 1–5, lines 6–623 | Hero, 4–5 source prose sections, 5-item call list, four steps, 6 FAQs, 5 links per page | Frontmatter instructions, image plans, schema suggestions, conversion notes and unconfirmed-business-data placeholders |
| Lekkage Reparatie Helmond | `/`, `/lekkage-badkamer-keuken/`, `/waterleiding-afvoer-riolering/`, `/werkwijze-faq/`, `/contact/` | `lekkage-reparatie-helmond_nl.md`, pages 1–5, lines 6–623 | Hero, 4–5 source prose sections, 5-item call list, four steps, 6 FAQs, 5 links per page | Frontmatter instructions, image plans, schema suggestions, conversion notes and unconfirmed-business-data placeholders |
| Gasleiding Service Helmond | `/`, `/gasleiding-aansluiten-verleggen/`, `/controle-herstel/`, `/veiligheid-bij-gaslucht/`, `/contact/` | `gasleiding-service-helmond_nl.md`, pages 1–5, lines 6–623 | Hero, 4–5 safety-led source prose sections, 5-item call list, four steps, 6 FAQs, 5 links per page | Frontmatter instructions, image plans, schema suggestions, conversion notes and unconfirmed-business-data placeholders |

`extra_onderdelen.md` lines 5–16 informed the common plain-language tone, the no-unverified-claims rule, visible LBI relationship, and the gas safety ordering. Its CTA list at lines 18–39 informed the supplied call and WhatsApp labels.

## Resolved discrepancies

- The approved landing headlines are retained as multiline `h1` values on all three home pages. Source SEO headlines remain in meta fields and visitor prose.
- Source packs label some home pages `emergency`; established repository `page_type` values were preserved.
- All gas pages set `safety_alert: true`; gas hero call buttons are disabled so safety text precedes any LBI commercial contact. Gas content directs acute gas smell to 0800-9009 and direct danger to 112, with LBI only after a safe situation.
- Every LBI external link is normalized to `https://www.lbi-helmond.nl/`; microsite links remain root-relative.
- All visitor prose and FAQ answers retain the full source content. The editorial paragraphs “Geen noodclaim”, “Geen onnodige beloftes” and “Bedrijfsgegevens” are excluded; the gas “Binneninstallatie” paragraph retains its service scope and gives the correct emergency contact instead of authoring instructions.
- The source Elektra contact FAQ about an unpublished address contained only `[ADRES]` instructions. It is replaced with an appointment question using the existing telephone, WhatsApp and availability information. No address is invented.
- Every page has six FAQs (90 total), five call-list items and four full process steps. Gas process steps additionally require a safe situation before contacting LBI or taking photos.
