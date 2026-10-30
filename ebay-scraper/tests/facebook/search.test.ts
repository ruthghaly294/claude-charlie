import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createFacebookSearch } from "../../src/facebook/search.js";
import { watchSchema } from "../../src/watch-config.js";
import type { Watch } from "../../src/watcher.js";

const capture = (name: string): { path: string; payloads: string[] } =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
  );
const watch = (query: string): Watch => ({
  ...watchSchema.parse({
    name: query,
    query,
    mode: "active",
    provider: "facebook",
    latitude: 54.5948,
    longitude: -5.8901,
    radiusKm: 40,
  }),
  id: "job",
  baselined: true,
  nextRun: 0,
  lastSuccess: null,
  lastError: null,
  resultCount: 0,
});
const detail = (id: string, latitude: number, longitude: number) => {
  const page = capture("facebook-detail.json");
  return {
    path: `/marketplace/item/${id}/`,
    payloads: page.payloads.map((p) =>
      p
        .replace('"id":"1083292931250072"', `"id":"${id}"`)
        .replace(
          '"latitude":54.577331542969,"longitude":-6.0369873046875',
          `"latitude":${latitude},"longitude":${longitude}`,
        ),
    ),
  };
};

function fakeFacebook() {
  const loaded: string[] = [];
  const load = async (url: string) => {
    loaded.push(url);
    if (url.includes("/search/")) return capture("facebook-search.json");
    if (url.includes("1083292931250072"))
      return capture("facebook-detail.json");
    return detail("1839478290721633", 53.3498, -6.2603);
  };
  return { loaded, load };
}

it("returns listings inside the radius, with their straight-line distance", async () => {
  const facebook = fakeFacebook();
  const results = await createFacebookSearch({ load: facebook.load })(
    watch("chesterfield chair"),
  );
  expect(facebook.loaded[0]).toBe(
    "https://www.facebook.com/marketplace/belfast/search/?query=chesterfield+chair&sortBy=creation_time_descend&exact=false&daysSinceListed=1",
  );
  expect(results.map((r) => r.item_id)).toEqual(["1083292931250072"]);
  expect(results[0]).toMatchObject({
    url: "https://www.facebook.com/marketplace/item/1083292931250072/",
    price: { value: 495, raw: "£495" },
    location: "Dunmurry · approx. 9.7 km (straight-line)",
  });
  expect(facebook.loaded).toHaveLength(5);
});

it("looks up each listing's location once", async () => {
  const loaded: string[] = [];
  const search = createFacebookSearch({
    load: async (url) => {
      loaded.push(url);
      return url.includes("/search/")
        ? capture("facebook-search.json")
        : detail(/item\/(\d+)/.exec(url)?.[1] ?? "", 53.3498, -6.2603);
    },
  });
  await search(watch("chesterfield chair"));
  await search(watch("chesterfield chair"));
  expect(loaded.filter((url) => url.includes("/item/"))).toHaveLength(4);
});

it("excludes listings whose location Facebook does not disclose", async () => {
  const results = await createFacebookSearch({
    load: async (url) =>
      url.includes("/search/")
        ? capture("facebook-search.json")
        : { path: "/marketplace/item/1/", payloads: [] },
  })(watch("chesterfield chair"));
  expect(results).toEqual([]);
});

it.each([
  "/login/",
  "/checkpoint/1501092823525282/",
  "/two_step_verification/authentication/",
])(
  "reports a sign-in requirement when Facebook redirects to %s",
  async (path) => {
    await expect(
      createFacebookSearch({
        load: async () => ({ path, payloads: [] }),
      })(watch("chesterfield chair")),
    ).rejects.toMatchObject({ code: "UPSTREAM_AUTH_REQUIRED" });
  },
);

