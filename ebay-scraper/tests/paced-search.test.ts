import { expect, it } from "vitest";
import { paceSearch } from "../src/paced-search.js";
import { watchSchema, type Watch } from "../src/watcher.js";
const job: Watch = {
  ...watchSchema.parse({ name: "chairs", query: "chairs", mode: "active" }),
  id: "job",
  baselined: true,
  nextRun: 0,
  lastSuccess: null,
  lastError: null,
  resultCount: 0,
};
it("spaces both successful and failed scheduled searches without changing the watch", async () => {
  let now = 1000;
  const starts: number[] = [];
  const received: Watch[] = [];
  const search = paceSearch(
    async (watch) => {
      starts.push(now);
      received.push(watch);
      if (starts.length === 1) throw new Error("temporary");
      return [];
    },
    {
      gapMs: 20000,
      clock: () => now,
      wait: async (ms) => {
        now += ms;
      },
    },
  );
  await expect(search(job)).rejects.toThrow("temporary");
  await expect(search(job)).resolves.toEqual([]);
  await search(job);
  expect(starts).toEqual([1000, 21000, 41000]);
  expect(received).toEqual([job, job, job]);
});
it("stops before issuing a search if shutdown begins during the spacing wait", async () => {
  let now = 0,
    stopping = false,
    calls = 0;
  const search = paceSearch(
    async () => {
      calls++;
      return [];
    },
    {
      gapMs: 20000,
      clock: () => now,
      shouldStop: () => stopping,
      wait: async (ms) => {
        now += ms;
        stopping = true;
      },
    },
  );
  await search(job);
  await expect(search(job)).rejects.toThrow("Stopping");
  expect(calls).toBe(1);
});
