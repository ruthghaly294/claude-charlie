import { describe, it, expect } from "vitest";
import { DEFAULT_SOURCES, loadSources, matchesSource, type PropertySource } from "./sources";

describe("DEFAULT_SOURCES", () => {
  it("includes the four enabled agent sites plus disabled portal entries", () => {
    expect(DEFAULT_SOURCES.filter((s) => s.enabled).map((s) => s.key)).toEqual([
      "templeton-robinson",
      "simon-brien",
      "john-minnis",
      "ulster-property-sales",
    ]);
    expect(DEFAULT_SOURCES.filter((s) => !s.enabled).map((s) => s.key)).toEqual([
      "propertypal",
      "propertynews",
    ]);
  });
});

describe("loadSources", () => {
  it("returns only the enabled defaults when no override is given", () => {
    expect(loadSources().map((s) => s.key)).toEqual([
      "templeton-robinson",
      "simon-brien",
      "john-minnis",
      "ulster-property-sales",
    ]);
  });

  it("falls back to defaults for an empty override list", () => {
    expect(loadSources([]).map((s) => s.key)).toEqual(
      loadSources().map((s) => s.key),
    );
  });

  it("filters out disabled sources", () => {
    const enabledCount = DEFAULT_SOURCES.filter((s) => s.enabled).length;
    const overrides: PropertySource[] = DEFAULT_SOURCES.map((s) =>
      s.key === "simon-brien" ? { ...s, enabled: false } : s,
    );
    const loaded = loadSources(overrides);
    expect(loaded.map((s) => s.key)).not.toContain("simon-brien");
    expect(loaded).toHaveLength(enabledCount - 1);
  });
});

describe("matchesSource", () => {
  const source: PropertySource = {
    key: "templeton-robinson",
    name: "Templeton Robinson",
    sitemapUrl: "https://www.templetonrobinson.com/site_map_xml.asp",
    include: ["/property/[^/]+/[^/]+/[^/]+/?$"],
    enabled: true,
  };

  it("matches a listing URL against the include pattern", () => {
    expect(
      matchesSource(source, "https://www.templetonrobinson.com/property/malone/id1/11-fairway-gardens/"),
    ).toBe(true);
  });

  it("rejects a URL matching none of the include patterns", () => {
    expect(
      matchesSource(source, "https://www.templetonrobinson.com/article/market-update"),
    ).toBe(false);
  });

  it("rejects a URL matched by an exclude pattern even if an include pattern matches", () => {
    const withExclude: PropertySource = { ...source, exclude: ["/property/new-developments/"] };
    expect(
      matchesSource(withExclude, "https://www.templetonrobinson.com/property/new-developments/id1/site/"),
    ).toBe(false);
  });
});
