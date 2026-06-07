import { describe, it, expect, vi } from "vitest";
import type { ConnectorContext } from "../types";
import { parseFeed, rssConnector } from "./rss";
import { githubConnector } from "./github";
import { redditConnector } from "./reddit";
import { hackernewsConnector } from "./hackernews";
import { youtubeConnector } from "./youtube";
import { googleCseConnector } from "./googleCse";
import { twitterConnector, buildTwitterQueries } from "./twitter";
import { productHuntConnector } from "./productHunt";
import { CONNECTORS, getConnector } from "./index";

function jsonFetch(body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}
function textFetch(text: string) {
  return vi.fn().mockResolvedValue(new Response(text, { status: 200 }));
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
  it("exposes 8 connectors with unique keys", () => {
    expect(CONNECTORS).toHaveLength(8);
    const keys = CONNECTORS.map((c) => c.key);
    expect(new Set(keys).size).toBe(8);
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
