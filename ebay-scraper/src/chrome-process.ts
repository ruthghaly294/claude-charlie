import { spawn, execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { Browser } from "playwright-core";
import { ScrapeError } from "./errors.js";

export type ChromeSession = {
  readonly browser: Browser;
  readonly close: () => Promise<void>;
};
type Options = {
  readonly executablePath?: string;
  readonly headless?: boolean;
  readonly profilePath?: string;
  readonly proxyUrl?: string;
};

async function chromeExecutable(explicit?: string): Promise<string> {
  for (const candidate of [
    explicit,
    join(homedir(), ".cache/ebay-search/google-chrome/chrome"),
    "/opt/google/chrome/chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
  ]) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      if (candidate === explicit) break;
    }
  }
  throw new ScrapeError(
    "BROWSER_UNAVAILABLE",
    "Google Chrome is missing. Run npm run setup:chrome or configure EBAY_CHROME_EXECUTABLE.",
    503,
  );
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string")
    throw new Error("No Chrome port available");
  return address.port;
}

export async function startChrome(
  options: Options = {},
): Promise<ChromeSession> {
  const executable = await chromeExecutable(options.executablePath);
  const headless = options.headless ?? false;
  const headlessArgs: string[] = [];
  if (headless) {
    const { stdout } = await promisify(execFile)(executable, ["--version"], {
      timeout: 30000,
      maxBuffer: 4096,
    });
    const major = stdout.match(/(?:Google Chrome|Chromium)\s+(\d+)\./)?.[1];
    if (!major)
      throw new ScrapeError(
        "BROWSER_UNAVAILABLE",
        "Unable to identify the installed Chrome version.",
        503,
      );
    const platform =
      process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : process.platform === "darwin"
          ? "Macintosh; Intel Mac OS X 10_15_7"
          : "X11; Linux x86_64";
    headlessArgs.push(
      "--headless=new",
      "--disable-blink-features=AutomationControlled",
      `--user-agent=Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
    );
  }
  const profile =
    options.profilePath ??
    (await mkdtemp(join(tmpdir(), "ebay-search-chrome-")));
  if (options.profilePath)
    await mkdir(profile, { recursive: true, mode: 0o700 });
  const removeTemporaryProfile = async (): Promise<void> => {
    if (!options.profilePath)
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
  };
  const port = await availablePort();
  const args = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    "--window-size=1366,900",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
  ];
  args.push(...headlessArgs);
  if (options.proxyUrl) {
    const proxy = new URL(options.proxyUrl);
    if (proxy.username || proxy.password) {
      await removeTemporaryProfile();
      throw new ScrapeError(
        "BROWSER_UNAVAILABLE",
        "Authenticated Chrome proxies must be configured in an external Chrome session using EBAY_CHROME_CDP.",
        503,
      );
    }
    args.push(`--proxy-server=${proxy.origin}`);
  }
  args.push("about:blank");
  const virtualDisplay =
    process.platform === "linux" && !process.env["DISPLAY"] && !headless;
  const child = spawn(
    virtualDisplay ? "xvfb-run" : executable,
    virtualDisplay
      ? ["-a", "-s", "-screen 0 1366x900x24", executable, ...args]
      : args,
    { stdio: "ignore", detached: process.platform !== "win32" },
  );
  let processError = false;
  child.once("error", () => {
    processError = true;
  });
  const exited = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  let browser: Browser | undefined;
  let shutdown: Promise<void> | undefined;
  const kill = (signal: NodeJS.Signals): void => {
    if (!child.pid) return;
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {}
  };
  const close = (): Promise<void> =>
    (shutdown ??= (async () => {
      const timer = setTimeout(() => kill("SIGKILL"), 3000);
      timer.unref();
      if (browser) {
        try {
          const cdp = await browser.newBrowserCDPSession();
          await cdp.send("Browser.close");
        } catch {}
        await browser.close().catch(() => {});
      } else {
        kill("SIGTERM");
      }
      await exited;
      clearTimeout(timer);
      await removeTemporaryProfile();
    })());
  try {
    const endpoint = `http://127.0.0.1:${port}`;
    // Cold boot on Fly's shared CPU can exceed 15s while Xvfb and VNC start too.
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && child.exitCode === null && !processError) {
      try {
        const response = await fetch(`${endpoint}/json/version`, {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) {
          const { chromium } = await import("playwright-core");
          browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
          return { browser, close };
        }
      } catch {}
      await delay(100);
    }
    throw new Error("Chrome startup failed");
  } catch {
    await close();
    throw new ScrapeError(
      "BROWSER_UNAVAILABLE",
      "Google Chrome could not start. Check Chrome and Xvfb installation or configure EBAY_CHROME_CDP.",
      503,
    );
  }
}
