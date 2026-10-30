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
