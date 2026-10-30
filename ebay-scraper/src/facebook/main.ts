import { allocateBrowserPage } from "../browser-page.js";
import { ScrapeError } from "../errors.js";
import { searchHasMore } from "./parser.js";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import Fastify from "fastify";
import { startChrome } from "../chrome-process.js";
import { createWatchlistRepository } from "../supabase-watchlist.js";
import { telegramCommands, telegramSender } from "../telegram.js";
import { WatchStore, runWatchCycle, deliverWatchAlerts } from "../watcher.js";
import { publishResearch, syncWatchlist } from "../watchlist-sync.js";
import { createJobLane, createWatchLanes, dueInOrder } from "./scheduler.js";
import { drainFacebookSearch, scrollFacebookResults } from "./pagination.js";
import { createFacebookSearch, type FacebookPage } from "./search.js";
import { installVncViewer } from "./vnc.js";
import { foodCommands } from "../food/bot.js";
import { collectPrices, reportSlot, type ShopPage } from "../food/collect.js";
import { priceReport } from "../food/prices.js";
import { createCarService } from "../cars/service.js";

const env = process.env;
const apiKey = env["SERVICE_API_KEY"];
const profilePath = env["FACEBOOK_CHROME_PROFILE"];
const token = env["TELEGRAM_BOT_TOKEN"];
const chatId = env["TELEGRAM_CHAT_ID"];
if (
  !apiKey ||
  apiKey.length < 24 ||
  !profilePath?.startsWith("/") ||
  !token ||
  !chatId ||
  !env["SUPABASE_URL"] ||
  !env["SUPABASE_SECRET_KEY"]
)
  throw new Error(
    "Facebook monitor requires an API key, Chrome profile, Telegram and Supabase configuration",
  );
const expected = createHash("sha256").update(apiKey).digest();
const repository = createWatchlistRepository(
  env["SUPABASE_URL"],
  env["SUPABASE_SECRET_KEY"],
  fetch,
  "facebook",
);
const send = telegramSender(token, chatId);
const dbPath = env["FACEBOOK_WATCH_DB"] ?? "/data/facebook-watches.sqlite";
await mkdir(dirname(dbPath), { recursive: true, mode: 0o700 });
const store = new WatchStore(dbPath);
// Facebook search surfaced in-radius listings 20-60+ minutes after their
// creation time on this throttled server; a 20-minute window dropped them all.
store.setSetting("newListingMaxAgeMinutes", "60");
store.maxNewListingAgeMinutes();
const app = Fastify({ logger: true });
if (env["FACEBOOK_VNC_VIEW_TOKEN"] && env["FACEBOOK_VNC_VIEW_EXPIRES"])
  await installVncViewer(app, {
    token: env["FACEBOOK_VNC_VIEW_TOKEN"],
    expiresAt: Number(env["FACEBOOK_VNC_VIEW_EXPIRES"]),
    origin: "https://aaron-facebook-marketplace.fly.dev",
  });
let session: Awaited<ReturnType<typeof startChrome>> | undefined;
let recovering: Promise<void> | undefined;
app.get("/health", async () => ({
  status: session ? "browser_ready" : "starting",
}));
app.get("/v1/facebook/session", async (request, reply) => {
  const key = request.headers["x-api-key"];
  if (
    typeof key !== "string" ||
    !timingSafeEqual(expected, createHash("sha256").update(key).digest())
  )
    return reply.code(401).send({ code: "UNAUTHORIZED" });
  return {
    browserReady: Boolean(session),
    searches: store.list().length,
    ...store.status(),
  };
});

let stopping = false;
// One Facebook tab at a time: two need ~520 MB on this 1 GB machine.
const marketplaceLanes = createWatchLanes(1);
const backgroundLane = createJobLane();
let controls: Promise<void> | undefined;
const timers: ReturnType<typeof setInterval>[] = [];
app.addHook("onClose", async () => {
  stopping = true;
  timers.forEach(clearInterval);
  await Promise.all([
    marketplaceLanes.idle(),
    backgroundLane.pending(),
    controls,
    recovering,
  ]);
  await session?.close();
  store.close();
  cars?.close();
});
process.once("SIGTERM", () => void app.close());
process.once("SIGINT", () => void app.close());
await app.listen({ host: "0.0.0.0", port: Number(env["PORT"] ?? 3001) });

