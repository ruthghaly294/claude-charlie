/** Run `fn` over `items` with at most `limit` concurrent invocations. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!);
      }
    }),
  );
  return results;
}
