import { mkdir } from "node:fs/promises";
import { startChrome } from "../chrome-process.js";
import { WatchStore } from "../watcher.js";
import { createCarService } from "./service.js";

const env = process.env;
const token = env["CARS_TELEGRAM_BOT_TOKEN"];
const chatId = env["TELEGRAM_CHAT_ID"];
const supabaseUrl = env["SUPABASE_URL"];
const supabaseKey = env["SUPABASE_SECRET_KEY"];
const dataDir = env["CARS_DATA_DIR"] ?? "/data";
if (!token || !chatId || !supabaseUrl || !supabaseKey)
  throw new Error("Car tracker requires Telegram and Supabase configuration");

const write =
  (level: string) =>
  (details: object, msg: string): void =>
    console.log(JSON.stringify({ level, time: Date.now(), ...details, msg }));
const log = { info: write("info"), warn: write("warn"), error: write("error") };

await mkdir(dataDir, { recursive: true, mode: 0o700 });
const settings = new WatchStore(`${dataDir}/car-settings.sqlite`);
const chromeOptions = {
  profilePath: `${dataDir}/cars-chrome`,
  headless: true,
  ...(env["EBAY_CHROME_EXECUTABLE"]
    ? { executablePath: env["EBAY_CHROME_EXECUTABLE"] }
    : {}),
};
let session = await startChrome(chromeOptions);
const cars = createCarService({
  token,
  chatId,
  supabaseUrl,
  supabaseKey,
  settings,
  dataDir,
  browser: () => session.browser,
  log,
});

let stopping = false;
let commands: Promise<void> | undefined;
let job: Promise<void> | undefined;
const controlTick = (): void => {
  if (stopping || commands) return;
  commands = cars
    .commands()
    .catch(() => log.warn({ event: "car_commands_failed" }, "Will retry"))
    .finally(() => {
      commands = undefined;
    });
};
const tick = (): void => {
  if (stopping || job) return;
  const next = cars.nextJob();
  if (!next) return;
  job = (async () => {
    if (!session.browser.isConnected()) {
      await session.close().catch(() => {});
      session = await startChrome(chromeOptions);
    }
    await next();
  })()
    .catch(() => log.error({ event: "car_job_failed" }, "Will retry"))
    .finally(() => {
      job = undefined;
    });
};
const timers = [setInterval(controlTick, 5000), setInterval(tick, 15000)];
log.info({ event: "car_tracker_started" }, "Car tracker running");
controlTick();
tick();

const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  timers.forEach(clearInterval);
  await Promise.allSettled([commands, job]);
  await session.close().catch(() => {});
  cars.close();
  settings.close();
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
