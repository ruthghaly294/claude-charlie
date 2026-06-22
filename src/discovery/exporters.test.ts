import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@/db/client";
import { notifications, type Product } from "@/db/schema";
import type { Notifier, NotifyMessage } from "@/notify/notifier";
import { exportProductToFile, exportAll, createNotifyExporter } from "./exporters";

const product = (over: Partial<Product> = {}): Product => ({
  id: "product:exec:1:newsletter",
  executionId: "exec:1",
  format: "newsletter",
  title: "The Smart-Money Tracker",
  body: "# Issue 1\n\nContent here.",
  price: 0,
  status: "draft",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("exportProductToFile", () => {
  it("writes a markdown file with frontmatter and the body", () => {
    const dir = mkdtempSync(join(tmpdir(), "exp-"));
    const path = exportProductToFile(product(), dir);
    expect(existsSync(path)).toBe(true);
    expect(path).toContain("newsletter-the-smart-money-tracker.md");
    const text = readFileSync(path, "utf8");
    expect(text).toContain("format: newsletter");
    expect(text).toContain("Content here.");
  });
});

describe("exportAll", () => {
  it("exports every product", () => {
    const dir = mkdtempSync(join(tmpdir(), "exp-"));
    const paths = exportAll(
      [product(), product({ id: "p2", format: "thread", title: "Thread" })],
      dir,
    );
    expect(paths).toHaveLength(2);
    expect(paths.every((p) => existsSync(p))).toBe(true);
  });
});

function fakeNotifier(name: string, configured: boolean): Notifier & { sent: NotifyMessage[] } {
  const sent: NotifyMessage[] = [];
  return {
    name,
    configured,
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

describe("createNotifyExporter", () => {
  it("is configured iff at least one notifier is configured", () => {
    const db = createDb(":memory:");
    expect(createNotifyExporter(db, []).configured).toBe(false);
    expect(createNotifyExporter(db, [fakeNotifier("console", false)]).configured).toBe(false);
    expect(createNotifyExporter(db, [fakeNotifier("console", true)]).configured).toBe(true);
  });

  it("sends the product via notify and records a notifications row", async () => {
    const db = createDb(":memory:");
    const notifier = fakeNotifier("console", true);
    const exporter = createNotifyExporter(db, [notifier]);

    const result = await exporter.export(product());

    expect(result).toEqual({ location: `notify:${product().id}` });
    expect(notifier.sent).toEqual([
      { title: "New newsletter: The Smart-Money Tracker", body: product().body },
    ]);

    const rows = db.select().from(notifications).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "console", status: "sent" });
  });
});
