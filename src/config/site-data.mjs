export const sites = {
  lbi: {
    id: "lbi",
    domain: "https://www.lbi-helmond.nl",
    brandName: "LBI Installaties",
    phone: "06 532 29 349",
    phoneHref: "tel:+31653229349",
    whatsappHref: "https://wa.me/31653229349",
    email: "lbi.helmond@protonmail.com",
    language: "nl-NL",
    area: "Helmond en omgeving",
    legalName: "LBI Installaties",
    kvk: "[KVK-NUMMER]",
    btw: "[BTW-ID]",
    address: "[ADRES]",
    parentBrand: null,
    subtitle: null,
    primaryService: "Installatiebedrijf in Helmond",
    theme: {
      accent: "oklch(55% 0.14 37)",
      accentDark: "oklch(38% 0.12 37)",
      surfaceTint: "oklch(95% 0.014 82)",
    },
  },
  elektra: {
    id: "elektra",
    domain: "https://www.elektrastoring-helmond.nl",
    brandName: "Elektra Storing Helmond",
    parentBrand: "LBI Installaties",
    subtitle: "Onderdeel van LBI Installaties",
    phone: "06 532 29 349",
    phoneHref: "tel:+31653229349",
    whatsappHref: "https://wa.me/31653229349",
    email: "lbi.helmond@protonmail.com",
    language: "nl-NL",
    area: "Helmond en omgeving",
    legalName: "LBI Installaties",
    kvk: "[KVK-NUMMER]",
    btw: "[BTW-ID]",
    address: "[ADRES]",
    primaryService: "Elektricien bij storing in Helmond",
    theme: {
      accent: "oklch(58% 0.14 78)",
      accentDark: "oklch(38% 0.1 78)",
      surfaceTint: "oklch(96% 0.018 86)",
    },
  },
  lekkage: {
    id: "lekkage",
    domain: "https://www.lekkage-reparatie-helmond.nl",
    brandName: "Lekkage Reparatie Helmond",
    parentBrand: "LBI Installaties",
    subtitle: "Onderdeel van LBI Installaties",
    phone: "06 532 29 349",
    phoneHref: "tel:+31653229349",
    whatsappHref: "https://wa.me/31653229349",
    email: "lbi.helmond@protonmail.com",
    language: "nl-NL",
    area: "Helmond en omgeving",
    legalName: "LBI Installaties",
    kvk: "[KVK-NUMMER]",
    btw: "[BTW-ID]",
    address: "[ADRES]",
    primaryService: "Lekkage reparatie in Helmond",
    theme: {
      accent: "oklch(54% 0.11 210)",
      accentDark: "oklch(36% 0.09 210)",
      surfaceTint: "oklch(96% 0.012 218)",
    },
  },
  gas: {
    id: "gas",
    domain: "https://www.gasleiding-service-helmond.nl",
    brandName: "Gasleiding Service Helmond",
    parentBrand: "LBI Installaties",
    subtitle: "Onderdeel van LBI Installaties",
    phone: "06 532 29 349",
    phoneHref: "tel:+31653229349",
    whatsappHref: "https://wa.me/31653229349",
    email: "lbi.helmond@protonmail.com",
    language: "nl-NL",
    area: "Helmond en omgeving",
    legalName: "LBI Installaties",
    kvk: "[KVK-NUMMER]",
    btw: "[BTW-ID]",
    address: "[ADRES]",
    primaryService: "Gasleiding service in Helmond",
    theme: {
      accent: "oklch(53% 0.13 145)",
      accentDark: "oklch(34% 0.1 145)",
      surfaceTint: "oklch(96% 0.014 150)",
    },
  },
};

export function getSiteIds() {
  return Object.keys(sites);
}

export function getSiteById(siteId = "lbi") {
  const site = sites[siteId];
  if (!site) {
    throw new Error(
      `Unknown SITE_ID "${siteId}". Expected one of: ${getSiteIds().join(", ")}`,
    );
  }
  return site;
}
