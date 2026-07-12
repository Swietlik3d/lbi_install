import { getCollection } from "astro:content";

export interface GlobalSettings {
  key: string;
  trust_badges: { label: string; note?: string }[];
  footer_note?: string;
  business_hours_note?: string;
}

/** Returns the global settings entry (CMS-editable) or undefined if none exists. */
export async function getGlobalSettings(): Promise<GlobalSettings | undefined> {
  const all = await getCollection("settings");
  const entry = all.find((s) => s.data.key === "global") ?? all[0];
  return entry?.data as GlobalSettings | undefined;
}
