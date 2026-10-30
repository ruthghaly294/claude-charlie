import { expect, it, vi } from "vitest";
import { createCarWatchlist } from "../../src/cars/watchlist.js";

const id = "d76774de-6fea-4d07-8adf-227d57e03da6";
const row = {
  id,
  telegram_chat_id: "123",
  make: "Toyota",
  model: "Yaris",
  fuel: "Hybrid",
  max_age_years: 8,
  alerts_active: true,
  created_at: "2026-10-28T20:00:00Z",
  deleted_at: null,
};
const repository = (fetcher: typeof fetch) =>
  createCarWatchlist("https://example.supabase.co", "sb_secret_test", fetcher);

it("lists only the owner's cars that have not been removed", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify([row])));
  expect(await repository(fetcher).list("123")).toEqual([row]);
  const url = String(fetcher.mock.calls[0]?.[0]);
  expect(url).toContain("/rest/v1/car_watchlist");
  expect(url).toContain("telegram_chat_id=eq.123");
  expect(url).toContain("deleted_at=is.null");
});

it("saves a new car for the owner and rejects unknown fuel types", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(row), { status: 201 }));
  await repository(fetcher).create(id, "123", {
    make: "Toyota",
    model: "Yaris",
    fuel: "Hybrid",
    max_age_years: 8,
  });
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
    id,
    telegram_chat_id: "123",
    make: "Toyota",
    model: "Yaris",
    fuel: "Hybrid",
  });
  await expect(
    repository(fetcher).create(id, "123", {
      make: "Toyota",
      model: "Yaris",
      // @ts-expect-error fuel outside the allowed list
      fuel: "Steam",
      max_age_years: 8,
    }),
  ).rejects.toThrow();
});

it("pauses alerts and removes cars for the owner only", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(JSON.stringify([row])));
  await repository(fetcher).update(id, "123", { alerts_active: false });
  await repository(fetcher).remove(id, "123");
  const [pause, remove] = fetcher.mock.calls;
  expect(pause?.[1]?.method).toBe("PATCH");
  expect(String(pause?.[0])).toContain(`id=eq.${id}`);
  expect(String(pause?.[0])).toContain("telegram_chat_id=eq.123");
  expect(JSON.parse(String(pause?.[1]?.body))).toEqual({
    alerts_active: false,
  });
  expect(JSON.parse(String(remove?.[1]?.body))).toHaveProperty("deleted_at");
});

it("reports Supabase failures plainly", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("{}", { status: 500 }));
  await expect(repository(fetcher).list("123")).rejects.toThrow(
    "Car list unavailable",
  );
});
