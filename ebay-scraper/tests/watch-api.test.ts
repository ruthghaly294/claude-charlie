import { describe, it, expect } from "vitest";
import { buildApp } from "../src/server.js";
import { WatchStore } from "../src/watcher.js";
describe("saved search API", () => {
  it("authenticates create/list/delete and validates configuration", async () => {
    const store = new WatchStore(":memory:");
    const app = buildApp({
      watchStore: store,
      apiKey: "service-key-with-at-least-24-chars",
    });
    const headers = { "x-api-key": "service-key-with-at-least-24-chars" };
    try {
      expect((await app.inject({ url: "/v1/watches" })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/watches",
            headers,
            payload: {
              name: "Bad",
              query: "chair",
              mode: "active",
              intervalMinutes: 0,
            },
          })
        ).statusCode,
      ).toBe(400);
      const r = await app.inject({
        method: "POST",
        url: "/v1/watches",
        headers,
        payload: { name: "Chairs", query: "chair", mode: "active" },
      });
      expect(r.statusCode).toBe(201);
      expect(
        (await app.inject({ url: "/v1/watches", headers })).json().searches,
      ).toHaveLength(1);
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/v1/watches/${r.json().id}`,
            headers,
          })
        ).statusCode,
      ).toBe(204);
    } finally {
      await app.close();
      store.close();
    }
  });
});
