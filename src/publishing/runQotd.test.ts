import { describe, it, expect, beforeEach, vi } from "vitest";
import sharp from "sharp";
import { createDb, type DB } from "@/db/client";
import { runQotdCarousel } from "./runQotd";
import { insertQuestions, type ExamQuestionInput } from "./examQuestions";
import { generatedVideos, examQuestions } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { DecodeConfig } from "@/discovery/config";
import type { BufferClient, ComposeInput } from "./bufferClient";

function brandConfig() {
  return {
    handle: "@frcrbank",
    name: "FRCRBank",
    description: "FRCR bank",
    voice: "evidence-based",
    audience: "ST1 trainees",
    signupUrl: "https://frcrbank.com",
    ctaPrimary: "Follow @frcrbank · Save this",
    ctaSecondary: "Explanations → link in bio",
    contentPillars: ["MRI physics"],
  };
}

function config(): DecodeConfig {
  return {
    trendImitation: { mediaHost: "none", brand: brandConfig() },
    publishing: { channelsByPlatform: { instagram: "chan-frcrbank" } },
  } as unknown as DecodeConfig;
}

function stubBuffer(captured: ComposeInput[]): BufferClient {
  return {
    configured: true,
    createPost: vi.fn(async (input: ComposeInput) => {
      captured.push(input);
      return { id: "post-1", status: "draft" } as never;
    }),
  } as unknown as BufferClient;
}

const sample = (statement: string): ExamQuestionInput => ({
  subtopic: "MRI physics",
  statement,
  correctAnswer: true,
  explanation: "Because magnetisation recovers along the longitudinal axis.",
  difficulty: "Easy",
  source: "question_bank:x",
});

describe("runQotdCarousel", () => {
  let db: DB;
  beforeEach(() => {
    db = createDb(":memory:");
    insertQuestions(
      db,
      [sample("s1"), sample("s2"), sample("s3"), sample("s4"), sample("s5"), sample("s6")],
      "2026-06-20T00:00:00Z",
    );
  });

  it("publishes a carousel DRAFT with one image per slide and records it", async () => {
    const captured: ComposeInput[] = [];
    const persisted: string[] = [];
    const res = await runQotdCarousel(db, config(), {}, {
      count: 5,
      deps: {
        buffer: stubBuffer(captured),
        mediaHost: { persist: async (p) => { const u = `https://r2/${persisted.length}.png`; persisted.push(p); return u; } },
        now: () => "2026-06-22T00:00:00Z",
      },
    });

    expect(res.status).toBe("draft");
    expect(res.slideCount).toBe(7); // cover + 5 statements + cta
    expect(res.bufferPostId).toBe("post-1");

    const post = captured[0]!;
    expect(post.instagramType).toBe("post");
    expect(post.saveToDraft).toBe(true);
    expect(post.imageUrls).toHaveLength(7);
    expect(post.channelId).toBe("chan-frcrbank");
    expect(post.text).toContain("#frcr");

    const row = db.select().from(generatedVideos).where(eq(generatedVideos.id, res.videoId)).get();
    expect(row?.format).toBe("qotd-carousel");
    expect(row?.slideUrls).toHaveLength(7);
    expect(row?.status).toBe("draft");
  });

  it("advances the rotation by marking the used statements", async () => {
    const captured: ComposeInput[] = [];
    await runQotdCarousel(db, config(), {}, {
      count: 5,
      deps: {
        buffer: stubBuffer(captured),
        mediaHost: { persist: async (p) => p },
        now: () => "2026-06-22T00:00:00Z",
      },
    });
    const used = db.select().from(examQuestions).where(eq(examQuestions.usedAt, "2026-06-22T00:00:00Z")).all();
    expect(used).toHaveLength(5);
  });

  it("dry-run renders previews without publishing, recording, or advancing rotation", async () => {
    const create = vi.fn();
    const res = await runQotdCarousel(db, config(), {}, {
      count: 5,
      dryRun: true,
      deps: { buffer: { configured: true, createPost: create } as unknown as BufferClient, mediaHost: { persist: async (p) => p } },
    });
    expect(res.dryRun).toBe(true);
    expect(res.slideCount).toBe(7);
    expect(create).not.toHaveBeenCalled();
    expect(db.select().from(generatedVideos).all()).toHaveLength(0);
    expect(db.select().from(examQuestions).where(eq(examQuestions.usedAt, "")).all()).toHaveLength(0);
  });

  it("preview mode hosts viewable URLs but does not publish, record, or advance rotation", async () => {
    const create = vi.fn();
    const res = await runQotdCarousel(db, config(), {}, {
      count: 5,
      publish: false,
      deps: {
        buffer: { configured: true, createPost: create } as unknown as BufferClient,
        mediaHost: { persist: async (p) => `https://r2/${p.split("/").pop()}` },
      },
    });
    expect(res.status).toBe("generated");
    expect(res.slideUrls.every((u) => u.startsWith("https://r2/"))).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(db.select().from(generatedVideos).all()).toHaveLength(0);
    expect(db.select().from(examQuestions).where(eq(examQuestions.usedAt, "2026-06-22T00:00:00Z")).all()).toHaveLength(0);
  });

  it("resolves the brand background once and reports it via the background stage", async () => {
    const bg = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: "#efe7d8" } })
      .png()
      .toBuffer();
    const getBackground = vi.fn(async () => bg);
    const stages: Array<{ stage: string; data: unknown }> = [];
    const captured: ComposeInput[] = [];

    await runQotdCarousel(db, config(), {}, {
      count: 5,
      deps: {
        buffer: stubBuffer(captured),
        mediaHost: { persist: async (p) => p },
        now: () => "2026-06-22T00:00:00Z",
        getBackground,
        onStage: (stage, data) => stages.push({ stage, data }),
      },
    });

    expect(getBackground).toHaveBeenCalledTimes(1);
    expect(stages.find((s) => s.stage === "background")?.data).toEqual({ applied: true });
  });

  it("falls back to the gradient (no crash) when the background resolver yields null", async () => {
    const captured: ComposeInput[] = [];
    const res = await runQotdCarousel(db, config(), {}, {
      count: 5,
      deps: {
        buffer: stubBuffer(captured),
        mediaHost: { persist: async (p) => p },
        now: () => "2026-06-22T00:00:00Z",
        getBackground: async () => null,
      },
    });
    expect(res.slideCount).toBe(7);
  });

  it("throws a helpful error when no questions are imported", async () => {
    const empty = createDb(":memory:");
    await expect(runQotdCarousel(empty, config(), {}, { deps: { mediaHost: { persist: async (p) => p } } })).rejects.toThrow(
      /Import first/,
    );
  });
});
