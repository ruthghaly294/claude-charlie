import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

describe("startup configuration", () => {
  it("defaults to localhost, bounded fetching and no external credentials", () => {
    expect(readConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3001,
      timeoutMs: 45000,
      maxBytes: 12582912,
      maxConcurrent: 4,
      transport: "chrome",
      chromeHeadless: false,
    });
  });
  it("supports a dedicated loopback Chrome session and direct-mode opt-in", () => {
    expect(
      readConfig({ EBAY_CHROME_CDP: "http://127.0.0.1:9333" }).chromeCdp,
    ).toBe("http://127.0.0.1:9333");
    expect(readConfig({ EBAY_TRANSPORT: "direct" }).transport).toBe("direct");
    expect(() =>
      readConfig({ EBAY_CHROME_CDP: "http://example.com:9333" }),
    ).toThrow();
  });
  it("requires a service key when listening outside loopback", () => {
    expect(() => readConfig({ HOST: "0.0.0.0" })).toThrow(/key/i);
    expect(
      readConfig({
        HOST: "0.0.0.0",
        SERVICE_API_KEY: "a-secure-service-key-with-32-chars",
      }).host,
    ).toBe("0.0.0.0");
  });
  it("accepts an operator-configured proxy and operational limits", () => {
    expect(
      readConfig({
        PORT: "3002",
        EBAY_PROXY_URL: "http://localhost:8888",
        EBAY_TIMEOUT_MS: "15000",
        EBAY_MAX_BYTES: "1000000",
        MAX_CONCURRENT: "2",
      }),
    ).toMatchObject({
      port: 3002,
      proxyUrl: "http://localhost:8888",
      timeoutMs: 15000,
      maxBytes: 1000000,
      maxConcurrent: 2,
    });
  });
  it.each([
    { PORT: "-1" },
    { PORT: "garbage" },
    { EBAY_TIMEOUT_MS: "0" },
    { MAX_CONCURRENT: "100000" },
    { EBAY_PROXY_URL: "file:///etc/passwd" },
    { SERVICE_API_KEY: "short" },
  ])("rejects unsafe configuration %j", (env) => {
    expect(() => readConfig(env)).toThrow();
  });
});
