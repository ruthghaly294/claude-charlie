import { describe, it, expect, vi } from "vitest";
import {
  youtubeThumbnail,
  extractOgImage,
  fetchThumbnail,
  enrichThumbnails,
} from "./thumbnails";
import type { RankedReport, RankedItem } from "./rank";

function ranked(overrides: Partial<RankedItem>): RankedItem {
  return {
    title: "Untitled",
    url: "https://example.com/x",
    snippet: "",
    engagement: {},
    source: "web",
    score: 1,
    cluster: "c0",
    ...overrides,
  };
}

function report(picks: RankedItem[]): RankedReport {
  return {
    topic: "ai agents",
    rangeFrom: "2026-05-15",
    rangeTo: "2026-06-14",
    itemsBySource: { web: picks },
    errorsBySource: {},
    warnings: [],
    topPicks: picks,
  };
}

describe("youtubeThumbnail", () => {
  it("derives the thumbnail URL from a watch?v= link", () => {
    expect(youtubeThumbnail("https://www.youtube.com/watch?v=abc123")).toBe(
      "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    );
  });

  it("derives it from a youtu.be short link", () => {
    expect(youtubeThumbnail("https://youtu.be/xyz789")).toBe(
      "https://i.ytimg.com/vi/xyz789/hqdefault.jpg",
    );
  });

  it("returns null for non-YouTube hosts and malformed URLs", () => {
    expect(youtubeThumbnail("https://example.com/watch?v=abc")).toBeNull();
    expect(youtubeThumbnail("not a url")).toBeNull();
    expect(youtubeThumbnail("https://www.youtube.com/results?q=foo")).toBeNull();
  });
});

describe("extractOgImage", () => {
  it("pulls og:image with content after property", () => {
    const html = `<meta property="og:image" content="https://img/og.jpg">`;
    expect(extractOgImage(html)).toBe("https://img/og.jpg");
  });

  it("pulls og:image with content before property", () => {
    const html = `<meta content="https://img/og.jpg" property="og:image">`;
    expect(extractOgImage(html)).toBe("https://img/og.jpg");
  });

  it("falls back to twitter:image", () => {
    const html = `<meta name="twitter:image" content="https://img/tw.jpg">`;
    expect(extractOgImage(html)).toBe("https://img/tw.jpg");
  });

  it("returns null when no image meta is present", () => {
    expect(extractOgImage("<html><head></head></html>")).toBeNull();
  });
});

describe("fetchThumbnail", () => {
  it("short-circuits to the YouTube URL without fetching", async () => {
    const fetchImpl = vi.fn();
    const out = await fetchThumbnail("https://youtu.be/abc", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toBe("https://i.ytimg.com/vi/abc/hqdefault.jpg");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches the page and extracts og:image for non-YouTube URLs", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => `<meta property="og:image" content="https://img/og.jpg">`,
    }));
    const out = await fetchThumbnail("https://example.com/post", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toBe("https://img/og.jpg");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("returns null on non-ok responses", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, text: async () => "" }));
    const out = await fetchThumbnail("https://example.com/post", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toBeNull();
  });

  it("swallows fetch errors and returns null", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const out = await fetchThumbnail("https://example.com/post", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(out).toBeNull();
  });
});

describe("enrichThumbnails", () => {
  it("populates imageUrl on top picks and mirrors it into itemsBySource", async () => {
    const picks = [
      ranked({ url: "https://youtu.be/aaa", cluster: "c1" }),
      ranked({ url: "https://example.com/post", cluster: "c2" }),
    ];
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => `<meta property="og:image" content="https://img/og.jpg">`,
    }));

    const out = await enrichThumbnails(report(picks), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(out.topPicks[0]!.imageUrl).toBe("https://i.ytimg.com/vi/aaa/hqdefault.jpg");
    expect(out.topPicks[1]!.imageUrl).toBe("https://img/og.jpg");
    expect(out.itemsBySource.web![0]!.imageUrl).toBe(
      "https://i.ytimg.com/vi/aaa/hqdefault.jpg",
    );
    // YouTube pick never hits the network.
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps an existing imageUrl rather than refetching", async () => {
    const picks = [ranked({ url: "https://example.com/post", imageUrl: "https://kept.jpg" })];
    const fetchImpl = vi.fn();

    const out = await enrichThumbnails(report(picks), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(out.topPicks[0]!.imageUrl).toBe("https://kept.jpg");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("only fetches up to `limit` picks", async () => {
    const picks = [
      ranked({ url: "https://example.com/1" }),
      ranked({ url: "https://example.com/2" }),
      ranked({ url: "https://example.com/3" }),
    ];
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => "" }));

    await enrichThumbnails(report(picks), {
      limit: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("leaves picks untouched when no thumbnail is found", async () => {
    const picks = [ranked({ url: "https://example.com/post" })];
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => "<html></html>" }));

    const out = await enrichThumbnails(report(picks), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(out.topPicks[0]!.imageUrl).toBeUndefined();
  });
});
