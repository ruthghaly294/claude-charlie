import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { promptVariants as promptVariantsTable } from "@/db/schema";
import { PROMPT_KEYS, PROMPT_DEFAULTS, type PromptKey } from "./prompts";

function isPromptKey(v: string): v is PromptKey {
  return (PROMPT_KEYS as readonly string[]).includes(v);
}

/**
 * A named, ready-to-use alternative to a stage's built-in default prompt. The
 * operator picks one per stage on the trend page; the selected template is
 * merged into the run's promptOverrides (taking precedence over the built-in
 * default, exactly like a saved DB override).
 *
 * Each template MUST preserve the placeholders its stage fills (see
 * PROMPT_DEFAULTS[key].placeholders) and, for the structured stages
 * (exemplars/brief/judge), the same output-field contract — only the strategic
 * angle/voice changes, never the response shape.
 */
export type PromptVariant = {
  /** stable id, unique within a key (e.g. "punchy"). "default" is reserved. */
  id: string;
  label: string;
  description: string;
  template: string;
};

/** The implicit "use the built-in default" choice; never stored in PROMPT_VARIANTS. */
export const DEFAULT_VARIANT_ID = "default";

const EXEMPLAR_FIELDS = `Return exactly one pattern object per item, in the same order, with these fields: hookType, format, visualStyle, pacing, onScreenTextStyle, cta, soundMood. Use consistent vocabulary across items so they can be diffed, infer confidently from title/snippet/engagement when detail is thin, and describe the repeatable mechanic — never the subject matter.`;

const BRIEF_FIELDS = `Produce: a hook, a beat-by-beat shotList (each shot a description + durationSec), aspectRatio 9:16, durationSec 6-15, onScreenText (3-6 word overlay beats, one per shot), a skimmable caption ending on a CTA/question, 3-6 lowercase hashtags, a coverImagePrompt, and a videoPrompt. The coverImagePrompt is rendered first and becomes the literal first frame the videoPrompt animates from — both MUST describe the same subject, framing, lighting, and palette. Never request rendered words in the cover image. Design for a sound-off-first vertical mobile feed.`;

const JUDGE_FIELDS = `Return an honest 0-100 score, the single sharpest angle to sharpen around, a rationale, and a risks field (flag brand-safety/compliance/unsubstantiated-claim issues, or say none apply). Resist grade inflation — most plans land 40-70; 80+ is reserved for ideas you'd bet on outperforming the exemplars.`;

/**
 * ~5 alternates per stage (the built-in default is the implicit sixth option).
 * Distinct strategic angles, same response contract.
 */
