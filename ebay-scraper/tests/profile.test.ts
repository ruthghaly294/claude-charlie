import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startChrome } from "../src/chrome-process.js";
import { readConfig } from "../src/config.js";

describe("server Chrome profile", () => {
  it("requires an absolute dedicated profile and rejects conflicting CDP configuration", () => {
    expect(
      readConfig({ EBAY_CHROME_PROFILE: "/tmp/dedicated-ebay" }).chromeProfile,
    ).toBe("/tmp/dedicated-ebay");
    expect(() => readConfig({ EBAY_CHROME_PROFILE: "relative" })).toThrow();
    expect(() =>
      readConfig({
        EBAY_CHROME_PROFILE: "/tmp/dedicated-ebay",
        EBAY_CHROME_CDP: "http://127.0.0.1:9333",
      }),
    ).toThrow();
  });
  it("retains persistent cookies across restarts and preserves operator files", async () => {
    const profilePath = await mkdtemp(join(tmpdir(), "ebay-profile-test-"));
    try {
      await writeFile(join(profilePath, "operator-marker"), "keep");
      const first = await startChrome({ profilePath });
      try {
        await first.browser.contexts()[0]!.addCookies([
          {
            name: "persistence_test",
            value: "retained",
            domain: "example.com",
            path: "/",
            expires: Math.floor(Date.now() / 1000) + 3600,
            secure: true,
            httpOnly: true,
          },
        ]);
      } finally {
        await first.close();
      }
      expect(await readFile(join(profilePath, "operator-marker"), "utf8")).toBe(
        "keep",
      );
      const second = await startChrome({ profilePath });
      try {
        expect(
          (
            await second.browser.contexts()[0]!.cookies("https://example.com")
          ).find((cookie) => cookie.name === "persistence_test")?.value,
        ).toBe("retained");
      } finally {
        await second.close();
      }
    } finally {
      await rm(profilePath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  }, 30000);
});
