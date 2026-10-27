import { createWatchSearch } from "./watch-search.js";
import { createWatchlistRepository } from "./supabase-watchlist.js";
import {
  migrateExistingWatches,
  syncWatchlist,
  publishResearch,
} from "./watchlist-sync.js";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { WatchStore } from "./watcher.js";
import { telegramSender, telegramCommands } from "./telegram.js";
import { readConfig } from "./config.js";
import { buildApp } from "./server.js";
import { createHtmlFetcher } from "./transport.js";
import { createChromeTransport } from "./chrome.js";

try {
  const config = readConfig(process.env);
  const chrome =
    config.transport === "chrome"
      ? createChromeTransport({
          timeoutMs: config.timeoutMs,
          maxBytes: config.maxBytes,
          ...(config.sessionImportFile
            ? { sessionImportFile: config.sessionImportFile }
            : {}),
          headless: config.chromeHeadless,
          ...(config.chromeProfile
            ? { profilePath: config.chromeProfile }
            : {}),
          ...(config.chromeExecutable
            ? { executablePath: config.chromeExecutable }
            : {}),
          ...(config.chromeCdp ? { cdpEndpoint: config.chromeCdp } : {}),
          ...(config.proxyUrl ? { proxyUrl: config.proxyUrl } : {}),
        })
      : undefined;
  let store: WatchStore | undefined;
  let cycle: (typeof import("./watcher.js"))["runWatchCycle"] | undefined;
  if (config.watchDb) {
    const { WatchStore, runWatchCycle } = await import("./watcher.js");
    cycle = runWatchCycle;
    await mkdir(dirname(config.watchDb), { recursive: true, mode: 0o700 });
    store = new WatchStore(config.watchDb);
    if (store.list().length === 0 && !store.setting("watchlistMigrated")) {
      for (const profile of ["chairs", "charizard_psa9_base"] as const) {
        for (const mode of ["sold", "active"] as const)
          store.create({
            name: `${profile === "chairs" ? "Chesterfield captain chairs" : "Charizard Base Set PSA 9"} — ${mode}`,
            query:
              profile === "chairs"
                ? "chesterfield captain chairs"
                : "charizard base set 4/102 PSA 9 -shadowless -1st -japanese -celebrations",
            domain: "co.uk",
            mode,
            intervalMinutes: 2,
            marketProfile: profile,
          });
      }
    }
  }
  const app = buildApp({
    ...(store ? { watchStore: store } : {}),
    fetchHtml:
      chrome?.fetchHtml ??
      createHtmlFetcher({
        timeoutMs: config.timeoutMs,
        maxBytes: config.maxBytes,
        ...(config.proxyUrl ? { proxyUrl: config.proxyUrl } : {}),
      }),
    maxConcurrent: config.maxConcurrent,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    logger: true,
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  let controlTimer: ReturnType<typeof setInterval> | undefined;
  let controls: Promise<void> | undefined;
  let running: Promise<void> | undefined;
  let stopping = false;
  app.addHook("onClose", async () => {
    stopping = true;
    clearInterval(timer);
    clearInterval(controlTimer);
    await Promise.all([running, controls]);
    await chrome?.close();
    store?.close();
  });
  const stop = async (): Promise<void> => {
    await app.close();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  await app.listen({ host: config.host, port: config.port });
  if (store && cycle) {
    const db = store;
    const runWatchCycle = cycle;
    const send =
      config.telegramToken && config.telegramChatId
        ? telegramSender(config.telegramToken, config.telegramChatId)
        : async () => {
            throw new Error("Telegram not configured");
          };
    const repository =
      config.supabaseUrl && config.supabaseSecretKey
        ? createWatchlistRepository(
            config.supabaseUrl,
            config.supabaseSecretKey,
          )
        : undefined;
    const controlTick = (): void => {
      if (controls || stopping) return;
      controls = (async () => {
        if (repository && config.telegramChatId) {
          try {
            await migrateExistingWatches(db, repository, config.telegramChatId);
            const entries = await repository.list(config.telegramChatId);
            if (stopping) return;
            syncWatchlist(db, entries);
            publishResearch(db, entries, Date.now());
            db.setSetting("watchlistLastSync", String(Date.now()));
          } catch {
            app.log.warn(
              { event: "watchlist_sync_failed" },
              "Watch list sync will retry; existing searches retained",
            );
          }
        }
        if (!stopping && config.telegramToken && config.telegramChatId)
          await telegramCommands(
            config.telegramToken,
            config.telegramChatId,
            db,
            send,
            repository,
          );
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
    controlTimer = setInterval(controlTick, 5000);
    controlTimer.unref();
    controlTick();
    const tick = (): void => {
      if (running || stopping) return;
      running = runWatchCycle(
        db,
        createWatchSearch(app, config.apiKey, () => stopping),
        send,
        Date.now,
        () => stopping,
      )
        .then(async () => {
          if (stopping) return;
          if (
            db.list().every((w) => w.baselined) &&
            !db.setting("activationSent")
          ) {
            await send(
              "Always-on eBay monitoring is live. Checking Chesterfield captain chairs and English unlimited Base Set Charizard 4/102 PSA 9 for new active and newly sold listings every two minutes. Historical results were baselined without backlog alerts. Potential below-market alerts require at least 5 comparable disclosed sales, a price 20% below median and below the typical low, and disclosed delivery. Use /status or /market chairs 3 or /market pokemon 3.",
            );
            db.setSetting("activationSent", String(Date.now()));
            for (const profile of ["chairs", "charizard_psa9_base"] as const)
              await send(db.research(profile));
          }
          app.log.info(
            {
              event: "watch_cycle",
              searches: db.list().length,
              ...db.status(),
            },
            "scheduled search cycle finished",
          );
        })
        .catch(() => {
          app.log.error(
            { event: "watch_cycle_failed" },
            "scheduled search cycle failed",
          );
        })
        .finally(() => {
          running = undefined;
        });
    };
    timer = setInterval(tick, 15000);
    timer.unref();
    tick();
  }
} catch {
  process.stderr.write(
    "Service startup failed. Check the environment configuration and listening port.\n",
  );
  process.exitCode = 1;
}
