import { expect, it } from "vitest";
import { carCommands, carSender } from "../../src/cars/bot.js";
import { WatchStore } from "../../src/watcher.js";
import type {
  CarDraft,
  CarWatch,
  CarWatchlist,
} from "../../src/cars/watchlist.js";

const token = "123456:abcdefghijklmnopqrstuvwxyz";
const capture = () => {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const fetcher = (async (url, init) => {
    calls.push({
      method: String(url).split("/").at(-1) ?? "",
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify({ ok: true }));
  }) as typeof fetch;
  return { calls, fetcher };
};
const photo = (n: number) => `https://m.atcdn.co.uk/a/media/w800h600/${n}.jpg`;

it("sends up to four car photos as one album with the details as its caption", async () => {
  const { calls, fetcher } = capture();
  await carSender(
    token,
    "123",
    fetcher,
  )("<b>RAV4</b>", [1, 2, 3, 4, 5].map(photo));
  expect(calls).toHaveLength(1);
  expect(calls[0]?.method).toBe("sendMediaGroup");
  expect(calls[0]?.body["media"]).toEqual(
    [1, 2, 3, 4].map((n, i) => ({
      type: "photo",
      media: photo(n),
      ...(i === 0 ? { caption: "<b>RAV4</b>", parse_mode: "HTML" } : {}),
    })),
  );
});

it("sends a single photo, or text only, and never images from other sites", async () => {
  const { calls, fetcher } = capture();
  const send = carSender(token, "123", fetcher);
  await send("one", [
    "https://image.usedcarsni.com/photos/000/1/2.600.jpg",
    "https://evil.example/x.jpg",
  ]);
  await send("none", ["http://m.atcdn.co.uk/a/media/w800h600/1.jpg"]);
  expect(calls.map((c) => c.method)).toEqual(["sendPhoto", "sendMessage"]);
  expect(calls[0]?.body).toMatchObject({ caption: "one", parse_mode: "HTML" });
  expect(calls[1]?.body).toMatchObject({ text: "none", parse_mode: "HTML" });
});

const rav4: CarWatch = {
  id: "d76774de-6fea-4d07-8adf-227d57e03da6",
  telegram_chat_id: "123",
  make: "Toyota",
  model: "RAV4",
  fuel: null,
  max_age_years: 8,
  alerts_active: true,
  created_at: "2026-10-28T20:00:00Z",
  deleted_at: null,
};
type Update = { chat: number; text: string } | { from: number; data: string };
const bot = () => {
  const store = new WatchStore(":memory:");
  const sent: { text: string; options: unknown }[] = [];
  const refreshed: string[] = [];
  const watches: CarWatch[] = [rav4];
  const changes: string[] = [];
  const watchlist: CarWatchlist = {
    list: async () => watches.filter((w) => !w.deleted_at),
    create: async (id, chatId, draft: CarDraft) => {
      const watch = {
        ...rav4,
        ...draft,
        id,
        telegram_chat_id: chatId,
      };
      watches.push(watch);
      return watch;
    },
    update: async (id, _chat, patch) => {
      changes.push(`${id}:alerts=${patch.alerts_active}`);
    },
    remove: async (id) => {
      changes.push(`${id}:removed`);
    },
  };
  let updateId = 1;
  const run = (...updates: Update[]) =>
    carCommands({
      token,
      chatId: "123",
      store,
      watchlist,
      send: async (text, options) => void sent.push({ text, options }),
      catalogue: async (make) =>
        make === undefined
          ? [
              { id: "30", name: "Toyota" },
              { id: "31", name: "Vauxhall" },
            ]
          : make.id === "30"
            ? [
                { id: "1262", name: "Yaris" },
                { id: "299179359", name: "Yaris Cross" },
                { id: "7822", name: "RAV4" },
              ]
            : [],
      report: (watch) => [`grid for ${watch.model}`],
      refresh: (watch) => void refreshed.push(watch?.model ?? "all"),
      fetcher: (async (url: string) =>
        new Response(
          JSON.stringify(
            String(url).includes("getUpdates")
              ? {
                  ok: true,
                  result: updates.map((u) =>
                    "text" in u
                      ? {
                          update_id: updateId++,
                          message: {
                            chat: { id: u.chat, type: "private" },
                            text: u.text,
                          },
                        }
                      : {
                          update_id: updateId++,
                          callback_query: {
                            id: "cb",
                            data: u.data,
                            from: { id: u.from },
                            message: { chat: { id: u.from, type: "private" } },
                          },
                        },
                  ),
                }
              : { ok: true },
          ),
        )) as typeof fetch,
    });
  const texts = () => sent.map((m) => m.text);
  return { store, sent, texts, run, refreshed, watches, changes };
};
const me = (text: string) => ({ chat: 123, text });

it("adds a car from Telegram: make, model, fuel and age, checked against the site", async () => {
  const b = bot();
  await b.run(me("Add car"));
  expect(b.texts().at(-1)).toContain("Which make");
  await b.run(me("toyta"));
  expect(b.texts().at(-1)).toContain("couldn't find");
  await b.run(me("toyota"));
  expect(b.texts().at(-1)).toContain("Which Toyota model");
  expect(b.texts().at(-1)).toContain("Yaris Cross");
  await b.run(me("yaris"));
  expect(b.texts().at(-1)).toContain("Which fuel");
  await b.run(me("Hybrid"));
  expect(b.texts().at(-1)).toContain("Maximum age");
  await b.run(me("30"));
  expect(b.texts().at(-1)).toContain("1 to 20");
  await b.run(me("6"));
  expect(b.watches.at(-1)).toMatchObject({
    make: "Toyota",
    model: "Yaris",
    fuel: "Hybrid",
    max_age_years: 6,
  });
  expect(b.texts().at(-1)).toContain(
    "Added Toyota Yaris (Hybrid, under 6 years)",
  );
  expect(b.refreshed).toEqual(["Yaris"]);
  b.store.close();
});

it("accepts any fuel and lets the owner cancel part-way", async () => {
  const b = bot();
  await b.run(
    me("Add car"),
    me("Toyota"),
    me("Yaris Cross"),
    me("Any fuel"),
    me("8"),
  );
  expect(b.watches.at(-1)).toMatchObject({ model: "Yaris Cross", fuel: null });
  await b.run(me("Add car"), me("Cancel"), me("Vauxhall"));
  expect(b.watches).toHaveLength(2);
  b.store.close();
});

it("lists cars with buttons to see the market, pause alerts or remove", async () => {
  const b = bot();
  await b.run(me("Car list"));
  expect(b.sent.at(-1)?.text).toContain(
    "Toyota RAV4 · any fuel · under 8 years · alerts on",
  );
  expect(JSON.stringify(b.sent.at(-1)?.options)).toContain(
    `car:pause:${rav4.id}`,
  );
  await b.run({ from: 123, data: `car:market:${rav4.id}` });
  expect(b.texts().at(-1)).toBe("grid for RAV4");
  await b.run({ from: 123, data: `car:pause:${rav4.id}` });
  await b.run({ from: 123, data: `car:remove:${rav4.id}` });
  await b.run({ from: 999, data: `car:remove:${rav4.id}` });
  expect(b.changes).toEqual([`${rav4.id}:alerts=false`, `${rav4.id}:removed`]);
  b.store.close();
});

it("asks which car's market to show when several are watched", async () => {
  const b = bot();
  await b.run(me("Market"));
  expect(b.texts().at(-1)).toBe("grid for RAV4");
  b.watches.push({
    ...rav4,
    id: "e76774de-6fea-4d07-8adf-227d57e03da6",
    model: "Yaris",
  });
  await b.run(me("Market"));
  expect(b.texts().at(-1)).toContain("Which car");
  expect(JSON.stringify(b.sent.at(-1)?.options)).toContain("Toyota Yaris");
  await b.run(me("Refresh"), { chat: 999, text: "Refresh" });
  expect(b.refreshed).toEqual(["all"]);
  b.store.close();
});
