import {
  sites as siteData,
  getSiteById as getSite,
  getSiteIds as getIds,
} from "./site-data.mjs";

export type SiteId = "lbi" | "elektra" | "lekkage" | "gas";

export type SiteConfig = {
  id: SiteId;
  domain: string;
  brandName: string;
  parentBrand: string | null;
  subtitle: string | null;
  phone: string;
  phoneHref: string;
  whatsappHref: string;
  email: string;
  language: "nl-NL";
  area: string;
  legalName: string;
  kvk: string;
  btw: string;
  address: string;
  primaryService: string;
  theme: {
    accent: string;
    accentDark: string;
    surfaceTint: string;
  };
};

export const sites = siteData as Record<SiteId, SiteConfig>;

export function getSiteIds() {
  return getIds() as SiteId[];
}

export function getSiteById(
  siteId: string | undefined = import.meta.env.PUBLIC_SITE_ID || "lbi",
) {
  return getSite(siteId) as SiteConfig;
}

export const activeSite = getSiteById();