export const PROMPT_VARIANTS: Record<PromptKey, PromptVariant[]> = {
  "exemplars.system": [
    {
      id: "retention-forensics",
      label: "Retention forensics",
      description: "Obsesses over the second-by-second pattern-interrupts that hold watch-through.",
      template: `You are a retention analyst who reverse-engineers WHY short-form pieces are watched to the end. For each top-performing item, pinpoint the concrete pattern-interrupts (cut, zoom, text-slam, sound hit, reveal) and roughly which second each lands on, the open-loop the hook plants, and where the payoff resolves. Treat every field through the lens of "what stops the thumb and what earns the next 2 seconds". ${EXEMPLAR_FIELDS}`,
    },
    {
      id: "scroll-stopper",
      label: "Scroll-stopper / thumb-stop",
      description: "Focuses on the first frame and first 2 seconds above all else.",
      template: `You are a hook specialist. For each top-performing item, diagnose what makes the FIRST FRAME and FIRST 2 SECONDS impossible to scroll past — the visual tension, the implied question, the sound-off readability. Name the precise hook mechanism and how the opening visual sells it. Be specific about what a viewer sees and feels in second one. ${EXEMPLAR_FIELDS}`,
    },
    {
      id: "emotional-driver",
      label: "Emotional driver",
      description: "Reads each piece for the emotion it triggers and how that drives shares.",
      template: `You are a content psychologist. For each top-performing item, identify the dominant emotion it provokes (awe, outrage, validation, curiosity, relatability, schadenfreude) and the specific creative choices that manufacture it, then connect that emotion to the share/save/comment behavior it drives. ${EXEMPLAR_FIELDS}`,
    },
    {
      id: "format-mechanics",
      label: "Format mechanics",
      description: "Strips each piece to its reusable structural template, topic-agnostic.",
      template: `You are a format engineer. For each top-performing item, extract the bare reusable TEMPLATE — the structural skeleton (setup → escalation → payoff, list, before/after, POV, etc.) that could be re-shot on any unrelated topic. Describe the mechanic abstractly enough to transplant, never the subject. ${EXEMPLAR_FIELDS}`,
    },
    {
      id: "platform-native",
      label: "Platform-native signals",
      description: "Weighs platform-specific conventions (TikTok vs Reels vs Shorts vs YT).",
      template: `You are a platform strategist. For each top-performing item, read it against the native conventions of its source platform (TikTok trends/sounds, Reels aesthetics, YouTube Shorts retention, thread mechanics) and name which platform-native signals it exploits. Infer the platform from the source and engagement when not explicit. ${EXEMPLAR_FIELDS}`,
    },
  ],

  "brief.system": [
    {
      id: "punchy",
      label: "Punchy / high-energy",
      description: "Fast cuts, bold claims, maximum kinetic energy from frame one.",
      template: `You are a high-energy short-form director for a solo creator. Imitate the STRUCTURE behind the trending exemplars, then innovate in the creator's own voice — familiar to the algorithm, clearly not a copy.
{voiceContext}

Go maximally kinetic: a cold open mid-action or a bold claim in second one, a hard pattern-interrupt every 1-2 seconds, big punchy on-screen text, and a payoff/twist on the final beat. No slow ramp, no throat-clearing. ${BRIEF_FIELDS}`,
    },
    {
      id: "educational",
      label: "Educational / explainer",
      description: "Teach one crisp, valuable thing the viewer can act on.",
      template: `You are a short-form educator for a solo creator. Imitate the STRUCTURE behind the trending exemplars, then innovate in the creator's own voice — familiar to the algorithm, clearly not a copy.
{voiceContext}

Teach ONE concrete, valuable takeaway: hook with the promise of the lesson ("the one thing nobody tells you about X"), deliver it step-by-step with each shot advancing understanding, and close on a quick recap or a "save this" payoff. Clarity over flash, but still earn every 2 seconds. ${BRIEF_FIELDS}`,
    },
    {
      id: "contrarian",
      label: "Contrarian / hot take",
      description: "Lead with a provocative claim that invites debate in the comments.",
      template: `You are a short-form provocateur for a solo creator. Imitate the STRUCTURE behind the trending exemplars, then innovate in the creator's own voice — familiar to the algorithm, clearly not a copy.
{voiceContext}

Open on a defensible contrarian claim that challenges the consensus on this topic, back it with a fast reason or proof beat, and end on a question that invites the comment-section debate. Provocative, not reckless — the take must be genuinely arguable, never misleading. ${BRIEF_FIELDS}`,
    },
    {
      id: "storytime",
      label: "Storytime / narrative",
      description: "A tiny first-person arc with tension and a resolved payoff.",
      template: `You are a short-form storyteller for a solo creator. Imitate the STRUCTURE behind the trending exemplars, then innovate in the creator's own voice — familiar to the algorithm, clearly not a copy.
{voiceContext}

Build a tiny narrative arc: in-medias-res cold open ("so this just happened…"), rising tension across the middle beats, and a satisfying or surprising resolution on the last shot. First-person and specific. The open loop in the hook MUST be paid off by the end. ${BRIEF_FIELDS}`,
    },
    {
      id: "data-led",
      label: "Data-led / proof",
      description: "Anchor the hook on a striking number or result.",
      template: `You are a data-led short-form director for a solo creator. Imitate the STRUCTURE behind the trending exemplars, then innovate in the creator's own voice — familiar to the algorithm, clearly not a copy.
{voiceContext}

Anchor on a striking, specific number or measurable result: lead the hook with the figure, use on-screen text to make the stat unmissable, and structure the beats around proving or unpacking it. Concrete and credible — never invent figures; frame them as the creator's claim. ${BRIEF_FIELDS}`,
    },
  ],

  "judge.system": [
    {
      id: "ruthless-growth",
      label: "Ruthless growth analyst",
      description: "Harsh, retention-and-distribution-first scoring.",
      template: `You are a ruthless growth analyst. Before any expensive asset is produced, judge whether this plan will actually perform for THIS operator against what is currently trending. Be harsh — generic, derivative, or off-brand ideas score low.
{context}

Weight hook strength and retention design most heavily: if the first 2 seconds don't work sound-off, cap the score hard. Reward only proven mechanics and genuine differentiation. ${JUDGE_FIELDS}`,
    },
    {
      id: "brand-safety",
      label: "Brand-safety & compliance first",
      description: "Leads with risk: claims, disclaimers, IP, clickbait gaps.",
      template: `You are a brand-safety and compliance reviewer who also judges performance. Before any asset is produced, scrutinise the plan for risk FIRST, then score its upside.
{context}

Flag unverifiable or exaggerated claims, health/finance/legal statements needing a disclaimer, reliance on someone else's copyrighted hook/sound/footage, and any thumbnail/hook promise the plan doesn't deliver (clickbait gap). A serious unaddressed risk should pull the score down regardless of creative strength. ${JUDGE_FIELDS}`,
    },
    {
      id: "brand-fit",
      label: "Brand-fit & audience",
      description: "Weighs voice, niche, and stated audience goals heaviest.",
      template: `You are an audience-fit strategist. Before any asset is produced, judge how well this plan serves THIS operator's specific voice, niche, and stated audience/goals.
{context}

Weight brand/audience fit heaviest: a technically strong but off-voice or off-audience idea should not score well. Reward ideas that only this operator could credibly make. ${JUDGE_FIELDS}`,
    },
    {
      id: "encouraging",
      label: "Encouraging coach",
      description: "Constructive: scores fairly but frames the sharpest fix positively.",
      template: `You are a constructive short-form coach. Before any asset is produced, judge the plan fairly and calibrated, but frame your feedback to help the creator ship a stronger version.
{context}

Score honestly (no grade inflation), but make the "angle" field a concrete, encouraging next step the creator can act on rather than a put-down. Still flag real risks plainly. ${JUDGE_FIELDS}`,
    },
    {
      id: "trend-timing",
      label: "Trend-timing analyst",
      description: "Judges whether the idea rides the trend window or is already late.",
      template: `You are a trend-timing analyst. Before any asset is produced, judge whether this plan catches the trend at the right moment for THIS operator, or is too early/too late/too saturated.
{context}

Weight format/platform fit and freshness heavily: penalise ideas chasing a peaked or oversaturated format, reward ones with a timely, differentiated angle on what's rising now. ${JUDGE_FIELDS}`,
    },
  ],

  "cover.scaffold.standard": [
    {
      id: "cinematic",
      label: "Cinematic / filmic",
      description: "Moody, shallow depth of field, dramatic key light.",
      template: `{coverImagePrompt}

Photographic direction: a cinematic vertical 9:16 (1080x1920) first frame — shallow depth of field, dramatic directional key light with deep shadow, filmic color grade, 35mm-anamorphic feel, the full subject in frame and tack-sharp. Keep the subject clear of the bottom ~20%/top ~10% where captions and platform UI sit; this frame is the literal start frame the video animates from, so keep it whole and uncluttered.

Avoid: rendered text/words, watermarks, logos, extra or warped limbs/fingers, distorted faces, borders or letterboxing, plastic skin, busy backgrounds hard to track motion against.`,
    },
    {
      id: "bright-ugc",
      label: "Bright UGC / authentic",
      description: "Natural light, phone-shot realism that reads as native content.",
      template: `{coverImagePrompt}

Photographic direction: a bright, authentic UGC-style vertical 9:16 (1080x1920) first frame — natural daylight, true-to-life color, the candid look of a great phone photo, subject fully in frame and in sharp focus. High enough contrast to pop on a small screen without looking staged. Keep the subject clear of the bottom ~20%/top ~10%; this frame is the literal start frame the video animates from, so keep the composition whole.

Avoid: rendered text/words, watermarks, logos, extra or warped limbs/fingers, distorted faces, borders or letterboxing, over-retouched skin, cluttered backgrounds.`,
    },
    {
      id: "bold-graphic",
      label: "Bold graphic / high-contrast",
      description: "Punchy single-subject composition built to win the thumbnail.",
      template: `{coverImagePrompt}

Photographic direction: a bold, high-contrast vertical 9:16 (1080x1920) first frame engineered as a thumbnail — one dominant subject, strong negative space, saturated punchy palette, crisp rim or hard light separating subject from background. Maximum thumb-stop at small size. Keep the subject clear of the bottom ~20%/top ~10%; this frame is the literal start frame the video animates from, so keep it whole and centered.

Avoid: rendered text/words, watermarks, logos, extra or warped limbs/fingers, distorted faces, borders or letterboxing, busy backgrounds.`,
    },
    {
      id: "minimal",
      label: "Minimal / clean studio",
      description: "Calm, premium, lots of breathing room.",
      template: `{coverImagePrompt}

Photographic direction: a clean, minimal vertical 9:16 (1080x1920) first frame — soft even studio light, restrained palette, generous negative space, premium product-photography calm, subject fully in frame and sharp. Composed to feel high-end and uncluttered. Keep the subject clear of the bottom ~20%/top ~10%; this frame is the literal start frame the video animates from.

Avoid: rendered text/words, watermarks, logos, extra or warped limbs/fingers, distorted faces, borders or letterboxing, harsh clutter.`,
    },
    {
      id: "dramatic-closeup",
      label: "Dramatic close-up",
      description: "Tight, emotive framing on a face or key detail.",
      template: `{coverImagePrompt}

Photographic direction: a tight, emotive vertical 9:16 (1080x1920) first-frame close-up — fill the frame with the face or the single most important detail, expressive lighting, palpable texture and emotion, razor focus on the eyes/subject. Intimate and arresting, yet leave a little room so the video can animate without cropping. Keep key features clear of the bottom ~20%/top ~10%.

Avoid: rendered text/words, watermarks, logos, extra or warped limbs/fingers, distorted faces, borders or letterboxing, plastic skin.`,
    },
  ],

  "cover.scaffold.infographic": [
    {
      id: "stat-hero",
      label: "Single stat hero",
      description: "One giant number dominates the frame.",
      template: `Vertical 9:16 (1080x1920) social infographic about "{topic}". {coverImagePrompt}.

Layout: ONE giant hero number/stat dominates the composition, a short bold headline above it, one supporting label below. Ruthless hierarchy — the number is unmissable at thumbnail size. High-contrast modern palette, crisp legible type, everything inside frame with margin and clear of the bottom ~20%/top ~10%. This frame is the literal start frame the video animates from, so keep it centered and balanced.

No watermark, no logos, no borders or letterboxing.`,
    },
    {
      id: "comparison",
      label: "Comparison / vs",
      description: "Two-column or before-after contrast.",
      template: `Vertical 9:16 (1080x1920) social infographic about "{topic}". {coverImagePrompt}.

Layout: a clear two-side comparison (A vs B, or before/after) split top/bottom or left/right, each side with a label, an icon, and one key figure; a bold headline frames the contrast. Symmetrical, instantly legible hierarchy. High-contrast modern palette, all text inside frame with margin, clear of bottom ~20%/top ~10%. This frame is the literal start frame the video animates from, so keep it balanced.

No watermark, no logos, no borders or letterboxing.`,
    },
    {
      id: "checklist",
      label: "Checklist / steps",
      description: "A scannable numbered list or checklist.",
      template: `Vertical 9:16 (1080x1920) social infographic about "{topic}". {coverImagePrompt}.

Layout: a bold headline over a scannable vertical list of 3-5 numbered steps or checklist items, each with a small icon and a few words. Even spacing, strong rhythm, the headline largest. High-contrast modern palette, crisp legible text fully inside frame with margin, clear of bottom ~20%/top ~10%. This frame is the literal start frame the video animates from, so keep the layout centered.

No watermark, no logos, no borders or letterboxing.`,
    },
    {
      id: "chart-led",
      label: "Chart-led",
      description: "A simple chart is the centerpiece.",
      template: `Vertical 9:16 (1080x1920) social infographic about "{topic}". {coverImagePrompt}.

Layout: a single simple, clean chart (bar, line, or donut) is the centerpiece with a bold headline above and one takeaway caption below; the chart's biggest movement reads instantly. No clutter of axes or legends beyond what's needed. High-contrast modern palette, crisp legible labels fully inside frame with margin, clear of bottom ~20%/top ~10%. This frame is the literal start frame the video animates from.

No watermark, no logos, no borders or letterboxing.`,
    },
    {
      id: "editorial",
      label: "Editorial / magazine",
      description: "Premium editorial layout with refined typography.",
      template: `Vertical 9:16 (1080x1920) social infographic about "{topic}". {coverImagePrompt}.

Layout: a premium editorial/magazine treatment — confident headline typography, a refined limited palette, tasteful use of one stat or pull-quote, generous margins, strong but elegant hierarchy. Looks like a polished publication cover, not a busy infographic. All text inside frame with margin, clear of bottom ~20%/top ~10%. This frame is the literal start frame the video animates from.

No watermark, no logos, no borders or letterboxing.`,
    },
  ],

  // The editorial brand prompts are the canonical house style — operators edit
  // them via overrides rather than swapping strategic angles, so no alternates.
  "infographic.editorial": [],
  "infographic.brandBackground": [],

  "video.scaffold": [
    {
      id: "fast-cut",
      label: "Fast-cut / energetic",
      description: "Rapid cuts and snappy transitions throughout.",
      template: `{videoPrompt}

Cinematographic direction: open exactly from the provided start frame — same subject, setting, composition, now in motion — keeping "{topic}" legible across every shot. Vertical 9:16 throughout. Rapid cuts and snappy transitions (whip-pans, speed-ramps, match cuts), cut on action never on idle, energy matched to a "{soundMood}" mood. Keep the main action clear of the bottom ~20%/top ~10%. No dead air, flicker, morphing/warped limbs, or stray text artifacts — every shot does retention work.`,
    },
    {
      id: "smooth-cinematic",
      label: "Smooth cinematic",
      description: "Gliding camera moves and graceful transitions.",
      template: `{videoPrompt}

Cinematographic direction: open exactly from the provided start frame — same subject, setting, composition, now in motion — keeping "{topic}" legible throughout. Vertical 9:16. Smooth, deliberate camera motion (slow push-ins, gimbal glides, gentle parallax), graceful transitions, filmic continuity of light and color with the opening frame, paced to a "{soundMood}" mood. Keep the main action clear of the bottom ~20%/top ~10%. No dead air, flicker, morphing/warped limbs, or stray text artifacts.`,
    },
    {
      id: "static-punchy",
      label: "Locked-off / punchy",
      description: "Static framing with punch-ins on the key beats.",
      template: `{videoPrompt}

Cinematographic direction: open exactly from the provided start frame — same subject, setting, composition, now in motion — keeping "{topic}" legible throughout. Vertical 9:16. Mostly static lock-off framing with deliberate punch-ins or quick zooms on the key reveals/punchlines so the motion lands where it matters; lighting/color continuous with the opening frame; energy matched to a "{soundMood}" mood. Keep the main action clear of the bottom ~20%/top ~10%. No dead air, flicker, morphing/warped limbs, or stray text artifacts.`,
    },
    {
      id: "handheld-ugc",
      label: "Handheld UGC",
      description: "Authentic phone-shot movement and feel.",
      template: `{videoPrompt}

Cinematographic direction: open exactly from the provided start frame — same subject, setting, composition, now in motion — keeping "{topic}" legible throughout. Vertical 9:16. Authentic handheld phone-shot energy — slight natural shake, reframing on the fly, candid realism — while staying watchable; continuity of light/color with the opening frame; paced to a "{soundMood}" mood. Keep the main action clear of the bottom ~20%/top ~10%. No dead air, flicker, morphing/warped limbs, or stray text artifacts.`,
    },
    {
      id: "reveal-driven",
      label: "Reveal-driven",
      description: "Built around one satisfying reveal on the last beat.",
      template: `{videoPrompt}

Cinematographic direction: open exactly from the provided start frame — same subject, setting, composition, now in motion — keeping "{topic}" legible throughout. Vertical 9:16. Structure the motion to build toward ONE satisfying reveal on the final beat — withhold, tease, then deliver with the strongest camera move and cut of the clip; continuity of light/color with the opening frame; paced to a "{soundMood}" mood. Keep the main action clear of the bottom ~20%/top ~10%. No dead air, flicker, morphing/warped limbs, or stray text artifacts.`,
    },
  ],

  "notebooklm.insight": [
    {
      id: "contrarian-angle",
      label: "Contrarian angle",
      description: "Surfaces the counterintuitive point the sources support.",
      template: `You are a research analyst working strictly from the sources in this notebook — never invent facts. Find the most COUNTERINTUITIVE defensible angle on "{topic}" that a short-form creator can build a video around.
{voiceContext}

Return: the single most surprising/under-appreciated point the sources actually support; 2-4 specific citable facts/figures/quotes backing it (name the source); why it matters now; and what the generic take gets wrong so the creator can differentiate. If the sources don't support a strong contrarian angle, say so plainly. Output only the insight.`,
    },
    {
      id: "stat-led",
      label: "Stat-led",
      description: "Leads with the most striking sourced number.",
      template: `You are a research analyst working strictly from the sources in this notebook — never invent facts. Distill a STAT-LED insight on "{topic}" a short-form creator can hook a video on.
{voiceContext}

Return: the single most striking, specific figure the sources support (with the source named); 2-4 supporting facts/quotes that contextualise it; why it matters now; and what a generic take misses. If the sources lack a strong figure, say so rather than padding. Output only the insight.`,
    },
    {
      id: "myth-busting",
      label: "Myth-busting",
      description: "Names a common misconception and corrects it from sources.",
      template: `You are a research analyst working strictly from the sources in this notebook — never invent facts. Build a MYTH-BUSTING insight on "{topic}".
{voiceContext}

Return: a widely-believed misconception about the topic, the sourced evidence that corrects it (2-4 citable facts/quotes, name the source), why the correction matters now, and how a creator can frame it without strawmanning. If the sources don't clearly refute a common belief, say so. Output only the insight.`,
    },
    {
      id: "how-it-works",
      label: "How it works",
      description: "Explains the underlying mechanism the sources describe.",
      template: `You are a research analyst working strictly from the sources in this notebook — never invent facts. Distill a HOW-IT-WORKS insight on "{topic}" — the underlying mechanism, simply.
{voiceContext}

Return: the core mechanism/process the sources describe, broken into the 2-4 steps or factors that matter most (with sourced facts/quotes, name the source); why understanding it matters now; and the misconception a generic explainer leaves intact. If the sources don't support a clear mechanism, say so. Output only the insight.`,
    },
    {
      id: "whats-next",
      label: "What's next / implications",
      description: "Focuses on near-term implications the sources point to.",
      template: `You are a research analyst working strictly from the sources in this notebook — never invent facts. Distill a FORWARD-LOOKING insight on "{topic}" — the implications the sources actually point to.
{voiceContext}

Return: the most consequential near-term implication or shift the sources support (not speculation beyond them); 2-4 citable facts/quotes grounding it (name the source); why an audience should care now; and what a generic take overlooks. If the sources don't support a forward-looking claim, say so. Output only the insight.`,
    },
  ],
};

