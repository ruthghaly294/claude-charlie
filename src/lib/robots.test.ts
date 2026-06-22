import { describe, it, expect, vi } from "vitest";
import { parseRobots, isAllowedByRules, isAllowed } from "./robots";

describe("parseRobots + isAllowedByRules", () => {
  it("disallows paths under a blanket Disallow for *", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /admin/", "decode-bot/1.0");
    expect(isAllowedByRules(rules, "/admin/page")).toBe(false);
    expect(isAllowedByRules(rules, "/property/123")).toBe(true);
  });

  it("prefers a group matching our user-agent over the wildcard group", () => {
    const body = [
      "User-agent: *",
      "Disallow: /",
      "User-agent: decode-bot",
      "Disallow: /private/",
    ].join("\n");
    const rules = parseRobots(body, "decode-bot/1.0");
    expect(isAllowedByRules(rules, "/property/123")).toBe(true);
    expect(isAllowedByRules(rules, "/private/secret")).toBe(false);
  });

  it("treats an empty Disallow value as allow-all", () => {
    const rules = parseRobots("User-agent: *\nDisallow:", "decode-bot/1.0");
    expect(isAllowedByRules(rules, "/anything")).toBe(true);
  });

  it("supports * wildcards and a trailing $ end-anchor", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /*.pdf$", "decode-bot/1.0");
    expect(isAllowedByRules(rules, "/brochure.pdf")).toBe(false);
    expect(isAllowedByRules(rules, "/brochure.pdf?x=1")).toBe(true);
    expect(isAllowedByRules(rules, "/page.html")).toBe(true);
  });

  it("longest match wins, with an Allow carving out a Disallow", () => {
    const body = [
      "User-agent: *",
      "Disallow: /property/",
      "Allow: /property/public/",
    ].join("\n");
    const rules = parseRobots(body, "decode-bot/1.0");
    expect(isAllowedByRules(rules, "/property/public/123")).toBe(true);
    expect(isAllowedByRules(rules, "/property/private/123")).toBe(false);
  });
});

describe("isAllowed", () => {
  it("fetches and caches robots.txt per origin", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response("User-agent: *\nDisallow: /admin/", { status: 200 })),
    ) as unknown as typeof fetch;
    const cache = new Map<string, string | null>();

    const a = await isAllowed("https://agent.example/property/1", "decode-bot/1.0", {
      fetchImpl,
      cache,
    });
    const b = await isAllowed("https://agent.example/admin/x", "decode-bot/1.0", {
      fetchImpl,
      cache,
    });

    expect(a).toBe(true);
    expect(b).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails open (allows) when robots.txt cannot be fetched", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response("nope", { status: 500 })));
    const out = await isAllowed("https://agent.example/property/1", "decode-bot/1.0", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache: new Map(),
    });
    expect(out).toBe(true);
  });

  it("fails open when the fetch throws", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error("network down")));
    const out = await isAllowed("https://agent.example/property/1", "decode-bot/1.0", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache: new Map(),
    });
    expect(out).toBe(true);
  });
});
