import { startChrome } from "./chrome-process.js";
import { readConfig } from "./config.js";

const config = readConfig(process.env);
if (!config.chromeProfile || config.chromeCdp) {
  throw new Error(
    "Set EBAY_CHROME_PROFILE to a dedicated absolute directory. Stop the API before login.",
  );
}
const session = await startChrome({
  profilePath: config.chromeProfile,
  headless: false,
  ...(config.chromeExecutable
    ? { executablePath: config.chromeExecutable }
    : {}),
});
const stop = async (): Promise<void> => {
  await session.close();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
const context = session.browser.contexts()[0];
if (!context) {
  await stop();
  throw new Error("Chrome has no browser context");
}
const page = await context.newPage();
await page.goto("https://www.ebay.co.uk/signin/", {
  waitUntil: "domcontentloaded",
});
process.stdout.write(
  "Sign into eBay in the server Chrome window. After completing login, stop this process with Ctrl+C, then start the API.\n",
);
await new Promise<void>((resolve) =>
  session.browser.once("disconnected", () => resolve()),
);
await session.close();
