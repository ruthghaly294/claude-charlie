import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { WatchStore } from "./watcher.js";
import { telegramSender, telegramCommands } from "./telegram.js";
import { searchResponseSchema } from "./contract.js";
import { ScrapeError } from "./errors.js";
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
    if (store.list().length === 0) {
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
  let running: Promise<void> | undefined;
  let stopping = false;
  app.addHook("onClose", async () => {
    stopping = true;
    clearInterval(timer);
    await running;
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
    const tick = (): void => {
      if (running || stopping) return;
      running = runWatchCycle(
        db,
        async (job) => {
          if (stopping) throw new Error("Stopping");
          const params = new URLSearchParams({
            query: job.query,
            domain: job.domain,
          });
          if (job.mode === "active") params.set("sort_by", "newly_listed");
          else params.set("sold_only", "true");
          if (job.maxPrice !== undefined)
            params.set("max_price", String(job.maxPrice));
          const results: import("./contract.js").Listing[] = [];
          for (
            let page = 1;
            page <= (job.mode === "sold" && !job.baselined ? 3 : 1);
            page++
          ) {
            params.set("page", String(page));
            const response = await app.inject({
              method: "GET",
              url: `/v1/ebay/${job.mode === "active" ? "search" : "completed"}?${params}`,
              headers: config.apiKey ? { "x-api-key": config.apiKey } : {},
            });
            if (response.statusCode !== 200) {
              const body: unknown = response.json();
              const code =
                typeof body === "object" &&
                body !== null &&
                "code" in body &&
                typeof body.code === "string"
                  ? body.code
                  : "SEARCH_FAILED";
              throw new ScrapeError(
                code,
                "Scheduled search failed",
                response.statusCode,
              );
            }
            const result = searchResponseSchema.parse(response.json());
            results.push(...result.results);
            if (!result.pagination.has_more) break;
          }
          return results;
        },
        send,
        Date.now,
        () => stopping,
      )
        .then(async () => {
          if (stopping) return;
          if (config.telegramToken && config.telegramChatId) {
            await telegramCommands(
              config.telegramToken,
              config.telegramChatId,
              db,
              send,
            ).catch(() => {
              app.log.warn(
                { event: "telegram_commands_failed" },
                "Telegram commands will retry",
              );
            });
          }
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
