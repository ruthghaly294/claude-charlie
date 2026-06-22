import { describe, it, expect } from "vitest";
import { buildNotifiers } from "./build";

describe("buildNotifiers", () => {
  it("builds a notifier for each configured channel", () => {
    const notifiers = buildNotifiers({ channels: ["console"], events: {} }, {});
    expect(notifiers.map((n) => n.name)).toEqual(["console"]);
    expect(notifiers[0]!.configured).toBe(true);
  });

  it("marks the ntfy notifier unconfigured without NTFY_TOPIC, configured with it", () => {
    const withoutTopic = buildNotifiers({ channels: ["console", "ntfy"], events: {} }, {});
    expect(withoutTopic.map((n) => n.name)).toEqual(["console", "ntfy"]);
    expect(withoutTopic.find((n) => n.name === "ntfy")!.configured).toBe(false);

    const withTopic = buildNotifiers(
      { channels: ["console", "ntfy"], events: {} },
      { NTFY_TOPIC: "my-topic" },
    );
    expect(withTopic.find((n) => n.name === "ntfy")!.configured).toBe(true);
  });

  it("ignores unknown channel names", () => {
    const notifiers = buildNotifiers({ channels: ["console", "carrier-pigeon"], events: {} }, {});
    expect(notifiers.map((n) => n.name)).toEqual(["console"]);
  });
});