const chromeOptions = {
  profilePath,
  headless: env["FACEBOOK_CHROME_HEADLESS"] !== "false",
  ...(env["EBAY_CHROME_EXECUTABLE"]
    ? { executablePath: env["EBAY_CHROME_EXECUTABLE"] }
    : {}),
};
session = await startChrome(chromeOptions);
let browser = session.browser;
const recoverBrowser = async (active: typeof browser): Promise<void> => {
  if (browser !== active || recovering) {
    await recovering;
    return;
  }
  const previous = session;
  session = undefined;
  recovering = (async () => {
    if (previous) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          previous.close().catch(() => {}),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 4000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    if (!stopping) {
      session = await startChrome(chromeOptions);
      browser = session.browser;
    }
  })().finally(() => {
    recovering = undefined;
  });
  await recovering;
};
let allocation: Promise<void> = Promise.resolve();
const freshPage = (): Promise<import("playwright-core").Page> => {
  const result = allocation.then(async () => {
    await recovering;
    if (!session || !browser.isConnected()) await recoverBrowser(browser);
    const active = browser;
    try {
      const context = active.contexts()[0];
      if (!context) throw new Error("No browser context");
      return await allocateBrowserPage(() => context.newPage());
    } catch (error) {
      app.log.warn(
        { event: "facebook_browser_recovery" },
        "Recovering the browser after a stalled tab allocation",
      );
      await recoverBrowser(active);
      throw error;
    }
  });
  allocation = result.then(
    () => {},
    () => {},
  );
  return result;
};
const load = async (url: string): Promise<FacebookPage> => {
  const page = await freshPage();
  await page.route("**/*", (route) =>
    ["image", "media", "font"].includes(route.request().resourceType())
      ? route.abort()
      : route.continue(),
  );
  const networkPayloads: string[] = [];
  let continuation: boolean | undefined;
  let incomplete = false;
  const reads: Promise<void>[] = [];
  page.on("response", (response) => {
    if (
      new URL(response.url()).hostname === "www.facebook.com" &&
      response.url().includes("/api/graphql")
    )
      reads.push(
        response.text().then(
          (text) => {
            networkPayloads.push(text);
            const more = searchHasMore([text]);
            if (more !== undefined) continuation = more;
          },
          () => {},
        ),
      );
  });
  try {
    await page.goto(url, { waitUntil: "commit", timeout: 60000 });
    const path = new URL(page.url()).pathname;
    if (/^\/(login|checkpoint|two_step_verification)\b/.test(path))
      return { path, payloads: [] };
    // ~9% of a CPU core: Facebook's page data can take over 30s to appear.
    await page.waitForSelector('script[type="application/json"]', {
      state: "attached",
      timeout: 60000,
    });
    await page.waitForTimeout(3000);
    // Search results may arrive through Relay after the initial HTML. Load
    // additional rows instead of monitoring only the first visible handful.
    if (url.includes("/search/")) {
      continuation ??= searchHasMore(
        await page.locator('script[type="application/json"]').allTextContents(),
      );
      const observed = new Set<string>();
      await drainFacebookSearch(async () => {
        for (const href of await scrollFacebookResults(page)) {
          const id = /\/marketplace\/item\/(\d+)/.exec(href)?.[1];
          if (id) observed.add(id);
        }
        await page.waitForTimeout(2000);
        return {
          count: observed.size,
          ...(continuation !== undefined ? { hasMore: continuation } : {}),
        };
      }).catch((error) => {
        if (
          error instanceof ScrapeError &&
          error.code === "UPSTREAM_INCOMPLETE_RESULTS"
        )
          incomplete = true;
        else throw error;
      });
    }
    const payloads = await page
      .locator('script[type="application/json"]')
      .allTextContents();
    await Promise.race([Promise.allSettled(reads), page.waitForTimeout(5000)]);
    return {
      path: new URL(page.url()).pathname,
      payloads: [...payloads, ...networkPayloads],
      ...(incomplete ? { incomplete: true } : {}),
    };
  } finally {
    await page.close().catch(() => {});
  }
};
const facebookSearch = createFacebookSearch({
  load,
  seen: (job, item) => store.hasSeen(job, item),
  maxAgeMinutes: () => store.maxNewListingAgeMinutes(),
  onVerified: async (job, listing) => {
    store.recordResolvedListings(job.id, [listing], Date.now());
    await deliverWatchAlerts(store, send, Date.now, () => stopping);
  },
  onScan: (stats) =>
    app.log.info(
      { event: "facebook_scan_coverage", ...stats },
      "Facebook scan coverage",
    ),
});
const search: typeof facebookSearch = async (job) => {
  try {
    return await facebookSearch(job);
  } catch (error) {
    app.log.warn(
      {
        event: "facebook_search_failed",
        watch: job.name,
        reason:
          error instanceof Error ? error.message.split("\n")[0] : "unknown",
      },
      "Facebook search failed; it will retry",
    );
    throw error;
  }
};

