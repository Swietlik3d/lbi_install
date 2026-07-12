# Afbeeldingen

Plaats afbeeldingen per site in de juiste map. Het pad in de browser is
`/images/<site>/<bestandsnaam>` (de map `public/` valt weg in de URL).

```
public/images/
├── placeholder.svg     # tijdelijke placeholder (mag blijven)
├── lbi/
├── elektra/
├── lekkage/
└── gas/
```

## Richtlijnen

- **Formaat:** liefst `.webp` of `.jpg` (foto's), `.svg` (iconen/logo's).
- **Hero / project (liggend):** ~1600×1200 px, bijsnijden op 4:3.
- **Bestandsgrootte:** richt op < 250 KB per foto. Comprimeer met bijv. Squoosh.
- **Alt-tekst is verplicht.** Beschrijf wat er te zien is (bijv. "Nieuwe keuken met
  ingebouwde apparatuur in Helmond"), niet "afbeelding" of een keyword-lijst.
- **Geen stockfoto's met valse claims.** Gebruik bij voorkeur eigen werk.
- **OG-afbeelding:** voeg per site een `og-default.jpg` (1200×630 px) toe, bijv.
  `public/images/lbi/og-default.jpg`. Het pad staat in `src/config/sites.json`.

## Waar verwijzen de starterpagina's naar?

De starterpagina's gebruiken `/images/placeholder.svg` als hero zolang er nog geen
echte foto is. Vervang dit per pagina via het veld **Hero → Afbeelding** in de CMS,
of pas het `image:`-veld in de markdown aan. Elke pagina bevat ook een **Beeldplan**
(`image_plan`) met de gewenste bestandsnaam en alt-tekst.