it("baselines from Facebook's own radius without opening each listing page", async () => {
  const facebook = fakeFacebook();
  const results = await createFacebookSearch({ load: facebook.load })({
    ...watch("chesterfield chair"),
    baselined: false,
  });
  expect(facebook.loaded).toHaveLength(1);
  expect(results.map((r) => [r.item_id, r.location])).toEqual([
    ["1083292931250072", "Dunmurry"],
    ["1839478290721633", "Newtownabbey"],
    ["1047461097992756", "Ballyclare"],
    ["955464317124643", "Carrickfergus"],
  ]);
});

it("opens only listings this search has not already recorded", async () => {
  const facebook = fakeFacebook();
  const results = await createFacebookSearch({
    load: facebook.load,
    seen: (_job, item) => item === "1839478290721633",
  })(watch("chesterfield chair"));
  expect(facebook.loaded.filter((url) => url.includes("/item/"))).toEqual([
    "https://www.facebook.com/marketplace/item/1083292931250072/",
    "https://www.facebook.com/marketplace/item/1047461097992756/",
    "https://www.facebook.com/marketplace/item/955464317124643/",
  ]);
  expect(results.map((r) => r.item_id).sort()).toEqual([
    "1083292931250072",
    "1839478290721633",
  ]);
});

it("asks Facebook for free items only and trusts its matching, since free listings rarely name the category", async () => {
  const loaded: string[] = [];
  const [payload] = capture("facebook-search.json").payloads;
  const free = payload!.replace(
    '"formatted_amount":"£50","amount_with_offset_in_currency":"6650","amount":"50.00"',
    '"formatted_amount":"FREE","amount_with_offset_in_currency":"0","amount":"0.00"',
  );
  const results = await createFacebookSearch({
    load: async (url) => {
      loaded.push(url);
      return { path: "/marketplace/belfast/search/", payloads: [free] };
    },
  })({ ...watch("plants"), maxPrice: 0, baselined: false });
  expect(new URL(loaded[0]!).searchParams.get("maxPrice")).toBe("0");
  expect(results.map((r) => r.title)).toEqual([
    "Black chesterfield single chair",
  ]);
});

it("alerts a new free listing nearby even when its title does not repeat the search words", async () => {
  const [payload] = capture("facebook-search.json").payloads;
  const free = payload!.replace(
    '"formatted_amount":"£495","amount_with_offset_in_currency":"65832","amount":"495.00"',
    '"formatted_amount":"FREE","amount_with_offset_in_currency":"0","amount":"0.00"',
  );
  const results = await createFacebookSearch({
    load: async (url) =>
      url.includes("/search/")
        ? { path: "/marketplace/belfast/search/", payloads: [free] }
        : capture("facebook-detail.json"),
  })({ ...watch("plants"), maxPrice: 0 });
  expect(results.map((r) => [r.item_id, r.location])).toEqual([
    ["1083292931250072", "Dunmurry · approx. 9.7 km (straight-line)"],
  ]);
});

it("does not treat an unrecognized or blocked search payload as a successful empty scan", async () => {
  await expect(
    createFacebookSearch({
      load: async () => ({
        path: "/marketplace/belfast/search/",
        payloads: ['{"login_required":true}'],
      }),
    })(watch("table")),
  ).rejects.toMatchObject({ code: "UPSTREAM_MARKUP_CHANGED" });
});
it("keeps Facebook's listing creation timestamp through the shared listing contract", async () => {
  const facebook = fakeFacebook();
  const rows = await createFacebookSearch({ load: facebook.load })(
    watch("chesterfield chair"),
  );
  expect(rows[0]?.listed_at).toBe(new Date(1790808552 * 1000).toISOString());
});

it("records an explicitly empty Facebook search feed regardless of field order", async () => {
  const rows = await createFacebookSearch({
    load: async () => ({
      path: "/marketplace/belfast/search/",
      payloads: [
        'for (;;);{"data":{"marketplace_search":{"feed_units":{"__typename":"MarketplaceSearchFeed","edges":[],"page_info":{"has_next_page":false}}}}}',
      ],
    }),
  })(watch("plants"));
  expect(rows).toEqual([]);
});

