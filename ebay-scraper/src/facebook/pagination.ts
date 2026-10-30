import { ScrapeError } from "../errors.js";

// Three settled rounds allow delayed Relay responses to arrive. A scan that
// keeps growing at the bound is incomplete, not a successful empty/new baseline.
export async function drainFacebookSearch(
  scrollAndCount: () => Promise<number | { count: number; hasMore?: boolean }>,
  maxRounds = 30,
): Promise<void> {
  let previous = -1;
  let settled = 0;
  for (let round = 0; round < maxRounds; round++) {
    const progress = await scrollAndCount();
    const count = typeof progress === "number" ? progress : progress.count;
    const more = typeof progress === "number" ? undefined : progress.hasMore;
    if (more === false) return;
    settled = count === previous ? settled + 1 : 0;
    previous = count;
    if (settled >= 3) {
      if (more === true)
        throw new ScrapeError(
          "UPSTREAM_INCOMPLETE_RESULTS",
          "Facebook reports more listings but scrolling stopped; valid results retained for this partial scan.",
          503,
        );
      return;
    }
  }
  throw new ScrapeError(
    "UPSTREAM_INCOMPLETE_RESULTS",
    "Facebook results were still loading at the scan limit; scan will retry.",
    503,
  );
}

export async function scrollFacebookResults(
  page: import("playwright-core").Page,
): Promise<string[]> {
  const links = page.locator('a[href*="/marketplace/item/"]');
  const hrefs = await links.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("href") ?? ""),
  );
  if (await links.count()) {
    await links
      .last()
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    // Wheel events target the pane beneath the pointer. The default (0,0)
    // points at Facebook's fixed header and can leave the results stationary.
    await links
      .last()
      .hover({ timeout: 2000 })
      .catch(() => {});
  }
  await page.mouse.wheel(0, 1600);
  return hrefs;
}
