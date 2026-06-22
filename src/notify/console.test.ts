import { describe, it, expect } from "vitest";
import { createConsoleNotifier } from "./console";

describe("createConsoleNotifier", () => {
  it("is always configured", () => {
    const notifier = createConsoleNotifier();
    expect(notifier.configured).toBe(true);
    expect(notifier.name).toBe("console");
  });

  it("logs the title and body", async () => {
    const lines: string[] = [];
    const notifier = createConsoleNotifier({ log: (line: string) => lines.push(line) });

    await notifier.send({ title: "Deal alert", body: "5 Foo Street is 20% under fair value" });

    expect(lines).toEqual([
      "[notify] Deal alert\n5 Foo Street is 20% under fair value",
    ]);
  });

  it("includes the url when present", async () => {
    const lines: string[] = [];
    const notifier = createConsoleNotifier({ log: (line: string) => lines.push(line) });

    await notifier.send({
      title: "Deal alert",
      body: "5 Foo Street is 20% under fair value",
      url: "https://example.com/listing/5-foo-street",
    });

    expect(lines).toEqual([
      "[notify] Deal alert\n5 Foo Street is 20% under fair value\nhttps://example.com/listing/5-foo-street",
    ]);
  });
});
