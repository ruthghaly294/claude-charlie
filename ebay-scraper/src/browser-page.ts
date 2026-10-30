import { ScrapeError } from "./errors.js";
export async function allocateBrowserPage<T extends { close(): Promise<void> }>(
  open: () => Promise<T>,
  timeoutMs = 20000,
): Promise<T> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const error = new ScrapeError(
    "BROWSER_PAGE_STALLED",
    "Browser tab allocation stalled; the browser will recover before retrying.",
    503,
  );
  const opening = Promise.resolve()
    .then(open)
    .then((page) => {
      if (expired) {
        void page.close().catch(() => {});
        throw error;
      }
      return page;
    });
  try {
    return await Promise.race([
      opening,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
