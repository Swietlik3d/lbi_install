import type { SiteId } from "./sites";

export type NavItem = {
  label: string;
  href: string;
};

export const navigation: Record<SiteId, NavItem[]> = {
  lbi: [
    { label: "Home", href: "/" },
    { label: "Diensten", href: "/diensten/" },
    { label: "Projecten", href: "/projecten/" },
    { label: "Reviews", href: "/reviews/" },
    { label: "Werkgebied", href: "/werkgebied/" },
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

export function getNavigation(siteId: SiteId) {
  return navigation[siteId];
}
