// Each lane permits one job at a time. Separate lanes keep slow research or
// retailer reports from delaying time-sensitive Marketplace scans.
export function createJobLane() {
  let running: Promise<void> | undefined;
  return {
    run(job: () => Promise<void>): void {
      if (running) return;
      running = Promise.resolve()
        .then(job)
        .finally(() => {
          running = undefined;
        });
    },
    pending: (): Promise<void> | undefined => running,
  };
}

// One lane per search so a slow scan never delays the others. The cap keeps
// concurrent Facebook tabs within the 1 GB machine; a skipped search is
// picked up on the next tick.
export function createWatchLanes(limit: number) {
  const running = new Map<string, Promise<void>>();
  return {
    run(id: string, job: () => Promise<void>): void {
      if (running.has(id) || running.size >= limit) return;
      running.set(
        id,
        Promise.resolve()
          .then(job)
          .finally(() => {
            running.delete(id);
          }),
      );
    },
    pending: (id: string): Promise<void> | undefined => running.get(id),
    idle: (): Promise<unknown> => Promise.allSettled(running.values()),
  };
}

// With one browser slot, list order would let earlier searches starve later
// ones; the most overdue search goes first.
export function dueInOrder<
  T extends { nextRun: number; once?: boolean | undefined },
>(watches: readonly T[], now: number): T[] {
  return watches
    .filter((watch) => !watch.once && watch.nextRun <= now)
    .sort((a, b) => a.nextRun - b.nextRun);
}
