import { randomUUID } from "node:crypto";
import { writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DB } from "@/db/client";
import type { DecodeConfig } from "@/discovery/config";
import { generatedVideos } from "@/db/schema";
import { pickNextSet, markUsed } from "./examQuestions";
import { buildQotdCarousel, composeQotdPostText } from "./qotdCarousel";
import { renderCarouselPngs } from "./qotdSlides";
import { getMediaHost, makeS3Uploader, r2ConfigFromEnv, type MediaHost } from "./mediaHost";
import { createBufferClient, type BufferClient } from "./bufferClient";
import { createReplicateClient } from "./replicateClient";
import { getBrandBackground, type R2BackgroundCache } from "./qotdBackground";
import { loadPromptOverrides } from "./prompts";

export type QotdStage = "questions" | "carousel" | "background" | "render" | "host" | "publish";

export type QotdDeps = {
  mediaHost: MediaHost;
  buffer: BufferClient;
  now: () => string;
  /** Resolve the shared on-brand watercolor background (null ⇒ render on the brand gradient). */
  getBackground: () => Promise<Buffer | null>;
  onStage?: (stage: QotdStage, data: unknown) => void;
};

export type QotdResult = {
  videoId: string;
  subtopic: string;
  slideCount: number;
  slideUrls: string[];
  caption: string;
  status: "generated" | "draft";
  bufferPostId: string | null;
  questionIds: string[];
  /** Verbatim statement texts used this run — the stable key for cross-import used-tracking. */
  statements: string[];
  dryRun: boolean;
};

export type QotdOptions = {
  subtopic?: string;
  count?: number;
  /** Render + write preview PNGs locally; no R2 upload, no Buffer post, no DB write, no rotation advance. */
  dryRun?: boolean;
  /** When false, render + host to R2 and return viewable URLs but skip Buffer/DB/rotation (browser preview). Default true. */
  publish?: boolean;
  /** Composite slides over the generated on-brand watercolor background. Default true (falls back to gradient if no image model is configured). */
  background?: boolean;
  deps?: Partial<QotdDeps>;
};

/**
 * Run the standardized Question-of-the-Day carousel: pick a coherent set of
 * verified statements, render branded slides (exact text), host them durably,
 * and create a Buffer DRAFT for human review. The medical content is verbatim —
 * never generated — and the post NEVER auto-publishes (saveToDraft is forced).
 */
