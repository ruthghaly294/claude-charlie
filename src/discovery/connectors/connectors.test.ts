import { describe, it, expect, vi } from "vitest";
import type { ConnectorContext } from "../types";
import { parseFeed, rssConnector } from "./rss";
import { githubConnector, parseNextLink } from "./github";
import { redditConnector } from "./reddit";
import { hackernewsConnector } from "./hackernews";
import { youtubeConnector } from "./youtube";
import { googleCseConnector } from "./googleCse";
import { twitterConnector, buildTwitterQueries } from "./twitter";
import { productHuntConnector } from "./productHunt";
import { tiktokSoundsConnector } from "./tiktokSounds";
import { CONNECTORS, getConnector } from "./index";

// Each call gets a fresh Response — a single Response's body can only be read once,
// and several tests now drive fetchImpl multiple times (one per query/subreddit).
function jsonFetch(body: unknown) {
  return vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}
function textFetch(text: string) {
  return vi.fn().mockImplementation(async () => new Response(text, { status: 200 }));
}

function ctx(p: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    keywords: [],
    businessName: "Acme",
    config: undefined,
    env: {},
    fetchImpl: vi.fn(),
    ...p,
  };
}

const RSS2 = `<?xml version="1.0"?><rss version="2.0"><channel><title>F</title>
<item><title>Radiology AI</title><link>https://x/a</link><pubDate>Mon, 02 Jun 2026 10:00:00 GMT</pubDate><author>jane</author><description>chest x-rays</description></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>FRCR changes</title><link href="https://x/b"/><updated>2026-06-03</updated><author><name>bob</name></author><summary>viva</summary></entry>
</feed>`;

describe("registry", () => {
  it("exposes 10 connectors with unique keys", () => {
    expect(CONNECTORS).toHaveLength(10);
    const keys = CONNECTORS.map((c) => c.key);
    expect(new Set(keys).size).toBe(10);
  });
  it("includes the last30days and tiktok_sounds connectors", () => {
    const keys = CONNECTORS.map((c) => c.key);
    expect(keys).toContain("last30days");
    expect(keys).toContain("tiktok_sounds");
  });
  it("looks up by key", () => {
    expect(getConnector("rss")?.label).toBe("RSS / Atom feeds");
    expect(getConnector("nope")).toBeUndefined();
  });
});

describe("rss", () => {
  it("parses RSS 2.0", () => {
    const out = parseFeed(RSS2);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: "rss",
      title: "Radiology AI",
      url: "https://x/a",
      author: "jane",
    });
  });
  it("parses Atom (link href + author name)", () => {
    const out = parseFeed(ATOM);
    expect(out[0]).toMatchObject({
      title: "FRCR changes",
      url: "https://x/b",
      author: "bob",
    });
  });
  it("returns [] on malformed xml", () => {
    expect(parseFeed("<<<not xml")).toEqual([]);
  });
  it("state false without feeds, true with", () => {
    expect(rssConnector.state(ctx({ config: [] })).configured).toBe(false);
    expect(
      rssConnector.state(ctx({ config: ["https://feed/x"] })).configured,
    ).toBe(true);
  });
  it("fetch pulls + parses each feed", async () => {
    const out = await rssConnector.fetch(
      ctx({ config: ["https://feed/x"], fetchImpl: textFetch(RSS2) }),
    );
    expect(out[0]?.title).toBe("Radiology AI");
  });
  it("fetch tolerates one failing feed (allSettled)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("err", { status: 500 }))
      .mockResolvedValue(new Response(RSS2, { status: 200 }));
    const out = await rssConnector.fetch(
      ctx({ config: ["https://a", "https://b"], fetchImpl }),
    );
    expect(out).toHaveLength(1);
  });
});