/** Surrogate primary key for a variant row. */
function variantRowId(key: string, variantId: string): string {
  return `${key}:${variantId}`;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "variant"
  );
}

/**
 * Seed the built-in variants into the DB once. Only runs when the table is
 * empty, so operator edits and deletions persist across restarts (a deleted
 * built-in stays deleted; see restorePromptVariants to re-add the defaults).
 */
export function seedPromptVariants(db: DB, now: string = new Date().toISOString()): void {
  const existing = db.select({ id: promptVariantsTable.id }).from(promptVariantsTable).all();
  if (existing.length > 0) return;
  const rows = PROMPT_KEYS.flatMap((key) =>
    PROMPT_VARIANTS[key].map((v) => ({
      id: variantRowId(key, v.id),
      key,
      variantId: v.id,
      label: v.label,
      description: v.description,
      template: v.template,
      builtin: true,
      updatedAt: now,
    })),
  );
  if (rows.length > 0) db.insert(promptVariantsTable).values(rows).run();
}

/** Re-insert any built-in variants missing from the table (idempotent). */
export function restorePromptVariants(db: DB, now: string = new Date().toISOString()): number {
  let added = 0;
  for (const key of PROMPT_KEYS) {
    for (const v of PROMPT_VARIANTS[key]) {
      const id = variantRowId(key, v.id);
      const present = db.select({ id: promptVariantsTable.id }).from(promptVariantsTable).where(eq(promptVariantsTable.id, id)).get();
      if (present) continue;
      db.insert(promptVariantsTable)
        .values({ id, key, variantId: v.id, label: v.label, description: v.description, template: v.template, builtin: true, updatedAt: now })
        .run();
      added += 1;
    }
  }
  return added;
}

