import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { entities } from "@/db/schema";
import {
  refreshEntities,
  getEntityRefreshClient,
  type EntityRefreshClient,
} from "./entityRefresh";

function fakeClient(parsedEntities: unknown[]) {
  const parse = vi.fn(async (..._args: unknown[]) => ({
    parsed_output: { entities: parsedEntities },
  }));
  const client: EntityRefreshClient = { messages: { parse } };
  return { client, parse };
}

const PROPOSAL = {
  keyword: "web scraping",
  kind: "subreddit" as const,
  value: "scrapy",
  weight: 1,
};

describe("refreshEntities", () => {
  it("is a no-op without a client", async () => {
    const db = createDb(":memory:");
    const out = await refreshEntities(db, { keywords: ["web scraping"] });
    expect(out.proposed).toBe(0);
    expect(db.select().from(entities).all()).toEqual([]);
  });

  it("inserts Claude's proposals as proposed/claude entities", async () => {
    const db = createDb(":memory:");
    const { client, parse } = fakeClient([PROPOSAL]);

    const out = await refreshEntities(db, { keywords: ["web scraping"] }, { client });

    expect(out.proposed).toBe(1);
    expect(parse).toHaveBeenCalledTimes(1);
    const rows = db.select().from(entities).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("proposed");
    expect(rows[0]!.source).toBe("claude");
    expect(rows[0]!.kind).toBe("subreddit");
    expect(rows[0]!.value).toBe("scrapy");
  });

  it("skips proposals that duplicate an existing entity (kind+value)", async () => {
    const db = createDb(":memory:");
    db.insert(entities)
      .values({
        id: "e1",
        keyword: "web scraping",
        kind: "subreddit",
        value: "scrapy",
        weight: 1,
        status: "active",
        source: "seed",
        createdAt: new Date().toISOString(),
      })
      .run();
    const { client } = fakeClient([PROPOSAL, { ...PROPOSAL, value: "webscraping" }]);

    const out = await refreshEntities(db, { keywords: ["web scraping"] }, { client });

    expect(out.proposed).toBe(1);
    const proposed = db.select().from(entities).where(eq(entities.status, "proposed")).all();
    expect(proposed).toHaveLength(1);
    expect(proposed[0]!.value).toBe("webscraping");
  });

  it("caps proposals at maxProposals", async () => {
    const db = createDb(":memory:");
    const many = Array.from({ length: 5 }, (_, i) => ({ ...PROPOSAL, value: `sub${i}` }));
    const { client } = fakeClient(many);

    const out = await refreshEntities(
      db,
      { keywords: ["web scraping"] },
      { client, maxProposals: 2 },
    );

    expect(out.proposed).toBe(2);
    expect(db.select().from(entities).all()).toHaveLength(2);
  });
});

describe("getEntityRefreshClient", () => {
  it("returns null without an API key", () => {
    expect(getEntityRefreshClient({})).toBeNull();
  });

  it("returns null when DECODE_REASONER=deterministic even with a key", () => {
    expect(
      getEntityRefreshClient({ ANTHROPIC_API_KEY: "k", DECODE_REASONER: "deterministic" }),
    ).toBeNull();
  });

  it("returns a client when an API key is present", () => {
    expect(getEntityRefreshClient({ ANTHROPIC_API_KEY: "k" })).not.toBeNull();
  });
});
