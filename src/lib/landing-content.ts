import { getCollection, type CollectionEntry } from "astro:content";
import { getCurrentSiteId, SITES, type SiteId } from "../config/sites";

export type LandingSiteId = Exclude<SiteId, "lbi">;
export type LandingPage = CollectionEntry<"pages">["data"];

export async function getLandingPage(siteId: LandingSiteId): Promise<LandingPage> {
  const entries = await getCollection("pages", ({ data }) => data.site === siteId && data.path === "/" && !data.draft);
  if (entries.length !== 1) throw new Error(`Expected one published homepage for ${siteId}.`);
  return entries[0].data;
}

/** Local links stay local on their own site; cross-site previews use the target domain. */
export function landingHref(siteId: SiteId, href: string): string {
  return href.startsWith("/") && getCurrentSiteId() !== siteId
    ? new URL(href, SITES[siteId].domain).toString()
    : href;
}

export function paragraphs(body?: string): string[] {
  return body?.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean) ?? [];
}

export function processStep(value: string) {
  const separator = value.indexOf(": ");
  return separator < 0
    ? { title: value, body: "" }
    : { title: value.slice(0, separator), body: value.slice(separator + 2) };
}
