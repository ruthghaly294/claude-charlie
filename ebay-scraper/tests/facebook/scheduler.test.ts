import { expect, it } from "vitest";
import {
  createJobLane,
  createWatchLanes,
} from "../../src/facebook/scheduler.js";
it("keeps marketplace scans running while an independent background job is pending", async () => {
  const marketplace = createJobLane();
  const background = createJobLane();
  let finish: () => void = () => {};
  background.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let scans = 0;
  marketplace.run(async () => {
    scans++;
  });
  await marketplace.pending();
  marketplace.run(async () => {
    scans++;
  });
  await marketplace.pending();
  expect(scans).toBe(2);
  let overlap = false;
  background.run(async () => {
    overlap = true;
  });
  expect(overlap).toBe(false);
  finish();
  await background.pending();
});
it("runs each search in its own lane, at most two at once, never overlapping itself", async () => {
  const lanes = createWatchLanes(2);
  const finish = new Map<string, () => void>();
  const started: string[] = [];
  const slow = (id: string) => () =>
    new Promise<void>((resolve) => {
      started.push(id);
      finish.set(id, resolve);
    });
  lanes.run("chair", slow("chair"));
  lanes.run("table", slow("table"));
  lanes.run("plants", slow("plants"));
  lanes.run("chair", slow("chair"));
  await Promise.resolve();
  expect(started).toEqual(["chair", "table"]);
  finish.get("table")?.();
  await lanes.pending("table");
  lanes.run("plants", slow("plants"));
  await Promise.resolve();
  expect(started).toEqual(["chair", "table", "plants"]);
  finish.get("chair")?.();
  finish.get("plants")?.();
  await Promise.all([lanes.pending("chair"), lanes.pending("plants")]);
});
