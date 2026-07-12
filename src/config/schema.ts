import { isPlaceholder, isMicrosite, LBI_MAIN_URL, type SiteConfig } from "./sites";

/**
 * Safe, generic JSON-LD builders. Important rules:
 *  - Never emit aggregateRating / review schema unless real reviews exist.
 *  - Never emit address / KVK / opening hours while they are placeholders.
 *  - Microsites reference LBI Installaties as parentOrganization (honest).
 */

type Json = Record<string, unknown>;

function phoneFromHref(href: string): string {
  return href.replace(/^tel:/, "");
}

/** Stable @id for the business node on a given site. */
export function businessId(site: SiteConfig): string {
  return `${site.domain}/#business`;
}

/**
 * LocalBusiness node describing the company behind the active site.
 * Microsites describe the same company under their own brand, with a
 * parentOrganization pointer back to LBI Installaties.
 */
export function businessSchema(site: SiteConfig): Json {
  const node: Json = {
    "@type": "LocalBusiness",
    "@id": businessId(site),
    name: site.brandName,
    legalName: site.legalName,
    url: `${site.domain}/`,
    telephone: phoneFromHref(site.phoneHref),
    email: site.email,
    areaServed: site.area,
    image: `${site.domain}${site.ogImage}`,
    inLanguage: site.language,
  };

  if (isMicrosite(site)) {
    node.parentOrganization = {
      "@type": "Organization",
      name: site.parentBrand,
      url: `${LBI_MAIN_URL}/`,
    };
  }

  // Only include a postal address once it is no longer a placeholder.
  if (!isPlaceholder(site.address)) {
    node.address = {
      "@type": "PostalAddress",
      streetAddress: site.address,
      addressLocality: "Helmond",
      addressCountry: "NL",
    };
  }

  // KVK as identifier, only when filled in.
  if (!isPlaceholder(site.kvk)) {
    node.identifier = {
      "@type": "PropertyValue",
      propertyID: "KVK",
      value: site.kvk,
    };
  }

  return node;
}

export interface ServiceInput {
  name: string;
  description?: string;
  url: string;
}

export function serviceSchema(site: SiteConfig, service: ServiceInput): Json {
  const node: Json = {
    "@type": "Service",
    name: service.name,
    serviceType: service.name,
    areaServed: site.area,
    url: service.url,
    provider: {
      "@type": "LocalBusiness",
      "@id": businessId(site),
      name: site.brandName,
    },
  };
  if (service.description) node.description = service.description;
  return node;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export function faqPageSchema(faqs: FaqItem[]): Json | null {
  if (!faqs || faqs.length === 0) return null;
  return {
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer,
      },
    })),
  };
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function breadcrumbSchema(items: BreadcrumbItem[]): Json | null {
  if (!items || items.length === 0) return null;
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** Wrap one or more nodes into a single @graph document. */
export function jsonLdGraph(nodes: Array<Json | null>): string {
  const graph = nodes.filter((n): n is Json => Boolean(n));
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": graph,
  });
}
