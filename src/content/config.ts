import { defineCollection, z } from "astro:content";

const linkSchema = z.object({
  label: z.string(),
  href: z.string(),
});

const imageSchema = z.object({
  src: z.string().optional(),
  alt: z.string().optional(),
});

const ctaSchema = z.object({
  label: z.string(),
  href: z.string(),
});

const pageSectionSchema = z.object({
  id: z.string().optional(),
  eyebrow: z.string().optional(),
  heading: z.string(),
  body: z.string().optional(),
  variant: z
    .enum(["text", "cards", "split", "steps", "contact", "projects", "reviews"])
    .default("text"),
  image: imageSchema.optional(),
  items: z
    .array(
      z.object({
        title: z.string(),
        text: z.string().optional(),
        href: z.string().optional(),
        image: imageSchema.optional(),
      }),
    )
    .default([]),
});

const faqSchema = z.object({
  question: z.string(),
  answer: z.string(),
});

const pages = defineCollection({
  type: "content",
  schema: z.object({
    site: z.enum(["lbi", "elektra", "lekkage", "gas"]),
    path: z.string(),
    page_type: z.enum([
      "home",
      "service",
      "overview",
      "projects",
      "reviews",
      "area",
      "about",
      "contact",
      "legal",
    ]),
    meta_title: z.string(),
    meta_description: z.string(),
    focus_keyword: z.string().optional(),
    secondary_keywords: z.array(z.string()).default([]),
    h1: z.string(),
    hero: z.object({
      label: z.string().optional(),
      heading: z.string(),
      text: z.string(),
      image: imageSchema.optional(),
      highlights: z.array(z.string()).default([]),
    }),
    sections: z.array(pageSectionSchema).default([]),
    cta_primary: ctaSchema,
    cta_secondary: ctaSchema.optional(),
    faqs: z.array(faqSchema).default([]),
    internal_links: z.array(linkSchema).default([]),
    image_plan: z.array(imageSchema).default([]),
    schema_type: z
      .enum(["LocalBusiness", "Service", "FAQPage", "WebPage"])
      .default("WebPage"),
    safety_alert: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const projects = defineCollection({
  type: "content",
  schema: z.object({
    site: z.enum(["lbi", "elektra", "lekkage", "gas"]).default("lbi"),
    title: z.string(),
    location: z.string().default("Helmond"),
    summary: z.string(),
    image: imageSchema.optional(),
    services: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const reviews = defineCollection({
  type: "content",
  schema: z.object({
    site: z.enum(["lbi", "elektra", "lekkage", "gas"]).default("lbi"),
    name: z.string(),
    quote: z.string(),
    source: z.string().optional(),
    date: z.string().optional(),
    rating: z.number().min(1).max(5).optional(),
    draft: z.boolean().default(false),
  }),
});

const settings = defineCollection({
  type: "data",
  schema: z.object({
    site: z.enum(["lbi", "elektra", "lekkage", "gas"]),
    contact_form_enabled: z.boolean().default(false),
    contact_form_provider: z
      .enum(["netlify", "formspree", "custom", "disabled"])
      .default("disabled"),
    contact_form_action: z.string().optional(),
    analytics_enabled: z.boolean().default(false),
    analytics_id: z.string().optional(),
  }),
});

export const collections = {
  pages,
  projects,
  reviews,
  settings,
};
