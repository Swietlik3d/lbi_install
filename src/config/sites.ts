import sitesData from "./sites.json";

/**
 * Single source of truth for the four sites lives in `sites.json` so that
 * both the TypeScript app and the plain-Node build scripts can read it.
 * This module adds types and runtime helpers on top.
 */

export type SiteId = "lbi" | "elektra" | "lekkage" | "gas";

export type FormProvider = "none" | "netlify" | "formspree" | "custom";

export interface SiteConfig {
  id: SiteId;
  /** Canonical origin, including protocol + www. No trailing slash. */
  domain: string;
  brandName: string;
  /** Parent brand for microsites, "" for the main LBI site. */
  parentBrand: string;
  /** Visible subtitle for microsites, "" for the main LBI site. */
  subtitle: string;
  tagline: string;
  phone: string;
  phoneHref: string;
  whatsappHref: string;
  email: string;
  language: string;
  area: string;
  legalName: string;
  kvk: string;
  btw: string;
  address: string;
  themeColor: string;
  ogImage: string;
  enableContactForm: boolean;
  formProvider: FormProvider;
}

export const SITES = sitesData as Record<SiteId, SiteConfig>;

export const SITE_IDS = Object.keys(SITES) as SiteId[];

/** The canonical main-brand URL, used by microsite footers. */
export const LBI_MAIN_URL = SITES.lbi.domain;

/** Validate an arbitrary string into a known SiteId, defaulting to "lbi". */
export function resolveSiteId(value?: string | null): SiteId {
  if (value && (SITE_IDS as string[]).includes(value)) {
    return value as SiteId;
  }
  return "lbi";
}

/** Read the active site id from SITE_ID at build time (Node context). */
export function getCurrentSiteId(): SiteId {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return resolveSiteId(env?.SITE_ID);
}

/** Full config object for the active site. */
export function getCurrentSite(): SiteConfig {
  return SITES[getCurrentSiteId()];
}

/** True when a config field is still an unfilled placeholder like "[ADRES]". */
export function isPlaceholder(value: string | undefined | null): boolean {
  if (!value) return true;
  const v = value.trim();
  return v.length === 0 || v.startsWith("[") || v.toUpperCase().includes("TODO");
}

/** Is this one of the three emergency microsites (i.e. not the main LBI site)? */
export function isMicrosite(site: SiteConfig): boolean {
  return site.id !== "lbi";
}