it("recognises Facebook's live explicit no-results story", async () => {
  const rows = await createFacebookSearch({
    load: async () => ({
      path: "/marketplace/belfast/search/",
      payloads: [
        JSON.stringify({
          data: {
            marketplace_search: {
              feed_units: {
                edges: [
                  {
                    node: {
                      __typename: "MarketplaceSearchFeedNoResults",
                      story_type: "SERP_NO_RESULTS",
                      story_key: "0",
                    },
                  },
                ],
              },
            },
          },
        }),
      ],
    }),
  })(watch("plants"));
  expect(rows).toEqual([]);
});

it("keeps valid matches when another listing's detail page fails", async () => {
  const search = createFacebookSearch({
    load: async (url) => {
      if (url.includes("/search/")) return capture("facebook-search.json");
      if (url.includes("1083292931250072")) throw Error("timeout");
      return detail("1839478290721633", 54.5948, -5.8901);
    },
  });
  try {
    await search(watch("chesterfield chair"));
    throw Error("Expected partial scan");
  } catch (error) {
    expect(error).toMatchObject({
      code: "UPSTREAM_PARTIAL_SCAN",
      results: [expect.objectContaining({ item_id: "1839478290721633" })],
    });
  }
});
it("does not open old listing detail pages in strict live mode", async () => {
  const facebook = fakeFacebook();
  const results = await createFacebookSearch({
    load: facebook.load,
    maxAgeMinutes: () => 10,
    clock: () => Date.parse("2026-10-30T12:00:00Z"),
  })(watch("chesterfield chair"));
  expect(facebook.loaded).toHaveLength(1);
  expect(results).toHaveLength(4);
});

it("retains useful rows when the browser reports that pagination was incomplete", async () => {
  const facebook = fakeFacebook();
  const search = createFacebookSearch({
    load: async (url) => {
      const page = await facebook.load(url);
      return {
        ...page,
        ...(url.includes("/search/") ? { incomplete: true } : {}),
      };
    },
  });
  await expect(search(watch("chesterfield chair"))).rejects.toMatchObject({
    code: "UPSTREAM_PARTIAL_SCAN",
    results: expect.arrayContaining([
      expect.objectContaining({ item_id: "1083292931250072" }),
    ]),
  });
});

it("streams a verified fresh match before later listing details finish", async () => {
  const sent: string[] = [];
  const facebook = fakeFacebook();
  const search = createFacebookSearch({
    load: async (url) => {
      if (url.includes("1839478290721633"))
        expect(sent).toEqual(["1083292931250072"]);
      return facebook.load(url);
    },
    maxAgeMinutes: () => 10,
    clock: () => 1790808552 * 1000 + 60000,
    onVerified: async (_job, row) => {
      sent.push(row.item_id);
    },
  });
  await search(watch("chesterfield chair"));
  expect(sent).toEqual(["1083292931250072"]);
});

it("trusts Facebook's search matching, so a nearby listing without the search words in its title still alerts", async () => {
  const results = await createFacebookSearch({
    load: async (url) =>
      url.includes("/search/")
        ? capture("facebook-search.json")
        : detail(/item\/(\d+)/.exec(url)?.[1] ?? "", 54.6, -5.9),
  })(watch("round table"));
  expect(results.map((r) => r.item_id)).toContain("1083292931250072");
});

it("stamps each listing with when the monitor first saw it", async () => {
  const facebook = fakeFacebook();
  const results = await createFacebookSearch({
    load: facebook.load,
    clock: () => Date.parse("2026-10-30T12:00:00Z"),
  })(watch("chesterfield chair"));
  expect(results.length).toBeGreaterThan(0);
  expect(
    results.every((r) => r.detected_at === "2026-10-30T12:00:00.000Z"),
  ).toBe(true);
});
