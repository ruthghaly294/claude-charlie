import { expect, it } from "vitest";
import { allocateBrowserPage } from "../src/browser-page.js";
it("bounds a stalled tab allocation and closes a tab that arrives after its deadline", async () => {
  let finish: (page: { close(): Promise<void> }) => void = () => {};
  let closed = false;
  const pending = allocateBrowserPage(
    () =>
      new Promise<{ close(): Promise<void> }>((resolve) => {
        finish = resolve;
      }),
    10,
  );
  await expect(pending).rejects.toMatchObject({ code: "BROWSER_PAGE_STALLED" });
  finish({
    close: async () => {
      closed = true;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(closed).toBe(true);
});
it("keeps a normally allocated page open for its caller", async () => {
  let closed = false;
  const page = {
    close: async () => {
      closed = true;
    },
  };
  expect(await allocateBrowserPage(async () => page, 100)).toBe(page);
  expect(closed).toBe(false);
});
it("reports a failed navigation without crashing on the abandoned response wait", async () => {
  const { navigateAndWait } = await import("../src/browser-page.js");
  const waiting = new Promise<never>((_resolve, reject) =>
    setTimeout(() => reject(new Error("response timeout")), 10),
  );
  await expect(
    navigateAndWait(waiting, () => Promise.reject(new Error("goto timeout"))),
  ).rejects.toThrow("goto timeout");
  await new Promise((resolve) => setTimeout(resolve, 30));
});
it("returns the awaited response after navigation succeeds", async () => {
  const { navigateAndWait } = await import("../src/browser-page.js");
  await expect(
    navigateAndWait(Promise.resolve("listings"), async () => {}),
  ).resolves.toBe("listings");
});