describe("github", () => {
  it("state needs topics", () => {
    expect(githubConnector.state(ctx({ config: {} })).configured).toBe(false);
    expect(
      githubConnector.state(ctx({ config: { topics: ["ai"] } })).configured,
    ).toBe(true);
  });
  it("maps search items", async () => {
    const out = await githubConnector.fetch(
      ctx({
        config: { topics: ["ai"], window: "weekly" },
        fetchImpl: jsonFetch({
          items: [
            {
              full_name: "a/b",
              html_url: "https://gh/a",
              description: "d",
              stargazers_count: 9,
              owner: { login: "a" },
            },
          ],
        }),
      }),
    );
    expect(out[0]).toMatchObject({
      source: "github",
      title: "a/b",
      author: "a",
    });
    expect(out[0]?.raw).toContain("★9");
  });

  it("follows the Link: rel=\"next\" header up to max_pages", async () => {
    const page = (name: string, next?: string) =>
      new Response(
        JSON.stringify({
          items: [{ full_name: name, html_url: `https://gh/${name}`, stargazers_count: 1 }],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            ...(next ? { link: `<${next}>; rel="next", <https://gh/last>; rel="last"` } : {}),
          },
        },
      );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(page("a/1", "https://gh/page2"))
      .mockResolvedValueOnce(page("a/2", "https://gh/page3"))
      .mockResolvedValueOnce(page("a/3")); // no next link -> stop

    const out = await githubConnector.fetch(
      ctx({ config: { topics: ["ai"], max_pages: 3 }, fetchImpl }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(out.map((s) => s.title)).toEqual(["a/1", "a/2", "a/3"]);
  });

  it("stops at max_pages even if more pages are available", async () => {
    const page = () =>
      new Response(
        JSON.stringify({ items: [{ full_name: "a/x", html_url: "https://gh/x", stargazers_count: 1 }] }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            link: `<https://gh/next>; rel="next"`,
          },
        },
      );
    const fetchImpl = vi.fn().mockImplementation(async () => page());
    const out = await githubConnector.fetch(
      ctx({ config: { topics: ["ai"], max_pages: 2 }, fetchImpl }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(2);
  });

  it("defaults max_pages to 3 when unset", async () => {
    const page = () =>
      new Response(
        JSON.stringify({ items: [{ full_name: "a/x", html_url: "https://gh/x", stargazers_count: 1 }] }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            link: `<https://gh/next>; rel="next"`,
          },
        },
      );
    const fetchImpl = vi.fn().mockImplementation(async () => page());
    const out = await githubConnector.fetch(ctx({ config: { topics: ["ai"] }, fetchImpl }));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(3);
  });

  it("fetches ctx.queries as additional topics beyond config", async () => {
    const page = (name: string) =>
      new Response(
        JSON.stringify({
          items: [{ full_name: name, html_url: `https://gh/${name}`, stargazers_count: 1 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(page("a/ai"))
      .mockResolvedValueOnce(page("a/scraping"));
    const out = await githubConnector.fetch(
      ctx({ config: { topics: ["ai"] }, queries: ["scraping"], fetchImpl }),
    );
    expect(out.map((s) => s.title)).toEqual(["a/ai", "a/scraping"]);
    const tags = out.flatMap((o) => o.tags);
    expect(tags).toContain("ai");
    expect(tags).toContain("scraping");
  });

  it("is configured from ctx.queries alone, with no topics in config", () => {
    expect(githubConnector.state(ctx({ config: {}, queries: ["llm-agents"] })).configured).toBe(
      true,
    );
  });
});

describe("parseNextLink", () => {
  it("extracts the rel=\"next\" url from a Link header", () => {
    const header = `<https://api.github.com/search?page=2>; rel="next", <https://api.github.com/search?page=5>; rel="last"`;
    expect(parseNextLink(header)).toBe("https://api.github.com/search?page=2");
  });

  it("returns undefined when there is no next link", () => {
    expect(parseNextLink(`<https://api.github.com/search?page=1>; rel="last"`)).toBeUndefined();
    expect(parseNextLink(null)).toBeUndefined();
  });
});

describe("reddit", () => {
  it("parses the .rss feed and tags the subreddit", async () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>FRCR study tips</title><link href="https://www.reddit.com/r/Radiology/comments/abc/frcr"/><updated>2026-06-01</updated><author><name>/u/jane</name></author><content>good stuff</content></entry>
</feed>`;
    const out = await redditConnector.fetch(
      ctx({
        config: { subreddits: ["Radiology"] },
        fetchImpl: textFetch(atom),
      }),
    );
    expect(out[0]).toMatchObject({
      source: "reddit",
      title: "FRCR study tips",
      url: "https://www.reddit.com/r/Radiology/comments/abc/frcr",
    });
    expect(out[0]?.tags).toContain("Radiology");
  });

  it("derives authorKey from the feed author, stripping the /u/ prefix", async () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>FRCR study tips</title><link href="https://www.reddit.com/r/Radiology/comments/abc/frcr"/><updated>2026-06-01</updated><author><name>/u/jane</name></author><content>good stuff</content></entry>
</feed>`;
    const out = await redditConnector.fetch(
      ctx({ config: { subreddits: ["Radiology"] }, fetchImpl: textFetch(atom) }),
    );
    expect(out[0]?.authorKey).toBe("reddit:jane");
  });

  it("fetches ctx.queries as additional subreddits beyond config", async () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>T</title><link href="https://x/1"/><updated>2026-06-01</updated><author><name>/u/jane</name></author><content>c</content></entry>
</feed>`;
    const fetchImpl = textFetch(atom);
    const out = await redditConnector.fetch(
      ctx({ config: { subreddits: ["Radiology"] }, queries: ["algotrading"], fetchImpl }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const tags = out.flatMap((o) => o.tags);
    expect(tags).toContain("Radiology");
    expect(tags).toContain("algotrading");
  });

  it("is configured from ctx.queries alone, with no subreddits in config", () => {
    expect(redditConnector.state(ctx({ config: {}, queries: ["algotrading"] })).configured).toBe(
      true,
    );
  });
});

describe("hackernews", () => {
  it("uses keywords when query empty", () => {
    expect(
      hackernewsConnector.state(
        ctx({ config: { query: "" }, keywords: ["frcr"] }),
      ).configured,
    ).toBe(true);
    expect(
      hackernewsConnector.state(
        ctx({ config: { query: "" }, keywords: [], businessName: "" }),
      ).configured,
    ).toBe(false);
  });
  it("falls back to item id url when url null", async () => {
    const out = await hackernewsConnector.fetch(
      ctx({
        keywords: ["x"],
        fetchImpl: jsonFetch({
          hits: [{ title: "T", url: null, author: "a", objectID: "42" }],
        }),
      }),
    );
    expect(out[0]?.url).toBe("https://news.ycombinator.com/item?id=42");
  });

  it("populates points/comments/authorKey from the Algolia response", async () => {
    const out = await hackernewsConnector.fetch(
      ctx({
        keywords: ["x"],
        fetchImpl: jsonFetch({
          hits: [
            { title: "T", url: "https://x/1", author: "a", objectID: "42", points: 100, num_comments: 5 },
          ],
        }),
      }),
    );
    expect(out[0]?.points).toBe(100);
    expect(out[0]?.comments).toBe(5);
    expect(out[0]?.authorKey).toBe("hackernews:a");
  });

  it("runs a search per ctx.queries entry, deduping hits by objectID", async () => {
    const fetchImpl = jsonFetch({
      hits: [{ title: "T", url: "https://x/1", author: "a", objectID: "42" }],
    });
    const out = await hackernewsConnector.fetch(
      ctx({ queries: ["scraping", "saas"], fetchImpl }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(1);
  });
});

describe("youtube (key-gated)", () => {
  it("not configured without key", () => {
    expect(youtubeConnector.state(ctx({ keywords: ["x"] })).configured).toBe(
      false,
    );
  });
  it("configured with key + query, parses videos and skips keyless items", async () => {
    const c = ctx({
      keywords: ["frcr"],
      env: { YOUTUBE_API_KEY: "k" },
      fetchImpl: jsonFetch({
        items: [
          {
            id: { videoId: "vid1" },
            snippet: {
              title: "V",
              channelTitle: "C",
              publishedAt: "2026",
              description: "d",
            },
          },
          { id: {}, snippet: { title: "no id" } },
        ],
      }),
    });
    expect(youtubeConnector.state(c).configured).toBe(true);
    const out = await youtubeConnector.fetch(c);
    expect(out).toHaveLength(1);
    expect(out[0]?.url).toBe("https://www.youtube.com/watch?v=vid1");
    expect(out[0]?.authorKey).toBe("youtube:C");
  });

  it("merges ctx.queries with the keyword-derived queries, deduped", async () => {
    const fetchImpl = jsonFetch({
      items: [{ id: { videoId: "vid1" }, snippet: { title: "V", channelTitle: "C" } }],
    });
    const c = ctx({
      keywords: ["frcr"],
      queries: ["frcr", "extra query"],
      env: { YOUTUBE_API_KEY: "k" },
      fetchImpl,
    });
    await youtubeConnector.fetch(c);
    // "frcr" (from keywords) + "extra query" — deduped, so exactly 2 calls
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("google_cse (key-gated)", () => {
  it("gating: disabled, then no-key, then ok", () => {
    expect(
      googleCseConnector.state(ctx({ config: { enabled: false } })).configured,
    ).toBe(false);
    expect(
      googleCseConnector.state(ctx({ config: { enabled: true } })).configured,
    ).toBe(false);
    const ok = ctx({
      config: { enabled: true },
      keywords: ["x"],
      env: { GOOGLE_CSE_KEY: "k", GOOGLE_CSE_ID: "i" },
    });
    expect(googleCseConnector.state(ok).configured).toBe(true);
  });
  it("maps items", async () => {
    const out = await googleCseConnector.fetch(
      ctx({
        config: { enabled: true },
        keywords: ["x"],
        env: { GOOGLE_CSE_KEY: "k", GOOGLE_CSE_ID: "i" },
        fetchImpl: jsonFetch({
          items: [
            {
              title: "G",
              link: "https://g/1",
              snippet: "s",
              displayLink: "g.com",
            },
          ],
        }),
      }),
    );
    expect(out[0]).toMatchObject({
      source: "google",
      title: "G",
      url: "https://g/1",
    });
    expect(out[0]?.authorKey).toBe("google:g.com");
  });

  it("runs an additional search per ctx.queries entry, deduped by url", async () => {
    const fetchImpl = jsonFetch({
      items: [{ title: "G", link: "https://g/1", snippet: "s", displayLink: "g.com" }],
    });
    const out = await googleCseConnector.fetch(
      ctx({
        config: { enabled: true },
        keywords: ["x"],
        queries: ["y"],
        env: { GOOGLE_CSE_KEY: "k", GOOGLE_CSE_ID: "i" },
        fetchImpl,
      }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(1);
  });
});

describe("twitter (key-gated)", () => {
  it("gating", () => {
    expect(
      twitterConnector.state(
        ctx({ config: { enabled: true }, keywords: ["x"] }),
      ).configured,
    ).toBe(false);
    expect(
      twitterConnector.state(
        ctx({
          config: { enabled: true },
          keywords: ["x"],
          env: { TWITTER_BEARER: "b" },
        }),
      ).configured,
    ).toBe(true);
  });
  it("maps tweets", async () => {
    const out = await twitterConnector.fetch(
      ctx({
        config: { enabled: true },
        keywords: ["x"],
        env: { TWITTER_BEARER: "b" },
        fetchImpl: jsonFetch({
          data: [
            {
              id: "9",
              text: "hello world",
              author_id: "u",
              created_at: "2026",
            },
          ],
        }),
      }),
    );
    expect(out[0]).toMatchObject({
      source: "twitter",
      url: "https://twitter.com/i/web/status/9",
    });
  });

  it("builds from: queries for followed accounts", () => {
    const qs = buildTwitterQueries(
      ctx({
        config: { enabled: true, accounts: ["@realDonaldTrump", "unusual_whales"] },
        keywords: [],
      }),
    );
    expect(qs).toContain("(from:realDonaldTrump OR from:unusual_whales) -is:retweet");
  });

  it("runs both an account query and a keyword query, deduping by id", async () => {
    const body = {
      data: [{ id: "9", text: "hello world", author_id: "u", created_at: "2026" }],
    };
    // fresh Response per call — a single Response's body can only be read once
    const fetchImpl = vi.fn((..._args: unknown[]) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const out = await twitterConnector.fetch(
      ctx({
        config: { enabled: true, accounts: ["nancy"] },
        keywords: ["pelosi"],
        env: { TWITTER_BEARER: "b" },
        fetchImpl,
      }),
    );
    // two queries (accounts + keywords) → two calls, same tweet id → one result
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const firstUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(decodeURIComponent(firstUrl)).toContain("from:nancy");
    expect(out).toHaveLength(1);
  });

  it("honors a raw query override", () => {
    const qs = buildTwitterQueries(
      ctx({ config: { enabled: true, query: "from:foo lang:en" }, keywords: ["x"] }),
    );
    expect(qs).toEqual(["from:foo lang:en"]);
  });

  it("healthCheck reports not-configured on a 401 (stale bearer token)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    const result = await twitterConnector.healthCheck!(
      ctx({ config: { enabled: true }, env: { TWITTER_BEARER: "bad" }, fetchImpl }),
    );
    expect(result).toEqual({
      configured: false,
      reason: "TWITTER_BEARER unauthorized (401)",
    });
  });

  it("healthCheck reports configured when the bearer token is valid", async () => {
    const fetchImpl = jsonFetch({ data: [] });
    const result = await twitterConnector.healthCheck!(
      ctx({ config: { enabled: true }, env: { TWITTER_BEARER: "good" }, fetchImpl }),
    );
    expect(result).toEqual({ configured: true });
  });

  it("healthCheck reports not-configured (without throwing) on a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await twitterConnector.healthCheck!(
      ctx({ config: { enabled: true }, env: { TWITTER_BEARER: "good" }, fetchImpl }),
    );
    expect(result.configured).toBe(false);
  });
});

describe("producthunt (key-gated)", () => {
  it("gating", () => {
    expect(
      productHuntConnector.state(ctx({ config: { enabled: true } })).configured,
    ).toBe(false);
    expect(
      productHuntConnector.state(
        ctx({ config: { enabled: true }, env: { PRODUCTHUNT_TOKEN: "t" } }),
      ).configured,
    ).toBe(true);
  });
  it("maps launches", async () => {
    const out = await productHuntConnector.fetch(
      ctx({
        config: { enabled: true },
        env: { PRODUCTHUNT_TOKEN: "t" },
        fetchImpl: jsonFetch({
          data: {
            posts: {
              edges: [
                {
                  node: {
                    name: "P",
                    tagline: "tg",
                    url: "https://ph/1",
                    votesCount: 5,
                  },
                },
              ],
            },
          },
        }),
      }),
    );
    expect(out[0]).toMatchObject({
      source: "producthunt",
      title: "P",
      url: "https://ph/1",
    });
    expect(out[0]?.raw).toContain("▲5");
  });
});

describe("tiktok_sounds (config-gated)", () => {
  it("not configured when disabled (the default)", () => {
    expect(tiktokSoundsConnector.state(ctx()).configured).toBe(false);
    expect(
      tiktokSoundsConnector.state(ctx({ config: { enabled: false } }))
        .configured,
    ).toBe(false);
  });

  it("parses trending sounds and uses real usage metrics as points", async () => {
    const c = ctx({
      config: { enabled: true },
      fetchImpl: jsonFetch({
        data: {
          sound_list: [
            {
              song_id: 123,
              title: "Boom",
              author: "DJ X",
              link: "https://tt/music/123",
              play_count: 5000,
            },
            { title: "No Id Sound", author: "ACT" },
          ],
        },
      }),
    });
    expect(tiktokSoundsConnector.state(c).configured).toBe(true);
    const out = await tiktokSoundsConnector.fetch(c);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      source: "tiktok_sounds",
      title: "Boom — DJ X",
      url: "https://tt/music/123",
      points: 5000,
      authorKey: "tiktok:dj x",
    });
    expect(out[0]?.tags).toContain("sound");
    expect(out[1]?.url).toBe("");
  });

  it("falls back to trending order for points when no usage metrics", async () => {
    const c = ctx({
      config: { enabled: true, limit: 20 },
      fetchImpl: jsonFetch({
        data: {
          sound_list: [
            { song_id: "a", title: "First" },
            { song_id: "b", title: "Second" },
          ],
        },
      }),
    });
    const out = await tiktokSoundsConnector.fetch(c);
    expect(out[0]?.points).toBe(20);
    expect(out[1]?.points).toBe(19);
  });

  it("sends the bearer token header when TIKTOK_CC_TOKEN is set", async () => {
    const fetchImpl = jsonFetch({ data: { sound_list: [] } });
    const c = ctx({
      config: { enabled: true },
      env: { TIKTOK_CC_TOKEN: "secret" },
      fetchImpl,
    });
    await tiktokSoundsConnector.fetch(c);
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(
      (init?.headers as Record<string, string>).authorization,
    ).toBe("Bearer secret");
  });
});
