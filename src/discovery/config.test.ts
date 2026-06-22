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
import { DEFAULT_SOURCES as PROPERTY_DEFAULT_SOURCES } from "@/property/sources";
import { DEFAULT_RESEARCH_CONFIG, DEFAULT_RANK_WEIGHTS } from "./research";

describe("parseConfig", () => {
  it("fills defaults from an empty object", () => {
    const c = parseConfig({});
    expect(c.businessName).toBe("My Business");
    expect(c.keepThreshold).toBe(0.35);
    expect(c.topN).toBe(3);
    expect(c.minClusterSize).toBe(1);
    expect(c.clusterLanes).toEqual({});
    expect(c.sources).toEqual(DEFAULT_SOURCES);
  });

  it("fills trend-imitation defaults and applies overrides", () => {
    expect(parseConfig({}).trendImitation).toEqual({
      topics: [],
      provider: "higgsfield",
      replicate: {
        imageModel: "black-forest-labs/flux-schnell",
        videoModel: "minimax/video-01",
        videoImageKey: "first_frame_image",
        infographicModel: "google/nano-banana-pro",
      },
      assetStyle: "standard",
      sourceMode: "generate",
      captionOverlay: false,
      muapi: { imageModel: "flux-schnell", videoModel: "seedance-2" },
      video: { aspectRatio: "9:16", durationSec: 8, model: "seedance_2_0", endFrame: false },
      coverVariants: 1,
      music: { enabled: true, provider: "youtube_audio_library" },
      mediaHost: "none",
      viralityThreshold: 70,
      scoreVirality: false,
      viralityScorer: "higgsfield",
      ideaThreshold: 60,
      briefVariants: 1,
      visionEnrichment: false,
      saveToDraft: true,
      brand: {
        handle: "",
        name: "",
        description: "",
        voice: "",
        audience: "",
        signupUrl: "",
        ctaPrimary: "",
        ctaSecondary: "",
        contentPillars: [],
      },
    });

    const c2 = parseConfig({
      trend_imitation: {
        topics: ["productivity"],
        provider: "muapi",
        replicate: { video_model: "owner/cool-model:v1", video_image_key: "image", video_end_image_key: "last_frame_image" },
        muapi: { video_model: "kling-v3-std" },
        video: { aspect_ratio: "1:1", duration_sec: 12, end_frame: true },
        cover_variants: 3,
        music: { enabled: false },
        virality_threshold: 60,
        save_to_draft: false,
        brand: {
          handle: "@frcrbank",
          content_pillars: ["MRI physics", "CT physics & reconstruction"],
          cta_primary: "Follow + save",
        },
      },
    });
    expect(c2.trendImitation.brand.handle).toBe("@frcrbank");
    expect(c2.trendImitation.brand.contentPillars).toEqual([
      "MRI physics",
      "CT physics & reconstruction",
    ]);
    expect(c2.trendImitation.brand.ctaPrimary).toBe("Follow + save");
    expect(c2.trendImitation.topics).toEqual(["productivity"]);
    expect(c2.trendImitation.provider).toBe("muapi");
    expect(c2.trendImitation.replicate.videoModel).toBe("owner/cool-model:v1");
    expect(c2.trendImitation.replicate.videoImageKey).toBe("image");
    expect(c2.trendImitation.replicate.videoEndImageKey).toBe("last_frame_image");
    expect(c2.trendImitation.replicate.imageModel).toBe("black-forest-labs/flux-schnell");
    expect(c2.trendImitation.muapi.videoModel).toBe("kling-v3-std");
    expect(c2.trendImitation.muapi.imageModel).toBe("flux-schnell");
    expect(c2.trendImitation.video).toEqual({ aspectRatio: "1:1", durationSec: 12, model: "seedance_2_0", endFrame: true });
    expect(c2.trendImitation.coverVariants).toBe(3);
    expect(c2.trendImitation.music.enabled).toBe(false);
    expect(c2.trendImitation.viralityThreshold).toBe(60);
    expect(c2.trendImitation.saveToDraft).toBe(false);
  });

  it("reads observe and decide blocks", () => {
    const c = parseConfig({
      observe: { min_cluster_size: 3 },
      decide: { cluster_lanes: { radiology: "product" } },
    });
    expect(c.minClusterSize).toBe(3);
    expect(c.clusterLanes).toEqual({ radiology: "product" });
  });

  it("defaults the operator profile and monetization", () => {
    const c = parseConfig({});
    expect(c.profile.weeklyHours).toBe(10);
    expect(c.profile.risk).toBe("medium");
    expect(c.profile.voice).toBe("");
    expect(c.monetization).toEqual(["newsletter", "thread", "file"]);
    expect(c.qualityThreshold).toBe(3.5);
  });

  it("reads the profile block", () => {
    const c = parseConfig({
      profile: {
        goals: ["replace income"],
        weekly_hours: 20,
        skills: ["radiology", "writing"],
        risk: "high",
        monetization_target: "$5k/mo",
        audience: "radiology trainees",
        voice: "calm and witty",
      },
      monetization: ["download"],
      quality: { threshold: 4 },
    });
    expect(c.profile.weeklyHours).toBe(20);
    expect(c.profile.goals).toEqual(["replace income"]);
    expect(c.profile.risk).toBe("high");
    expect(c.profile.voice).toBe("calm and witty");
    expect(c.monetization).toEqual(["download"]);
    expect(c.qualityThreshold).toBe(4);
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

describe("robustness", () => {
  it("defaults per_source_timeout_ms, max_parallel_sources, breaker, and rate limits", () => {
    const c = parseConfig({});
    expect(c.robustness.perSourceTimeoutMs).toBe(20_000);
    expect(c.robustness.maxParallelSources).toBe(6);
    expect(c.robustness.breaker).toEqual({ failureThreshold: 3, cooldownMs: 60 * 60_000 });
    expect(c.robustness.rateLimits.default).toEqual({ rps: 1, concurrency: 2 });
    expect(c.robustness.rateLimits["api.github.com"]).toEqual({ rps: 2, concurrency: 4 });
    expect(c.robustness.rateLimits["nominatim.openstreetmap.org"]).toEqual({
      rps: 1,
      concurrency: 1,
    });
  });

  it("reads overrides from the robustness block", () => {
    const c = parseConfig({
      robustness: {
        per_source_timeout_ms: 5000,
        max_parallel_sources: 2,
        breaker: { failure_threshold: 5, cooldown_minutes: 10 },
        rate_limits: {
          "api.github.com": { rps: 10 },
          "example.com": { rps: 3, concurrency: 9 },
        },
      },
    });
    expect(c.robustness.perSourceTimeoutMs).toBe(5000);
    expect(c.robustness.maxParallelSources).toBe(2);
    expect(c.robustness.breaker).toEqual({ failureThreshold: 5, cooldownMs: 10 * 60_000 });
    // partial override keeps the existing concurrency for that domain
    expect(c.robustness.rateLimits["api.github.com"]).toEqual({ rps: 10, concurrency: 4 });
    // new domain not in defaults
    expect(c.robustness.rateLimits["example.com"]).toEqual({ rps: 3, concurrency: 9 });
    // untouched defaults survive
    expect(c.robustness.rateLimits.default).toEqual({ rps: 1, concurrency: 2 });
  });
});

describe("property config", () => {
  it("defaults sources/extraction/geocode", () => {
    const c = parseConfig({});
    expect(c.property.sources).toEqual(PROPERTY_DEFAULT_SOURCES);
    expect(c.property.extraction).toEqual({ llmRepair: true, llmMaxPagesPerRun: 25 });
    expect(c.property.geocode.providers).toEqual(["nominatim", "postcode-centroid"]);
  });

  it("reads overrides from the property block", () => {
    const customSources = [
      {
        key: "x",
        name: "X",
        sitemapUrl: "https://x/sitemap.xml",
        include: ["/a/"],
        enabled: true,
      },
    ];
    const c = parseConfig({
      property: {
        sources: customSources,
        extraction: { llm_repair: false, llm_max_pages_per_run: 5 },
        geocode: { providers: ["postcode-centroid"] },
      },
    });
    expect(c.property.sources).toEqual(customSources);
    expect(c.property.extraction).toEqual({ llmRepair: false, llmMaxPagesPerRun: 5 });
    expect(c.property.geocode.providers).toEqual(["postcode-centroid"]);
  });

  it("defaults watch thresholds for price drops, deals, and gone detection", () => {
    const c = parseConfig({});
    expect(c.property.watch).toEqual({ priceDropPct: 3, dealAlertPct: 15, goneAfterMisses: 3 });
  });

  it("reads watch overrides from the property block", () => {
    const c = parseConfig({
      property: { watch: { price_drop_pct: 5, deal_alert_pct: 20, gone_after_misses: 5 } },
    });
    expect(c.property.watch).toEqual({ priceDropPct: 5, dealAlertPct: 20, goneAfterMisses: 5 });
  });
});

describe("jobs config", () => {
  it("defaults schedules for discovery, property-scrape, and decode with 15% jitter", () => {
    const c = parseConfig({});
    expect(c.jobs.schedules.discovery).toEqual({ intervalMs: 60 * 60_000, jitterPct: 0.15 });
    expect(c.jobs.schedules["property-scrape"]).toEqual({
      intervalMs: 12 * 60 * 60_000,
      jitterPct: 0.15,
    });
    expect(c.jobs.schedules.decode).toEqual({ intervalMs: 4 * 60 * 60_000, jitterPct: 0.15 });
    expect(c.jobs.schedules["events-process"]).toEqual({ intervalMs: 5 * 60_000, jitterPct: 0.15 });
    expect(c.jobs.schedules["decision-lifecycle"]).toEqual({
      intervalMs: 24 * 60 * 60_000,
      jitterPct: 0.15,
    });
    expect(c.jobs.schedules.digest).toEqual({ intervalMs: 24 * 60 * 60_000, jitterPct: 0.15 });
  });

  it("reads schedule overrides from the jobs block, leaving other kinds at their defaults", () => {
    const c = parseConfig({
      jobs: {
        schedules: {
          discovery: { interval_minutes: 30, jitter_pct: 0.1 },
        },
      },
    });
    expect(c.jobs.schedules.discovery).toEqual({ intervalMs: 30 * 60_000, jitterPct: 0.1 });
    expect(c.jobs.schedules.decode).toEqual({ intervalMs: 4 * 60 * 60_000, jitterPct: 0.15 });
  });
});

describe("research config", () => {
  it("defaults expansion templates, max queries, per-author cap, and seed entities", () => {
    const c = parseConfig({});
    expect(c.research).toEqual(DEFAULT_RESEARCH_CONFIG);
    expect(c.seedEntities).toEqual([]);
  });

  it("reads overrides from the research block", () => {
    const c = parseConfig({
      research: {
        expansion_templates: ["{kw}", "{kw} guide"],
        max_queries_per_connector: 2,
        per_author_cap: 5,
        seed_entities: [
          { keyword: "web scraping", kind: "subreddit", value: "scrapy", weight: 2 },
        ],
      },
    });
    expect(c.research).toEqual({
      expansionTemplates: ["{kw}", "{kw} guide"],
      maxQueriesPerConnector: 2,
      perAuthorCap: 5,
      rankWeights: DEFAULT_RANK_WEIGHTS,
      halfLifeDays: DEFAULT_RESEARCH_CONFIG.halfLifeDays,
      topN: DEFAULT_RESEARCH_CONFIG.topN,
      semanticRerank: false,
      webResearch: false,
    });
    expect(c.seedEntities).toEqual([
      { keyword: "web scraping", kind: "subreddit", value: "scrapy", weight: 2 },
    ]);
  });

  it("reads rank overrides from the research.rank block", () => {
    const c = parseConfig({
      research: {
        rank: {
          weights: { relevance: 0.5, engagement: 0.3, recency: 0.2 },
          half_life_days: 14,
          top_n: 5,
        },
      },
    });
    expect(c.research.rankWeights).toEqual({ relevance: 0.5, engagement: 0.3, recency: 0.2 });
    expect(c.research.halfLifeDays).toBe(14);
    expect(c.research.topN).toBe(5);
  });
});

describe("publishing config", () => {
  it("defaults channelsByPlatform to an empty object", () => {
    const c = parseConfig({});
    expect(c.publishing.channelsByPlatform).toEqual({});
  });

  it("reads channel IDs per platform from the publishing block", () => {
    const c = parseConfig({
      publishing: {
        channels_by_platform: { x: "chan-x", instagram: "chan-ig" },
      },
    });
    expect(c.publishing.channelsByPlatform).toEqual({ x: "chan-x", instagram: "chan-ig" });
  });
});

describe("notify config", () => {
  it("defaults to the console channel and a severity map for known event types", () => {
    const c = parseConfig({});
    expect(c.notify.channels).toEqual(["console"]);
    expect(c.notify.events["listing.deal"]).toBe("high");
    expect(c.notify.events["listing.price_drop"]).toBe("medium");
    expect(c.notify.events["decode.insight_created"]).toBe("low");
    expect(c.notify.events["decode.execution_ready"]).toBe("medium");
    expect(c.notify.events["discovery.run_failed"]).toBe("high");
    expect(c.notify.events["source.breaker_opened"]).toBe("medium");
  });

  it("merges channel + event overrides over the defaults", () => {
    const c = parseConfig({
      notify: { channels: ["console", "ntfy"], events: { "listing.deal": "medium" } },
    });
    expect(c.notify.channels).toEqual(["console", "ntfy"]);
    expect(c.notify.events["listing.deal"]).toBe("medium");
    expect(c.notify.events["discovery.run_failed"]).toBe("high");
  });
});

describe("digest config", () => {
  it("defaults to 07:00 UTC with deals/insights/decisions/health sections", () => {
    const c = parseConfig({});
    expect(c.digest).toEqual({
      hourUtc: 7,
      sections: ["deals", "insights", "decisions", "health"],
    });
  });

  it("reads hour_utc + sections overrides", () => {
    const c = parseConfig({ digest: { hour_utc: 9, sections: ["deals"] } });
    expect(c.digest).toEqual({ hourUtc: 9, sections: ["deals"] });
  });
});

describe("decisions config", () => {
  it("defaults ttl_days to 14", () => {
    expect(parseConfig({}).decisions).toEqual({ ttlDays: 14 });
  });

  it("reads a ttl_days override", () => {
    expect(parseConfig({ decisions: { ttl_days: 30 } }).decisions).toEqual({ ttlDays: 30 });
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
