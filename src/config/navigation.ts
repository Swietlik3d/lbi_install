import type { SiteId } from "./sites";

export interface NavItem {
  label: string;
  href: string;
}

/**
 * Primary navigation per site. Hrefs are root-relative and always use a
 * trailing slash to match `trailingSlash: "always"` in astro.config.ts.
 */
export const NAVIGATION: Record<SiteId, NavItem[]> = {
  lbi: [
    { label: "Home", href: "/" },
    { label: "Diensten", href: "/diensten/" },
    { label: "Projecten", href: "/projecten/" },
    { label: "Over LBI", href: "/over-lbi/" },
    { label: "Werkwijze", href: "/#werkwijze" },
    { label: "Reviews", href: "/reviews/" },
    { label: "Contact", href: "/contact/" },
  ],
  elektra: [
    { label: "Home", href: "/" },
    { label: "Storingen", href: "/kortsluiting-groep-valt-uit/" },
    { label: "Meterkast", href: "/meterkast-groepen/" },
    { label: "Werkwijze & FAQ", href: "/werkwijze-faq/" },
    { label: "Contact", href: "/contact/" },
  ],
  lekkage: [
    { label: "Home", href: "/" },
    { label: "Lekkage", href: "/lekkage-badkamer-keuken/" },
    { label: "Water & afvoer", href: "/waterleiding-afvoer-riolering/" },
    { label: "Werkwijze & FAQ", href: "/werkwijze-faq/" },
    { label: "Contact", href: "/contact/" },
  ],
  gas: [
    { label: "Home", href: "/" },
    { label: "Gasleiding", href: "/gasleiding-aansluiten-verleggen/" },
    { label: "Controle & herstel", href: "/controle-herstel/" },
    { label: "Veiligheid", href: "/veiligheid-bij-gaslucht/" },
    { label: "Contact", href: "/contact/" },
  ],
};

export function getNavigation(siteId: SiteId): NavItem[] {
  return NAVIGATION[siteId];
}
