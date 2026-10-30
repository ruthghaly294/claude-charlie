import Fastify from "fastify";
import { expect, it } from "vitest";
import { listingSchema } from "../src/contract.js";
import { WatchStore, runWatchCycle } from "../src/watcher.js";
import { createWatchSearch } from "../src/watch-search.js";
const now = Date.parse("2026-10-30T12:00:00Z");
const row = (id: string, title = "Chair") =>
  listingSchema.parse({
    position: 1,
    item_id: id,
    title,
    url: `https://www.ebay.co.uk/itm/${id}`,
    listed_at: new Date(now - 60000).toISOString(),
  });
it("delivers verified results from a partial scan without advancing its success boundary", async () => {
  const app = Fastify();
  app.get("/v1/ebay/search", async (req, reply) => {
    const page = Number((req.query as { page: string }).page);
    if (page === 2)
      return reply.code(503).send({ code: "UPSTREAM_ACCESS_DENIED" });
    return {
      query: "chairs",
      domain: "co.uk",
      category_id: null,
      sold: false,
      results: [row("1")],
      facets: {},
      pagination: {
        current_page: 1,
        per_page: 60,
        returned: 1,
        total_results: null,
        total_pages: null,
        has_more: true,
      },
      scraped_utc: 0,
      scraped_at: new Date(now).toISOString(),
    };
  });
  const s = new WatchStore(":memory:");
  s.setSetting("newListingMaxAgeMinutes", "10");
  try {
    const j = s.create({ name: "chairs", query: "chairs", mode: "active" });
    s.record(j.id, [], now - 120000);
    const sent: string[] = [];
    const search = createWatchSearch(app, undefined, () => false, {
      fetchHtml: async () => "",
      seen: () => false,
      paginateActive: true,
      resolveTimes: async (_j, rows) => [...rows],
    });
    await runWatchCycle(
      s,
      search,
      async (text) => {
        sent.push(text);
      },
      () => now,
    );
    expect(sent).toHaveLength(1);
    expect(s.get(j.id)?.lastSuccess).toBe(now - 120000);
    expect(s.get(j.id)?.lastError).toBe("UPSTREAM_PARTIAL_SCAN");
  } finally {
    s.close();
    await app.close();
  }
});
it("sends fresh active matches before other searches and sold research", async () => {
  const s = new WatchStore(":memory:");
  s.setSetting("newListingMaxAgeMinutes", "10");
  const events: string[] = [];
  try {
    for (const name of ["Sold", "Active A", "Active B"]) {
      const j = s.create({
        name,
        query: "chairs",
        mode: name === "Sold" ? "sold" : "active",
      });
      s.record(j.id, [], now - 120000);
    }
    await runWatchCycle(
      s,
      async (j) => {
        events.push("scan:" + j.name);
        return j.mode === "sold"
          ? []
          : [row(j.name === "Active A" ? "1" : "2", j.name)];
      },
      async (text) => {
        events.push(
          "send:" + (text.includes("Active A") ? "Active A" : "Active B"),
        );
      },
      () => now,
    );
    expect(events).toEqual([
      "scan:Active A",
      "send:Active A",
      "scan:Active B",
      "send:Active B",
      "scan:Sold",
    ]);
  } finally {
    s.close();
  }
});

it("runs research independently without consuming or duplicating live alert delivery", async () => {
  const s = new WatchStore(":memory:");
  s.setSetting("newListingMaxAgeMinutes", "10");
  try {
    const live = s.create({ name: "live", query: "chair", mode: "active" });
    s.record(live.id, [], now - 120000);
    s.record(live.id, [row("1")], now);
    const research = s.create({
      name: "research",
      query: "chair",
      mode: "active",
      once: true,
      notifyNew: false,
    });
    const searched: string[] = [],
      sent: string[] = [];
    await runWatchCycle(
      s,
      async (j) => {
        searched.push(j.id);
        return [];
      },
      async (text) => {
        sent.push(text);
      },
      () => now,
      () => false,
      { include: (j) => Boolean(j.once), deliver: false },
    );
    expect(searched).toEqual([research.id]);
    expect(sent).toEqual([]);
    expect(s.pending(now)).toHaveLength(1);
    await runWatchCycle(
      s,
      async () => [],
      async (text) => {
        sent.push(text);
      },
      () => now,
      () => false,
      { include: (j) => !j.once },
    );
    expect(sent).toHaveLength(1);
  } finally {
    s.close();
  }
});