const controlTick = (): void => {
  if (controls || stopping) return;
  controls = (async () => {
    try {
      const entries = await repository.list(chatId);
      if (!entries.length && !store.setting("facebookSeeded")) {
        for (const watch of [
          {
            name: "Chesterfield captain's chair",
            query: "chesterfield captain chair",
          },
          { name: "Free plants", query: "plants", max_price: 0 },
          { name: "Large round wooden table", query: "round table" },
        ])
          await repository.create(crypto.randomUUID(), chatId, {
            ...watch,
            interval_minutes: 5,
            monitor_active: true,
          });
        store.setSetting("facebookSeeded", String(Date.now()));
        return;
      }
      if (stopping) return;
      syncWatchlist(store, entries);
      publishResearch(store, entries, Date.now());
    } catch {
      app.log.warn(
        { event: "watchlist_sync_failed" },
        "Watch list sync will retry; existing searches retained",
      );
    }
    if (!stopping)
      await telegramCommands(token, chatId, store, send, repository);
    if (!stopping && foodToken && foodSend)
      await foodCommands({
        token: foodToken,
        chatId,
        store,
        send: foodSend,
        requestPrices: () => {
          foodWanted = true;
        },
      });
    if (!stopping) await cars?.commands();
  })()
    .catch(() => {
      app.log.warn(
        { event: "telegram_commands_failed" },
        "Telegram commands will retry",
      );
    })
    .finally(() => {
      controls = undefined;
    });
};
const foodToken = env["FOOD_TELEGRAM_BOT_TOKEN"];
const foodSend = foodToken ? telegramSender(foodToken, chatId) : undefined;
let foodWanted = !store.setting("foodFirstReport");
// Shop pages run their own bot checks; let them load fully, images included.
const loadShop = async (url: string): Promise<ShopPage> => {
  const page = await freshPage();
  const responses: string[] = [];
  const reads: Promise<void>[] = [];
  page.on("response", (response) => {
    if ((response.headers()["content-type"] ?? "").includes("json"))
      reads.push(
        response.text().then(
          (text) => {
            if (/pepsi/i.test(text)) responses.push(text);
          },
          () => {},
        ),
      );
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(12000);
    await Promise.race([Promise.allSettled(reads), page.waitForTimeout(10000)]);
    return { html: await page.content(), responses };
  } finally {
    await page.close().catch(() => {});
  }
};
const foodReport = async (slot: string | undefined): Promise<void> => {
  if (slot) store.setSetting(`foodReport:${slot}`, String(Date.now()));
  store.setSetting("foodFirstReport", String(Date.now()));
  const { offers, failed } = await collectPrices(loadShop);
  await foodSend?.(priceReport(offers, { failed, now: new Date() }), {
    html: true,
  });
  app.log.info(
    { event: "food_report", offers: offers.length, failed },
    "Pepsi Max price report sent",
  );
};
const carToken = env["CARS_TELEGRAM_BOT_TOKEN"];
const cars = carToken
  ? createCarService({
      token: carToken,
      chatId,
      supabaseUrl: env["SUPABASE_URL"],
      supabaseKey: env["SUPABASE_SECRET_KEY"],
      settings: store,
      dataDir: dirname(dbPath),
      browser: () => browser,
      log: app.log,
    })
  : undefined;
const backgroundTick = async (): Promise<void> => {
  const carJob = cars?.nextJob();
  if (carJob) {
    await carJob();
    return;
  }
  const slot = reportSlot(new Date());
  if (
    foodSend &&
    (foodWanted || (slot && !store.setting(`foodReport:${slot}`)))
  ) {
    foodWanted = false;
    await foodReport(slot).catch(() => {
      app.log.error({ event: "food_report_failed" }, "Price report failed");
    });
    return;
  }
  if (!stopping)
    await runWatchCycle(store, search, send, Date.now, () => stopping, {
      include: (job) => Boolean(job.once),
      deliver: false,
    });
};
const marketplaceTick = async (id: string): Promise<void> => {
  await runWatchCycle(store, search, send, Date.now, () => stopping, {
    include: (job) => job.id === id,
  })
    .then(async () => {
      const watches = store.list().filter((w) => !w.once);
      if (
        stopping ||
        !watches.length ||
        !watches.every((w) => w.baselined) ||
        store.setting("activationSent")
      )
        return;
      await send(
        `Facebook Marketplace monitoring is live: ${watches.map((w) => w.name.replace(/ — active$/, "")).join(", ")}, within ${watches[0]?.radiusKm ?? 40} km of ${watches[0]?.locationName ?? "Ballyhackamore, East Belfast"}, checked every ${watches[0]?.intervalMinutes ?? 5} minutes. Current listings were recorded as a baseline; you'll be alerted to new ones. Distances are straight-line estimates.`,
      );
      store.setSetting("activationSent", String(Date.now()));
    })
    .catch(() => {
      app.log.error(
        { event: "watch_cycle_failed" },
        "scheduled search cycle failed",
      );
    })
    .finally(() => {
      app.log.info(
        {
          event: "watch_cycle",
          searches: store.list().length,
          ...store.status(),
        },
        "scheduled search cycle finished",
      );
    });
};
const tick = (): void => {
  if (stopping) return;
  for (const watch of dueInOrder(store.list(), Date.now()))
    marketplaceLanes.run(watch.id, () => marketplaceTick(watch.id));
  backgroundLane.run(() =>
    backgroundTick().catch(() => {
      app.log.error(
        { event: "background_job_failed" },
        "Background job will retry",
      );
    }),
  );
};
timers.push(setInterval(controlTick, 5000), setInterval(tick, 15000));
timers.forEach((timer) => timer.unref());
controlTick();
tick();
