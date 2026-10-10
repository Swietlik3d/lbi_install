import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Content collections power every page. The dynamic route src/pages/[...slug].astro
 * filters the `pages` collection by the active SITE_ID, so one repo renders four
 * separate sites. Schemas are intentionally forgiving (defaults + optionals) so a
 * half-filled starter page still builds.
 */

const siteEnum = z.enum(["lbi", "elektra", "lekkage", "gas"]);

const ctaSchema = z
  .object({
    label: z.string(),
    href: z.string(),
    style: z.enum(["primary", "ghost", "whatsapp", "accent"]).default("primary"),
    event: z.string().optional(),
  })
  .optional();

const heroSchema = z
  .object({
    kicker: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    showCallButtons: z.boolean().default(true),
  })
  .optional();

const sectionSchema = z.object({
  id: z.string().optional(),
  heading: z.string().optional(),
  body: z.string().optional(),
  bullets: z.array(z.string()).default([]),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  layout: z.enum(["text", "cards", "split", "steps"]).default("text"),
});

const faqSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

const internalLinkSchema = z.object({
  label: z.string(),
  href: z.string(),
  description: z.string().optional(),
});

const imagePlanSchema = z.object({
  slot: z.string(),
  filename: z.string(),
  alt: z.string(),
  note: z.string().optional(),
});

const pages = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: z.object({
    site: siteEnum,
    path: z.string(),
    page_type: z
      .enum([
        "home",
        "service",
        "emergency",
        "contact",
        "overview",
        "legal",
        "about",
        "reviews",
        "area",
        "projects",
      ])
      .default("overview"),
    meta_title: z.string(),
    meta_description: z.string(),
    focus_keyword: z.string().optional(),
    secondary_keywords: z.array(z.string()).default([]),
    h1: z.string(),
    hero: heroSchema,
    sections: z.array(sectionSchema).default([]),
    cta_primary: ctaSchema,
    cta_secondary: ctaSchema,
    faqs: z.array(faqSchema).default([]),
    internal_links: z.array(internalLinkSchema).default([]),
    image_plan: z.array(imagePlanSchema).default([]),
    schema_type: z
      .enum(["WebPage", "Service", "FAQPage", "ContactPage", "AboutPage", "CollectionPage"])
      .default("WebPage"),
    safety_alert: z.boolean().default(false),
    draft: z.boolean().default(false),
    order: z.number().default(0),
  }),
});

const projectSchema = z.object({
    title: z.string(),
    site: siteEnum.default("lbi"),
    category: z.string().optional(),
    location: z.string().optional(),
    date: z.coerce.date().optional(),
    exampleDetails: z.boolean().default(false),
    summary: z.string().optional(),
    cover: z.string().optional(),
    coverAlt: z.string().optional(),
    draft: z.boolean().default(true),
    order: z.number().default(0),
  }).superRefine((project, context) => {
    // Incomplete drafts are allowed; published timeline entries must be complete.
    if (project.draft) return;
    for (const field of ["title", "summary", "cover", "coverAlt", "location"] as const) {
      if (!project[field]?.trim()) {
        context.addIssue({ code: "custom", path: [field], message: "Required for a published project." });
      }
    }
    if (!project.date) {
      context.addIssue({ code: "custom", path: ["date"], message: "Required for a published project." });
    }
  });

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: projectSchema,
});

// Only published snapshots are supplied by the project service. Editable drafts,
// password hashes, and uploads are kept outside both the repository and webroot.
const clientProjects = defineCollection({
  loader: glob({
    pattern: "*.md",
    base: process.env.LBI_CLIENT_PROJECTS_DIR
      ? pathToFileURL(path.resolve(process.env.LBI_CLIENT_PROJECTS_DIR) + path.sep)
      : "./src/content/client-projects",
  }),
  schema: projectSchema,
});

const reviews = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/reviews" }),
  schema: z.object({
    author: z.string(),
    site: siteEnum.default("lbi"),
    rating: z.number().min(1).max(5).optional(),
    quote: z.string(),
    service: z.string().optional(),
    date: z.coerce.date().optional(),
    source: z.string().optional(),
    // Reviews are drafts until a real, verifiable review is entered.
    draft: z.boolean().default(true),
    order: z.number().default(0),
  }),
});

const settings = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/settings" }),
  schema: z.object({
    key: z.string(),
    trust_badges: z
      .array(z.object({ label: z.string(), note: z.string().optional() }))
      .default([]),
    footer_note: z.string().optional(),
    business_hours_note: z.string().optional(),
  }),
});

export const collections = { pages, projects, clientProjects, reviews, settings };
