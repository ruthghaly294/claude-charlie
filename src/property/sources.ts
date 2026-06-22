export type PropertySource = {
  key: string;
  name: string;
  sitemapUrl: string;
  /** a sitemap URL is a candidate listing iff it matches at least one of these */
  include: string[];
  /** ...and matches none of these */
  exclude?: string[];
  /** extraction strategy to use for this source (Phase 2: "default" only) */
  schema?: string;
  enabled: boolean;
};

/**
 * Registry of NI estate agents whose own sites are robots-permitted and not
 * behind an anti-bot wall. Verified June 2026: both allow `User-agent: *`.
 * (Add sources here, or override via config; the framework handles the rest.)
 */
export const DEFAULT_SOURCES: PropertySource[] = [
  {
    key: "templeton-robinson",
    name: "Templeton Robinson",
    sitemapUrl: "https://www.templetonrobinson.com/site_map_xml.asp",
    include: ["/property/[^/]+/[^/]+/[^/]+/?$"],
    enabled: true,
  },
  {
    key: "simon-brien",
    name: "Simon Brien",
    sitemapUrl: "https://www.simonbrien.com/sbr/sitemap.xml",
    include: ["/buy/[^/]+/[^/]+/[^/]+"],
    enabled: true,
  },
  {
    key: "john-minnis",
    name: "John Minnis",
    sitemapUrl: "https://www.johnminnis.co.uk/site_map_xml.asp",
    include: ["/property/[^/]+/[^/]+/[^/]+/?$"],
    enabled: true,
  },
  {
    key: "ulster-property-sales",
    name: "Ulster Property Sales",
    sitemapUrl: "https://www.ulsterpropertysales.co.uk/site_map_xml.asp",
    include: ["/property/[^/]+/[^/]+/[^/]+/?$"],
    enabled: true,
  },
  // The big NI portals — disabled until their robots.txt + ToS are checked
  // (likely anti-bot protected, unlike the direct agent sites above).
  {
    key: "propertypal",
    name: "PropertyPal",
    sitemapUrl: "https://www.propertypal.com/sitemap.xml",
    include: ["/[^/]+/[^/]+/[0-9]+/?$"],
    enabled: false,
  },
  {
    key: "propertynews",
    name: "PropertyNews",
    sitemapUrl: "https://www.propertynews.com/sitemap.xml",
    include: ["/property-for-sale/.+"],
    enabled: false,
  },
];

/** Load the source registry: a non-empty config override replaces the defaults; either way, disabled sources are dropped. */
export function loadSources(configSources?: PropertySource[]): PropertySource[] {
  const list = configSources && configSources.length > 0 ? configSources : DEFAULT_SOURCES;
  return list.filter((s) => s.enabled);
}

/** True if `url` should be treated as a listing for `source`: matches an include pattern and no exclude pattern. */
export function matchesSource(source: PropertySource, url: string): boolean {
  const included = source.include.some((p) => new RegExp(p, "i").test(url));
  if (!included) return false;
  return !(source.exclude ?? []).some((p) => new RegExp(p, "i").test(url));
}
