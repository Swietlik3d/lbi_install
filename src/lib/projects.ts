import type { CollectionEntry } from "astro:content";

export type ProjectItem = CollectionEntry<"projects">["data"] & { id: string };

/** Newest first; undated projects follow, with the CMS order as a tie-breaker. */
export function compareProjects(a: ProjectItem, b: ProjectItem): number {
  if (a.date && b.date) {
    const difference = b.date.getTime() - a.date.getTime();
    if (difference) return difference;
  } else if (a.date || b.date) {
    return a.date ? -1 : 1;
  }
  return a.order - b.order || a.id.localeCompare(b.id);
}

export function projectDate(date?: Date): string {
  return date
    ? new Intl.DateTimeFormat("nl-NL", {
        day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
      }).format(date)
    : "Datum volgt";
}