/** A variant as the UI sees it (includes template + builtin flag for editing). */
export type VariantOption = {
  id: string;
  label: string;
  description: string;
  template: string;
  builtin: boolean;
};

export type VariantStage = {
  key: PromptKey;
  label: string;
  description: string;
  variants: VariantOption[];
};

/**
 * Full per-stage catalog from the DB (seeding first if empty). The built-in
 * "default" option is prepended to each stage; it is not a stored row.
 */
export function loadVariantCatalog(db: DB): VariantStage[] {
  seedPromptVariants(db);
  const rows = db.select().from(promptVariantsTable).all();
  const byKey = new Map<string, VariantOption[]>();
  for (const r of rows) {
    if (!byKey.has(r.key)) byKey.set(r.key, []);
    byKey.get(r.key)!.push({
      id: r.variantId,
      label: r.label,
      description: r.description,
      template: r.template,
      builtin: r.builtin,
    });
  }
  return PROMPT_KEYS.map((key) => ({
    key,
    label: PROMPT_DEFAULTS[key].label,
    description: PROMPT_DEFAULTS[key].description,
    variants: [
      { id: DEFAULT_VARIANT_ID, label: "Default (built-in)", description: "The standard prompt for this stage.", template: PROMPT_DEFAULTS[key].template, builtin: true },
      ...(byKey.get(key) ?? []),
    ],
  }));
}

