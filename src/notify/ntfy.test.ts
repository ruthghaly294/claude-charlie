import { describe, it, expect, vi } from "vitest";
import { createNtfyNotifier } from "./ntfy";

describe("createNtfyNotifier", () => {
  it("is unconfigured when NTFY_TOPIC is not set", () => {
    const notifier = createNtfyNotifier({});
    expect(notifier.configured).toBe(false);
    expect(notifier.name).toBe("ntfy");
  });

  it("is configured when NTFY_TOPIC is set", () => {
    const notifier = createNtfyNotifier({ NTFY_TOPIC: "my-topic" });
    expect(notifier.configured).toBe(true);
  });

  it("posts the message body to https://ntfy.sh/<topic> with title/priority/click headers", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("ok", { status: 200 });
    });

    const notifier = createNtfyNotifier(
      { NTFY_TOPIC: "my-topic" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    await notifier.send({
      title: "Deal alert",
      body: "5 Foo Street is 20% under fair value",
      url: "https://example.com/listing/5-foo-street",
      priority: "high",
    });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe("https://ntfy.sh/my-topic");
    expect(call!.init.method).toBe("POST");
    expect(call!.init.body).toBe("5 Foo Street is 20% under fair value");
    const headers = call!.init.headers as Record<string, string>;
    expect(headers["Title"]).toBe("Deal alert");
    expect(headers["Priority"]).toBe("high");
    expect(headers["Click"]).toBe("https://example.com/listing/5-foo-street");
  });

  it("supports a custom base url", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const notifier = createNtfyNotifier(
      { NTFY_TOPIC: "my-topic" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "https://ntfy.example.com" },
    );

    await notifier.send({ title: "t", body: "b" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://ntfy.example.com/my-topic",
      expect.anything(),
    );
  });

  it("throws when not configured", async () => {
    const notifier = createNtfyNotifier({});
    await expect(notifier.send({ title: "t", body: "b" })).rejects.toThrow();
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () => new Response("err", { status: 500 }));
    const notifier = createNtfyNotifier(
      { NTFY_TOPIC: "my-topic" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, retries: 0 },
    );

    await expect(notifier.send({ title: "t", body: "b" })).rejects.toThrow();
  });
});
