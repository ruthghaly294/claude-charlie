import { describe, it, expect, vi } from "vitest";
import { extractReadableText, fetchPageText, scrapeSources } from "./contentExtract";

const ALLOW_ROBOTS = "User-agent: *\nAllow: /";

function htmlRes(body: string, init: { ok?: boolean; contentType?: string } = {}) {
  return {
    ok: init.ok ?? true,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? init.contentType ?? "text/html" : null) },
    text: async () => body,
  } as unknown as Response;
}

/** fetchImpl that serves robots.txt (allow-all) and a page body. */
function server(pageBody: string, opts: { robots?: string; ok?: boolean; contentType?: string } = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return htmlRes(opts.robots ?? ALLOW_ROBOTS, { contentType: "text/plain" });
    return htmlRes(pageBody, { ok: opts.ok, contentType: opts.contentType });
  });
}

describe("extractReadableText", () => {
  it("strips scripts/styles/tags and collapses whitespace", () => {
    const html = `<html><head><title>x</title></head><body><script>evil()</script><style>.a{}</style><p>Hello   <b>world</b></p></body></html>`;
    expect(extractReadableText(html)).toBe("Hello world");
  });

  it("prefers the <article> body when present", () => {
    const filler = "x".repeat(300);
    const html = `<body><nav>menu menu</nav><article><p>Real content ${filler}</p></article></body>`;
    const out = extractReadableText(html);
    expect(out).toContain("Real content");
    expect(out).not.toContain("menu");
  });

  it("decodes common entities and caps length", () => {
    expect(extractReadableText("<p>a &amp; b</p>")).toBe("a & b");
    expect(extractReadableText("<p>" + "y".repeat(5000) + "</p>", 100)).toHaveLength(100);
  });
});

describe("fetchPageText", () => {
  it("returns extracted text for an allowed page", async () => {
    const body = `<article><p>${"Grounded fact ".repeat(40)}</p></article>`;
    const out = await fetchPageText("https://site.com/post", { fetchImpl: server(body) as unknown as typeof fetch });
    expect(out).toContain("Grounded fact");
  });

  it("returns null when robots.txt disallows the path", async () => {
    const fetchImpl = server("<article>blocked</article>", { robots: "User-agent: *\nDisallow: /" });
    expect(await fetchPageText("https://site.com/post", { fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
  });

  it("returns null on non-ok, non-html, or too-short content", async () => {
    expect(await fetchPageText("https://s/a", { fetchImpl: server("<p>x</p>", { ok: false }) as unknown as typeof fetch })).toBeNull();
    expect(await fetchPageText("https://s/b", { fetchImpl: server("{}", { contentType: "application/json" }) as unknown as typeof fetch })).toBeNull();
    expect(await fetchPageText("https://s/c", { fetchImpl: server("<p>tiny</p>") as unknown as typeof fetch })).toBeNull();
  });

  it("swallows fetch errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network");
    });
    expect(await fetchPageText("https://s/d", { fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
  });
});

describe("scrapeSources", () => {
  it("returns text for reachable picks, drops failures, and honors the limit", async () => {
    const good = `<article><p>${"useful body ".repeat(40)}</p></article>`;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return htmlRes(ALLOW_ROBOTS, { contentType: "text/plain" });
      if (url.includes("bad")) return htmlRes("nope", { ok: false });
      return htmlRes(good);
    });
    const out = await scrapeSources(
      [
        { url: "https://a.com/ok", title: "A" },
        { url: "https://b.com/bad" },
        { url: "https://c.com/ok" },
        { url: "https://d.com/ok" },
      ],
      { limit: 3, fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    // limited to first 3; the "bad" one drops ⇒ 2 survive
    expect(out.map((s) => s.url)).toEqual(["https://a.com/ok", "https://c.com/ok"]);
    expect(out[0]!.title).toBe("A");
  });
});
