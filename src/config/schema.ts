import type { CollectionEntry } from "astro:content";
import type { SiteConfig } from "./sites";

type PageEntry = CollectionEntry<"pages">;

export function localBusinessSchema(site: SiteConfig) {
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: site.brandName,
    legalName: site.legalName,
    url: site.domain,
    telephone: site.phone,
    email: site.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: site.address,
      addressLocality: "Helmond",
      addressCountry: "NL",
    },
    areaServed: site.area,
  };
}

export function serviceSchema(site: SiteConfig, page: PageEntry) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: page.data.h1,
    provider: {
      "@type": "ProfessionalService",
      name: site.legalName,
      telephone: site.phone,
      url: site.domain,
    },
    areaServed: site.area,
    serviceType: page.data.focus_keyword || site.primaryService,
    url: new URL(page.data.path, site.domain).toString(),
  };
}

export function faqSchema(page: PageEntry) {
  if (!page.data.faqs?.length) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.data.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

export function breadcrumbSchema(
  site: SiteConfig,
  breadcrumbs: Array<{ label: string; href: string }>,
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbs.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: new URL(item.href, site.domain).toString(),
    })),
  };
}
