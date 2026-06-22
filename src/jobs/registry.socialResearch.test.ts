import { describe, it, expect, vi } from "vitest";
import { createDb } from "@/db/client";
import { parseConfig } from "@/discovery/config";
import type { DecodeConfig } from "@/discovery/config";
import type { Connector } from "@/discovery/types";

const runDiscovery = vi.fn().mockResolvedValue(undefined);
vi.mock("@/discovery/runDiscovery", () => ({ runDiscovery }));

const { buildRegistry } = await import("./registry");

describe("social-research job (default wiring)", () => {
  it("defaults to createLast30DaysConnector() with an extended per-source timeout", async () => {
    runDiscovery.mockClear();
    const db = createDb(":memory:");
    const registry = buildRegistry();
    const config = parseConfig({});

    await registry["social-research"].run({}, { db, config, env: {} });

    expect(runDiscovery).toHaveBeenCalledTimes(1);
    const [, calledConfig, opts] = runDiscovery.mock.calls[0] as [
      unknown,
      DecodeConfig,
      { connectors: Connector[] },
    ];
    expect(calledConfig.robustness.perSourceTimeoutMs).toBeGreaterThanOrEqual(240_000);
    expect(opts.connectors).toHaveLength(1);
    expect(opts.connectors[0]?.key).toBe("last30days");
  });
});