/** Create a custom variant; derives a unique variantId from the label. */
export function createPromptVariant(
  db: DB,
  input: { key: string; label: string; description?: string; template: string },
  now: string = new Date().toISOString(),
): { id: string; variantId: string } {
  const base = slugify(input.label);
  let variantId = base;
  for (let i = 2; db.select({ id: promptVariantsTable.id }).from(promptVariantsTable).where(eq(promptVariantsTable.id, variantRowId(input.key, variantId))).get(); i += 1) {
    variantId = `${base}-${i}`;
  }
  const id = variantRowId(input.key, variantId);
  db.insert(promptVariantsTable)
    .values({ id, key: input.key, variantId, label: input.label, description: input.description ?? "", template: input.template, builtin: false, updatedAt: now })
    .run();
  return { id, variantId };
}

/** Update an existing variant's editable fields (label/description/template). */
export function updatePromptVariant(
  db: DB,
  id: string,
  fields: { label?: string; description?: string; template?: string },
  now: string = new Date().toISOString(),
): boolean {
  const set: Record<string, string> = { updatedAt: now };
  if (fields.label !== undefined) set.label = fields.label;
  if (fields.description !== undefined) set.description = fields.description;
  if (fields.template !== undefined) set.template = fields.template;
  const res = db.update(promptVariantsTable).set(set).where(eq(promptVariantsTable.id, id)).run();
  return res.changes > 0;
}

/** Delete a variant (built-in or custom). */
export function deletePromptVariant(db: DB, id: string): boolean {
  const res = db.delete(promptVariantsTable).where(eq(promptVariantsTable.id, id)).run();
  return res.changes > 0;
}

/**
 * Resolve a per-run selection ({promptKey: variantId}) into a {key: template}
 * override map. Reads from the DB when given (so custom variants resolve),
 * else falls back to the built-in constants. Missing / "default" / unknown
 * selections are skipped (they fall back to the built-in default downstream).
 */
export function resolveVariantTemplates(
  selection?: Record<string, string>,
  db?: DB,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!selection) return out;
  for (const [key, variantId] of Object.entries(selection)) {
    if (!variantId || variantId === DEFAULT_VARIANT_ID) continue;
    if (db) {
      const row = db.select().from(promptVariantsTable).where(eq(promptVariantsTable.id, variantRowId(key, variantId))).get();
      if (row) out[key] = row.template;
    } else if (isPromptKey(key)) {
      const variant = PROMPT_VARIANTS[key].find((v) => v.id === variantId);
      if (variant) out[key] = variant.template;
    }
  }
  return out;
}
