import { describe, it, expect } from "vitest";
import { notifyAll, type Notifier } from "./notifier";

function fakeNotifier(name: string, configured: boolean, impl?: () => Promise<void>): Notifier {
  return {
    name,
    configured,
    send: impl ?? (async () => {}),
  };
}

describe("notifyAll", () => {
  it("sends only to configured notifiers and reports per-notifier results", async () => {
    const sent: string[] = [];
    const a = fakeNotifier("a", true, async () => {
      sent.push("a");
    });
    const b = fakeNotifier("b", false, async () => {
      sent.push("b");
    });

    const results = await notifyAll([a, b], { title: "t", body: "b" });

    expect(sent).toEqual(["a"]);
    expect(results).toEqual([{ notifier: "a", ok: true }]);
  });

  it("isolates a throwing notifier without blocking others", async () => {
    const sent: string[] = [];
    const a = fakeNotifier("a", true, async () => {
      throw new Error("boom");
    });
    const b = fakeNotifier("b", true, async () => {
      sent.push("b");
    });

    const results = await notifyAll([a, b], { title: "t", body: "b" });

    expect(sent).toEqual(["b"]);
    expect(results).toEqual([
      { notifier: "a", ok: false, error: "boom" },
      { notifier: "b", ok: true },
    ]);
  });
});
