import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { runLast30Days, type SpawnFn, type SpawnedProcess } from "./last30days";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

function spawnFnFor(child: FakeChild): SpawnFn {
  return vi.fn().mockReturnValue(child as unknown as SpawnedProcess);
}

function finish(child: FakeChild, stdout: string, code = 0, stderr = "") {
  if (stdout) child.stdout.emit("data", Buffer.from(stdout));
  if (stderr) child.stderr.emit("data", Buffer.from(stderr));
  child.emit("close", code);
}

function reportJson(itemsBySource: Record<string, unknown[]> = {}): string {
  return JSON.stringify({
    topic: "claude code",
    range_from: "2026-05-13",
    range_to: "2026-06-12",
    generated_at: "2026-06-12T19:15:05Z",
    provider_runtime: { reasoning_provider: "local", planner_model: "x", rerank_model: "y" },
    query_plan: {
      intent: "discover",
      freshness_mode: "recent",
      cluster_mode: "topic",
      raw_topic: "claude code",
      subqueries: [],
      source_weights: {},
    },
    clusters: [],
    ranked_candidates: [],
    items_by_source: itemsBySource,
    errors_by_source: { x: "x search returned 403" },
    warnings: ["Instagram bonus source silent"],
    artifacts: {},
  });
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    item_id: "1",
    source: "hackernews",
    title: "Some title",
    body: "body",
    url: "https://example.com/1",
    date_confidence: "high",
    engagement: { points: 4, comments: 2 },
    relevance_hint: 0.5,
    why_relevant: "",
    snippet: "snippet",
    metadata: {},
    ...overrides,
  };
}

describe("runLast30Days", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("spawns python with the topic as a single argv element and --emit=json", async () => {
    const child = new FakeChild();
    const spawnFn = spawnFnFor(child);

    const promise = runLast30Days(
      "claude code agents",
      {},
      { LAST30DAYS_SCRIPT: "/script.py", LAST30DAYS_PYTHON: "python3.12" },
      spawnFn,
    );
    finish(child, reportJson());
    await promise;

    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [command, args] = (spawnFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string[],
      unknown,
    ];
    expect(command).toBe("python3.12");
    expect(args).toEqual(["/script.py", "claude code agents", "--emit=json"]);
  });

  it("appends --quick when opts.quick is set", async () => {
    const child = new FakeChild();
    const spawnFn = spawnFnFor(child);

    const promise = runLast30Days(
      "topic",
      { quick: true },
      { LAST30DAYS_SCRIPT: "/script.py" },
      spawnFn,
    );
    finish(child, reportJson());
    await promise;

    const args = (spawnFn as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string[];
    expect(args).toContain("--quick");
  });

  it("parses fixture JSON, caps each source at 10 items, sorted by engagement desc", async () => {
    const child = new FakeChild();
    const spawnFn = spawnFnFor(child);

    const manyItems = Array.from({ length: 15 }, (_, i) =>
      item({
        item_id: String(i),
        title: `item-${i}`,
        url: `https://x/${i}`,
        engagement: { score: i }, // 0..14
      }),
    );

    const promise = runLast30Days("topic", {}, {}, spawnFn);
    finish(child, reportJson({ hackernews: manyItems }));
    const report = await promise;

    expect(report.topic).toBe("claude code");
    expect(report.rangeFrom).toBe("2026-05-13");
    expect(report.rangeTo).toBe("2026-06-12");
    expect(report.errorsBySource).toEqual({ x: "x search returned 403" });
    expect(report.warnings).toEqual(["Instagram bonus source silent"]);

    const hn = report.itemsBySource.hackernews!;
    expect(hn).toHaveLength(10);
    expect(hn[0]!.title).toBe("item-14"); // highest engagement first
    expect(hn[9]!.title).toBe("item-5");
  });

  it("maps source item fields (author, published_at, snippet, engagement)", async () => {
    const child = new FakeChild();
    const spawnFn = spawnFnFor(child);

    const promise = runLast30Days("topic", {}, {}, spawnFn);
    finish(
      child,
      reportJson({
        reddit: [
          item({
            title: "Reddit post",
            url: "https://reddit.com/r/x/1",
            author: "jane",
            published_at: "2026-06-10",
            snippet: "a snippet",
            engagement: { score: 582, num_comments: 82 },
          }),
        ],
      }),
    );
    const report = await promise;

    const [first] = report.itemsBySource.reddit!;
    expect(first).toEqual({
      title: "Reddit post",
      url: "https://reddit.com/r/x/1",
      snippet: "a snippet",
      author: "jane",
      publishedAt: "2026-06-10",
      engagement: { score: 582, num_comments: 82 },
    });
  });

  it("rejects with the stderr tail on a nonzero exit code", async () => {
    const child = new FakeChild();
    const spawnFn = spawnFnFor(child);

    const promise = runLast30Days("topic", {}, {}, spawnFn);
    finish(child, "", 1, "line1\nline2\nfatal: boom");

    await expect(promise).rejects.toThrow(/fatal: boom/);
  });

  it("rejects with a parse error on garbage stdout", async () => {
    const child = new FakeChild();
    const spawnFn = spawnFnFor(child);

    const promise = runLast30Days("topic", {}, {}, spawnFn);
    finish(child, "not json", 0);

    await expect(promise).rejects.toThrow();
  });

  it("kills the child and rejects after the timeout elapses", async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const spawnFn = spawnFnFor(child);

    const promise = runLast30Days("topic", {}, {}, spawnFn);
    const assertion = expect(promise).rejects.toThrow(/timed out/);

    await vi.advanceTimersByTimeAsync(240_000);
    await assertion;

    expect(child.kill).toHaveBeenCalled();
  });
});
