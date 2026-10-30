import { describe, expect, it, vi } from "vitest";
import { createWatchlistRepository } from "../src/supabase-watchlist.js";

const id = "d76774de-6fea-4d07-8adf-227d57e03da6";
const row = {
  id,
  telegram_chat_id: "123",
  name: "Radiology book",
  query: "OBrien second edition",
  domain: "co.uk",
  condition: "used",
  buying_format: null,
  min_price: null,
  max_price: 40,
  free_shipping: true,
  location: "domestic",
  language: null,
  interval_minutes: 2,
  monitor_active: false,
  monitor_sold: false,
  market_profile: null,
  research_requested_at: "2026-10-27T18:00:00Z",
  revision: 1,
  created_at: "2026-10-27T18:00:00Z",
  updated_at: "2026-10-27T18:00:00Z",
  deleted_at: null,
};
const repository = (fetcher: typeof fetch) =>
  createWatchlistRepository(
    "https://example.supabase.co",
    "sb_secret_test_server_only",
    fetcher,
  );

describe("Supabase watch list boundary", () => {
  it("scopes reads to the paired chat and excludes deleted watches", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify([row])));
    const entries = await repository(fetcher).list("123");
    expect(entries[0]?.query).toBe("OBrien second edition");
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.searchParams.get("telegram_chat_id")).toBe("eq.123");
    expect(url.searchParams.get("deleted_at")).toBe("is.null");
    expect(url.pathname).toBe("/rest/v1/ebay_watchlist");
  });
  it("creates research-only entries using a stable caller-supplied id", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(row)));
    await repository(fetcher).create(id, "123", {
      name: row.name,
      query: row.query,
    });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      id,
      telegram_chat_id: "123",
      monitor_active: false,
      monitor_sold: false,
    });
    expect(body).not.toHaveProperty("revision");
  });
  it("uses owner and revision checks for edits instead of overwriting concurrent changes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]"));
    await expect(
      repository(fetcher).update(id, "123", 1, { max_price: 25 }),
    ).rejects.toThrow("changed or was removed");
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.searchParams.get("revision")).toBe("eq.1");
    expect(url.searchParams.get("telegram_chat_id")).toBe("eq.123");
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("PATCH");
  });
  it("soft deletes and disables both search modes so the scheduler can observe removals", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify([
            { ...row, deleted_at: "2026-10-27T18:01:00Z", revision: 2 },
          ]),
        ),
      );
    await repository(fetcher).remove(id, "123", 1);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ monitor_active: false, monitor_sold: false });
    expect(body.deleted_at).toEqual(expect.any(String));
  });
  it("rejects unexpected database rows and sanitizes upstream failures", async () => {
    const invalid = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify([{ ...row, query: null }])),
      );
    await expect(repository(invalid).list("123")).rejects.toThrow(
      "Supabase watch list unavailable",
    );
    const denied = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "sb_secret_do_not_leak" }), {
        status: 401,
      }),
    );
    await expect(repository(denied).list("123")).rejects.toThrow(
      "Supabase watch list unavailable",
    );
  });
});

it("isolates the Facebook repository from eBay watches", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]"));
  const repo = createWatchlistRepository(
    "https://example.supabase.co",
    "sb_secret_test_server_only",
    fetcher,
    "facebook",
  );
  await repo.list("123");
  expect(repo.platform).toBe("facebook");
  expect(new URL(String(fetcher.mock.calls[0]?.[0])).pathname).toBe(
    "/rest/v1/facebook_watchlist",
  );
});

it("changes only supplied settings, preserving active flags and free-only filters on cadence edits", async () => {
  const original = {
    ...row,
    monitor_active: true,
    max_price: 0,
    interval_minutes: 10,
  };
  let changes: Record<string, unknown> = {};
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_input, init) => {
      changes = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify([{ ...original, ...changes, revision: 2 }]),
      );
    });
  const updated = await repository(fetcher).update(id, "123", 1, {
    interval_minutes: 1,
  });
  expect(changes).toEqual({ interval_minutes: 1 });
  expect(updated.monitor_active).toBe(true);
  expect(updated.max_price).toBe(0);
  expect(updated.free_shipping).toBe(true);
});
