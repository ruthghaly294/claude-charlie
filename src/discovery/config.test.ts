import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  parseConfig,
  loadConfig,
  sourceConfig,
  DEFAULT_SOURCES,
} from "./config";

describe("parseConfig", () => {
  it("fills defaults from an empty object", () => {
    const c = parseConfig({});
    expect(c.businessName).toBe("My Business");
    expect(c.keepThreshold).toBe(0.35);
    expect(c.topN).toBe(3);
    expect(c.sources).toEqual(DEFAULT_SOURCES);
  });

  it("expands ~ in the vault path", () => {
    const c = parseConfig({ vault: "~/second-brain" });
    expect(c.vault).toBe(join(homedir(), "second-brain"));
  });

  it("reads business, scoring and execute blocks", () => {
    const c = parseConfig({
      vault: "/v",
      business: {
        name: "FRCRBank",
        keywords: ["frcr"],
        competitors: ["https://c"],
      },
      scoring: { keep_threshold: 0.5 },
      execute: { top_n: 7 },
      sources: { rss: ["https://a"] },
    });
    expect(c.businessName).toBe("FRCRBank");
    expect(c.keywords).toEqual(["frcr"]);
    expect(c.competitors).toEqual(["https://c"]);
    expect(c.keepThreshold).toBe(0.5);
    expect(c.topN).toBe(7);
    expect(c.sources.rss).toEqual(["https://a"]);
  });

  it("tolerates malformed input by falling back to defaults", () => {
    expect(parseConfig("nonsense").businessName).toBe("My Business");
    expect(parseConfig(null).topN).toBe(3);
  });
});

describe("loadConfig", () => {
  it("returns defaults when the file is missing", () => {
    expect(loadConfig("/no/such/decode.config.yml").businessName).toBe(
      "My Business",
    );
  });

  it("parses a real YAML file", () => {
    const dir = mkdtempSync(join(tmpdir(), "decode-"));
    const p = join(dir, "decode.config.yml");
    writeFileSync(
      p,
      `vault: /tmp/v\nbusiness:\n  name: Acme\n  keywords: [radiology, frcr]\nsources:\n  rss: ["https://feed"]\n`,
    );
    const c = loadConfig(p);
    expect(c.businessName).toBe("Acme");
    expect(c.keywords).toEqual(["radiology", "frcr"]);
    expect(c.sources.rss).toEqual(["https://feed"]);
  });
});

describe("sourceConfig", () => {
  it("returns the block for object sources", () => {
    const c = parseConfig({ sources: { reddit: { subreddits: ["x"] } } });
    expect(sourceConfig(c, "reddit")).toEqual({ subreddits: ["x"] });
  });
  it("returns {} for array or missing sources", () => {
    const c = parseConfig({ sources: { rss: ["a"] } });
    expect(sourceConfig(c, "rss")).toEqual({});
    expect(sourceConfig(c, "nope")).toEqual({});
  });
});