export async function runQotdCarousel(
  db: DB,
  config: DecodeConfig,
  env: Record<string, string | undefined>,
  opts: QotdOptions = {},
): Promise<QotdResult> {
  const ti = config.trendImitation;
  const count = opts.count ?? 5;
  const dryRun = Boolean(opts.dryRun);
  const useBackground = opts.background !== false;
  const deps: QotdDeps = {
    mediaHost: opts.deps?.mediaHost ?? getMediaHost(ti.mediaHost),
    buffer: opts.deps?.buffer ?? createBufferClient(env),
    now: opts.deps?.now ?? (() => new Date().toISOString()),
    getBackground:
      opts.deps?.getBackground ??
      (async () => {
        if (!useBackground) return null;
        // Nano Banana Pro (Replicate) renders the brand background at the slide's
        // 4:5 portrait ratio; generated once then reused across posts. Cache in R2
        // when configured (durable across serverless cold starts), else local disk.
        const generator = createReplicateClient(env, {
          imageModel: ti.replicate?.infographicModel,
          imageAspectRatio: "4:5",
        });
        const r2cfg = r2ConfigFromEnv(env);
        const r2: R2BackgroundCache | undefined = r2cfg
          ? { publicBaseUrl: r2cfg.publicBaseUrl, upload: makeS3Uploader(r2cfg) }
          : undefined;
        return getBrandBackground({ generator, r2, overrides: loadPromptOverrides(db) });
      }),
    onStage: opts.deps?.onStage,
  };
  const stage = (s: QotdStage, d: unknown) => deps.onStage?.(s, d);

  const questions = pickNextSet(db, count, opts.subtopic);
  if (questions.length === 0) {
    throw new Error(
      `No verified questions${opts.subtopic ? ` for "${opts.subtopic}"` : ""}. ` +
        `Import first: npm run import-questions -- --supabase`,
    );
  }
  stage("questions", { subtopic: questions[0]!.subtopic, count: questions.length });

  const carousel = buildQotdCarousel(questions, ti.brand);
  stage("carousel", { subtopic: carousel.subtopic, slides: carousel.slides.map((s) => s.role), caption: carousel.caption });

  const background = await deps.getBackground();
  stage("background", { applied: Boolean(background) });

  const pngs = await renderCarouselPngs(carousel, background);
  stage("render", { slides: pngs.length });

  const slideUrls: string[] = [];
  if (dryRun) {
    const dir = join(process.cwd(), "data", "qotd-preview");
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < pngs.length; i++) {
      const p = join(dir, `slide-${i + 1}.png`);
      await writeFile(p, pngs[i]!);
      slideUrls.push(p);
    }
    stage("host", { slideUrls, dryRun: true });
    return {
      videoId: "",
      subtopic: carousel.subtopic,
      slideCount: pngs.length,
      slideUrls,
      caption: composeQotdPostText(carousel),
      status: "generated",
      bufferPostId: null,
      questionIds: questions.map((q) => q.id),
      statements: questions.map((q) => q.statement),
      dryRun: true,
    };
  }

  const dir = await mkdtemp(join(tmpdir(), "qotd-"));
  for (let i = 0; i < pngs.length; i++) {
    const p = join(dir, `slide-${i + 1}.png`);
    await writeFile(p, pngs[i]!);
    slideUrls.push(await deps.mediaHost.persist(p));
  }
  stage("host", { slideUrls });

  const postText = composeQotdPostText(carousel);
  const publish = opts.publish !== false;

  // Browser-preview path: viewable URLs, but nothing published/recorded and no
  // rotation advance. Any slide the host couldn't make publicly reachable (e.g.
  // the "none"/passthrough host returns a local temp path) is inlined as a base64
  // data URL so the <img> tags render in the browser without R2 configured.
  if (!publish) {
    const viewable = slideUrls.map((u, i) =>
      /^https?:\/\//.test(u) ? u : `data:image/png;base64,${pngs[i]!.toString("base64")}`,
    );
    return {
      videoId: "",
      subtopic: carousel.subtopic,
      slideCount: pngs.length,
      slideUrls: viewable,
      caption: postText,
      status: "generated",
      bufferPostId: null,
      questionIds: questions.map((q) => q.id),
      statements: questions.map((q) => q.statement),
      dryRun: false,
    };
  }

  const channelId = config.publishing.channelsByPlatform.instagram;
  let bufferPostId: string | null = null;
  let status: QotdResult["status"] = "generated";

  if (deps.buffer.configured && channelId) {
    const post = await deps.buffer.createPost({
      channelId,
      text: postText,
      imageUrls: slideUrls,
      instagramType: "post", // 2+ images on a post = Instagram carousel (there is no "carousel" type)
      saveToDraft: true, // mandatory human review — medical content never auto-publishes
    });
    bufferPostId = post.id;
    status = "draft";
  }

  const videoId = randomUUID();
  db.insert(generatedVideos)
    .values({
      id: videoId,
      topic: carousel.subtopic,
      brief: { caption: carousel.caption, hashtags: carousel.hashtags } as unknown as Record<string, unknown>,
      exemplars: [],
      soundTrackUrl: null,
      soundMood: null,
      coverImageUrl: slideUrls[0] ?? null,
      videoUrl: "",
      slideUrls,
      format: "qotd-carousel",
      viralityScore: null,
      viralityReportUrl: null,
      status,
      bufferPostId,
      createdAt: deps.now(),
    })
    .run();

  markUsed(db, questions.map((q) => q.id), deps.now());
  stage("publish", { status, bufferPostId });

  return {
    videoId,
    subtopic: carousel.subtopic,
    slideCount: pngs.length,
    slideUrls,
    caption: postText,
    status,
    bufferPostId,
    questionIds: questions.map((q) => q.id),
    statements: questions.map((q) => q.statement),
    dryRun: false,
  };
}
