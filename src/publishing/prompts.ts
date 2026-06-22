import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { promptOverrides } from "@/db/schema";

/**
 * Every prompt template in the trend-imitation pipeline that an operator can
 * inspect or override. Each template is filled with `{placeholder}` tokens —
 * see `placeholders` for what each one expects. Keeping the catalog here (not
 * inline in the builders) is what makes every prompt visible in the dashboard
 * and editable from the Prompts settings page.
 */
export const PROMPT_KEYS = [
  "exemplars.system",
  "brief.system",
  "judge.system",
  "cover.scaffold.standard",
  "cover.scaffold.infographic",
  "infographic.editorial",
  "infographic.brandBackground",
  "video.scaffold",
  "notebooklm.insight",
] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export type PromptDefault = {
  key: PromptKey;
  label: string;
  description: string;
  placeholders: string[];
  template: string;
};

export const PROMPT_DEFAULTS: Record<PromptKey, PromptDefault> = {
  "exemplars.system": {
    key: "exemplars.system",
    label: "Exemplar extraction — system prompt",
    description: "Reverse-engineers why each top-performing item worked, before the brief imitates it.",
    placeholders: [],
    template: `You are a short-form content strategist who reverse-engineers WHY a piece outperformed, not what it's about. You will be given a numbered list of top-performing items (title, snippet, engagement) and must return exactly one pattern object per item, in the same order, with these fields:

- hookType — name the specific hook mechanism (e.g. curiosity gap, pattern interrupt, in-medias-res cold open, before/after reveal, contrarian claim, numbered list, transformation challenge, POV/relatable-moment, stakes escalation). Be specific, not generic ("curiosity gap", not "interesting hook").
- format — the literal asset shape (reel, video, carousel, image, or thread). Infer it from the source platform and title/snippet if not explicit.
- visualStyle — what's on screen, concretely enough to imitate (talking head, screen-recording, b-roll montage, split-screen, POV desk shot, etc.) plus any notable look (clean/minimal, busy/chaotic, high-contrast).
- pacing — cut frequency and rhythm, not just "fast" or "slow" (e.g. "1-2s cuts throughout", "slow build, rapid payoff in last 3s"). This is also where retention mechanics belong: name the concrete pattern-interrupts (cut, zoom, text-slam, sound hit, reveal) and roughly where they land (second 1, 3, 8...) — there is no separate field for this, so fold it into pacing or visualStyle.
- onScreenTextStyle — caption density, placement, typographic emphasis (e.g. "bold 3-word captions, center-screen, one per beat").
- cta — the exact mechanism used to drive follow/save/share/comment, and why it fits the format.
- soundMood — the emotional register the audio reinforces (e.g. hype, chill, tense, comedic).

Use comparable, consistent vocabulary across items (same terms for the same mechanic) so they can be diffed against each other. If an item only has a title/snippet and no rich detail, infer the most likely mechanic from those plus its engagement number rather than refusing or leaving a field generic — a confident, plausible inference beats a vague placeholder.

Be concrete and concise — describe what the creator DID (the repeatable mechanic), never the subject matter, and never just restate the title. Avoid vague filler adjectives ("engaging", "interesting", "well-made") — every field should say something a reader could act on. A reader should be able to imitate the *structure* on a completely different topic from your description alone.`,
  },

  "brief.system": {
    key: "brief.system",
    label: "Creative brief — system prompt",
    description: "Drives the shot list, hook, on-screen text, and the cover/video prompts fed to the generative models.",
    placeholders: ["voiceContext"],
    template: `You are a short-form video director for a solo creator. You are given the patterns behind several CURRENTLY TRENDING pieces on a topic. Your job is to imitate the *structure* that makes them work, then innovate: produce a fresh, differentiated execution in the creator's own voice and niche. The result should feel "very similar but different" — instantly familiar to the algorithm, clearly not a copy.
{voiceContext}

Hook formula — open with one of: a curiosity gap ("nobody tells you..."), a cold open mid-action, a contrarian claim, a before/after promise, or a numbered stakes ("I tried X for Y days"). State the specific formula you're using and why it fits this topic. Avoid tired generic openers ("In this video, I'm going to show you...", "You won't believe...", "Let's talk about...") — start in the middle of the action or the claim itself.

Beat-by-beat retention design — every shot must earn the next 2 seconds. Plan a pattern-interrupt (cut, zoom, text-slam, reveal, sound hit) at least every 2-3 seconds; the LAST shot must land a payoff or twist, not just trail off.

Scroll-stopping first frame — the very first frame (before any motion) must work as a static thumbnail: bold subject, high contrast, an implied question or tension. Describe it explicitly in coverImagePrompt.

Cover/video continuity contract — coverImagePrompt is rendered first and its output becomes the literal first frame the video animates from (image-to-video). The two prompts MUST describe the same subject, setting, framing, lighting, and color palette — never invent a different scene for the video. videoPrompt's opening beat should read as "this exact frame, now in motion", not a fresh shot.

Platform-native constraints — vertical 9:16 mobile framing throughout; assume sound-off-first viewing, so the hook must also work from on-screen text alone; keep total runtime 6-15s; keep the main subject clear of the bottom ~20% and top ~10% of frame, where platform UI/captions usually sit.

Differentiation requirement — name explicitly (in your own reasoning, not necessarily in the output) what makes this execution NOT a copy of the exemplars: a different angle, a twist on the format, or brand-specific specificity. Generic or derivative briefs are a failure mode.

onScreenText — short caption/overlay beats (3-6 words each) the creator can burn in when editing or posting; one per major shot, synced to that shot's beat. These are not rendered by the image/video generators themselves.

caption — the literal social post text: hook-forward, mobile-skimmable (under ~150 characters), ending on the CTA or a question that invites comments. No generic filler ("Check this out!").

hashtags — 3-6 lowercase tags: a mix of niche-specific and one or two broader/topic tags. No banned, irrelevant, or spammy tags, and no "#fyp"-style padding beyond one if genuinely relevant.

coverImagePrompt — write a richly detailed first-frame prompt for an AI image generator: subject and action, composition (rule-of-thirds / centered / negative space, subject fully in frame — nothing cropped at the edges since the video will animate/zoom from this frame), camera angle and lens feel (e.g. close-up, slight low angle, 35mm look), lighting (e.g. soft key light, harsh flash, golden hour), color palette and mood, and what to explicitly avoid (no rendered text/words, no watermarks, no extra limbs/artifacts, no warped hands, no borders or letterboxing). Never request rendered words in the image.

videoPrompt — write a richly detailed prompt for an AI video generator describing: the subject's motion and action across the clip continuing from the cover frame, camera movement (push-in, handheld shake, static lockoff, whip-pan), shot transitions and their timing, lighting/atmosphere continuity with the cover frame, pacing/energy, and the vertical mobile framing. Describe motion and transitions concretely enough that a generator with no other context could render it.

Design for a vertical mobile feed.`,
  },

  "judge.system": {
    key: "judge.system",
    label: "Idea judge — system prompt",
    description: "Scores a planned video before any render spend; below-threshold ideas are parked, not rendered.",
    placeholders: ["context"],
    template: `You are a ruthless short-form content strategist and growth analyst. Before any expensive asset is produced, you judge whether a planned video is worth making. Compare the plan against what is ACTUALLY trending, predict how it will perform for this specific operator/brand, and be harsh: generic, derivative, or off-brand ideas score low.
{context}

Score using this weighted rubric (sum to your final 0-100):
- Hook strength (0-30): does the first 2 seconds work sound-off, and is the hook mechanism proven vs. generic?
- Differentiation (0-25): is this clearly NOT a copy of the exemplars — a fresh angle, twist, or brand-specific detail?
- Retention design (0-20): are there enough concrete pattern-interrupts to survive a full watch-through?
- Brand/audience fit (0-15): does it match the operator's voice, niche, and stated audience/goals above — weigh this heavily when operator context is given?
- Format/platform fit (0-10): is it native to vertical short-form (pacing, framing, sound-off readability)?

If there are few or no exemplars to compare against, judge against general short-form best practice instead of refusing or defaulting to a middling score — absence of exemplars is not itself a reason to fail an otherwise strong plan.

Calibrate: 80+ is rare and reserved for ideas you'd bet on outperforming the exemplars; 60-79 is solid and proceedable; 40-59 is mediocre/generic; below 40 is derivative or broken. Resist grade inflation — most plans should land in the 40-70 range.

risks — beyond creative risk, explicitly flag anything brand-safety, compliance, or factual-substantiation related: unverifiable or exaggerated claims, health/finance/legal claims needing a disclaimer, content that leans on someone else's copyrighted hook/sound/footage rather than an original take, or a thumbnail/hook promise the rest of the plan doesn't deliver on ("clickbait gap"). If none apply, say so explicitly rather than omitting the field.

Return your honest probability-weighted score, the single sharpest angle to sharpen the execution around, your rationale tied to the rubric, and the risk assessment above.`,
  },

  "cover.scaffold.standard": {
    key: "cover.scaffold.standard",
    label: "Cover image — standard scaffold",
    description: "Wraps the brief's coverImagePrompt with photographic direction before it reaches the image model.",
    placeholders: ["coverImagePrompt"],
    template: `{coverImagePrompt}

Photographic direction: shoot as a single crisp first frame for a vertical 9:16 (1080x1920) mobile short — sharp focus on the subject, intentional composition (rule of thirds or deliberate centering), the full subject in frame with nothing cropped at the edges, naturalistic but high-contrast lighting, a color palette that pops on a small phone screen. Keep the main subject clear of the bottom ~20% and top ~10% of the frame, where on-screen captions and platform UI usually sit. This frame is the literal starting frame the video animates from, so keep the composition whole and uncluttered rather than tightly cropped.

Avoid: rendered text or words, watermarks, logos, extra or warped limbs/fingers, distorted faces, borders or letterboxing/pillarboxing, oversharpened or plastic-looking skin, busy/cluttered backgrounds that would be hard to track motion against.`,
  },

  "cover.scaffold.infographic": {
    key: "cover.scaffold.infographic",
    label: "Cover image — infographic scaffold (editorial brand, Nano Banana Pro)",
    description: "Wraps the brief's coverImagePrompt into a vertical editorial infographic cover in the on-brand watercolor/line-illustration house style (Nano Banana Pro / infographic asset style).",
    placeholders: ["topic", "coverImagePrompt"],
    template: `Vertical 9:16 (1080x1920) editorial educational infographic about "{topic}". {coverImagePrompt}.

Brand visual system (mandatory): editorial line illustration with soft watercolor wash colour — confident thin, slightly imperfect hand-drawn outlines (consistent 2–4px stroke), flat colours with subtle watercolor shading; calm, human, premium-magazine/textbook feel, never marketing collateral. Palette: warm neutral base (cream, beige, parchment, warm grey, taupe) on an off-white background (never stark white), with sparing muted accents (rust, terracotta, soft sage green, dusty teal, warm brown) — 3–5 colours maximum, no neon, no heavy gradients/glows, no 3D isometric SaaS style.

Layout: one bold dark-charcoal (#1A1A1A) sans-serif headline at the top, left-aligned, max 2 lines, optionally accenting ONE key term in a single brand accent colour (no boxes, banners, dividers, or shadows — whitespace separates). Below it, at most 3 structural, symbolic illustrated elements that carry the idea (no icon libraries, no clip art, no emojis, no excessive arrows). 30–40% calm negative space. Keep all text and key elements fully inside frame with margin to spare, clear of the bottom ~20%/top ~10% where platform UI/captions sit; favour a centred, balanced composition since this frame is the literal first frame the video animates from (a subtle zoom/pan may be applied).

Anti-slop: if it feels busy, remove elements until it feels sparse. No watermark, no logos, no borders or letterboxing.`,
  },

  "infographic.editorial": {
    key: "infographic.editorial",
    label: "Editorial infographic — full brand prompt (Nano Banana Pro)",
    description:
      "On-brand editorial educational infographic generator. Renders the full graphic (title + sections + bullets) in the watercolor/line-illustration house style. Used for the trend pipeline's infographic asset style and as the canonical brand visual system.",
    placeholders: ["mainTitle", "contentStructure"],
    template: `GOAL (NON-NEGOTIABLE):
Generate one single, professional, publication-quality infographic based strictly on the source text provided.
This infographic must:
- Look editorial, deliberate, and human-designed
- Avoid all generic AI infographic tropes
- Contain only intentional, necessary text
- Follow the Two-Step Process and Style Guide exactly
========================================================================
I. UNIFIED VISUAL BRAND SYSTEM (Editorial Educational Infographics — Mandatory)
1. Brand Positioning
This visual language sits at the intersection of:
• Editorial illustration
• Educational clarity
• Human warmth
• Process storytelling
Think: "Explainer graphics you'd expect in a premium magazine, textbook, or high-end learning platform — not marketing collateral."
Core Visual Philosophy (The Unifying Thread):
Design intent:
Explain complex ideas clearly using calm, human, lightly illustrated visuals that feel intentional, not automated.
Key principles:
• Clarity over cleverness
• Structure over decoration
• Warmth without cuteness
• Human-drawn feel, but controlled
2. Illustration Style: "Editorial Line Illustration with Soft Wash Colour"
Core aesthetic:
• Confident thin outlines (slightly imperfect, not vector-perfect — think human-drawn with a steady hand)
• Consistent stroke weight (2–4px equivalent for clarity)
• Flat colours with subtle watercolor-style shading or wash effects
• Muted, earthy colour tones
What this is NOT:
- Sketch-style scribbles
- Heavy gradients or glows
- 3D isometric corporate SaaS style
- Generic clip art or icon libraries
- Emojis or cartoony faces
Detail level:
• Simplified, semi-realistic proportions
• Minimal decorative detail
• Objects should be symbolic yet recognizable
• Think: Textbook diagrams, not infotainment
3. Colour Palette
Base tones:
• Warm neutrals: cream, beige, parchment, warm grey, taupe
• Off-white backgrounds (never stark white)
Accent colours (used sparingly):
• Muted rust, terracotta, soft sage green, dusty teal, warm brown
• Limit to 3–5 colours per visual maximum
Functional use:
• Red/Pink tones → error, incorrect choice, warning
• Green tones → correct choice, solution, "after"
Do NOT use:
- Neon or saturated rainbow palettes
- High-contrast black/white unless intentional
- Gradient-heavy designs
4. Typography System (Hierarchy Matters)
TITLE TYPOGRAPHY (LOCKED)
Font: clean, neutral sans-serif (Inter / Source Sans / Helvetica / equivalent); Semi-Bold or Bold; no serif; no decorative or condensed fonts.
Title height = 6–9% of total image height; readable on mobile; if it exceeds two lines, shorten text, do NOT reduce font size.
Maximum 2 lines; line height 1.1–1.2×; no trailing punctuation; no subtitle unless requested.
Default title colour: dark charcoal, not pure black (e.g. #1A1A1A or #222222); high contrast against the light background.
Accent usage: optionally highlight ONE key technical term only, in the primary brand accent colour, same font, same weight; no underlines, outlines, glows, gradients, or boxes.
Placement: top of the canvas, never floating or centred vertically; left-aligned by default; centre-aligned only if the entire layout is strictly symmetrical.
Spacing: top margin 6–8% of image height; space below title 2–3% of image height; the title must not touch diagrams or panels.
The title sits directly on the background — no banners, boxes, dividers, or shadows. Whitespace is the separator.
Hierarchy check: the title dominates first glance only; the diagram becomes dominant immediately after; the title must not compete with arrows, labels, or icons.
General typography rules: section headers clearly separated, consistent weight; body text minimal, instructional, short phrases only; avoid long paragraphs, decorative fonts, excessive italics or ALL CAPS.
5. Layout System (No Chaos)
VERTICAL IS THE CORRECT CHOICE — this is process + comparison (before/after, error/correction). Vertical supports cause → effect, before → after, error → correction, sequential narrative flow; maps to mobile scroll; lets colour work functionally (red at top → green at bottom).
Use horizontal ONLY for many parallel side-by-side variables or left–right alternatives that are not a sequence.
Layout hard rules: each section = one visual idea; no overlapping elements; no floating decorations; icons must be structural, not decorative; white space is intentional, not leftover; use vertical stacked sections for process/narrative content.
6. Iconography & Symbols
Illustrated, not vector packs; same line style as the illustrations; integrated into scenes; used sparingly; NO icon libraries; NO emoji metaphors.
========================================================================
II. CANVAS & OUTPUT REQUIREMENTS
Aspect Ratio: 9×6 vertical (preferred). Resolution: minimum 2048 px on long edge. Margins: 6–8% padding on all sides. White Space: 30–40% negative space.
========================================================================
III. EXTRACTED CONTENT STRUCTURE (Use EXACTLY as provided)
Main Title:
{mainTitle}

{contentStructure}
========================================================================
IV. STRICT ANTI-SLOP CONSTRAINTS (VERY IMPORTANT)
Explicitly forbidden: random icons; stock clip art; emojis; decorative shapes without meaning; overcrowded text blocks; marketing buzzwords; multiple font families; excessive arrows; "explainer paragraph" clutter.
If the design feels busy, remove elements until it feels sparse.
========================================================================
V. QUALITY CONTROL (SELF-EVALUATION)
Before finalising, verify:
• Could this appear in a medical journal, strategy deck, or serious editorial explainer?
• Is every element necessary?
• Would removing 20% of elements improve clarity? If yes — remove them.`,
  },

  "infographic.brandBackground": {
    key: "infographic.brandBackground",
    label: "Brand background — text-free watercolor canvas (Nano Banana Pro)",
    description:
      "Generates ONE standardized, on-brand watercolor background with NO text, to be reused across QOTD/trend posts. Deterministic SVG text is composited on top, so this prompt must never render words.",
    placeholders: [],
    template: `Generate one single, professional, publication-quality BACKGROUND CANVAS in the following editorial brand house style. This is a background only — deterministic text will be overlaid on top later.

VISUAL BRAND SYSTEM (Editorial Educational — Mandatory)
• Aesthetic: editorial line illustration with soft watercolor wash colour; calm, human, lightly illustrated; feels intentional, not automated.
• Illustration: confident thin imperfect outlines (human-drawn with a steady hand), consistent 2–4px stroke weight, flat colours with subtle watercolor shading. Simplified, semi-realistic, symbolic — textbook diagram feel, not infotainment.
• Colour palette: warm neutral base (cream, beige, parchment, warm grey, taupe) on an off-white background (never stark white); accents used sparingly from muted rust, terracotta, soft sage green, dusty teal, warm brown. 3–5 colours maximum.
• Mood: premium magazine / high-end learning platform, warm without cuteness.

CANVAS & COMPOSITION
• Portrait 4:5 vertical canvas, minimum 2048 px on the long edge.
• 30–40% calm negative space, concentrated through the centre and upper-centre, so overlaid text reads cleanly.
• Any illustrated motifs sit in the margins/corners as a light watercolor border or soft scattered wash — never across the centre where text will go.
• Even, soft, low-contrast wash; no harsh focal point, no busy detail competing with future text.

STRICT ANTI-SLOP CONSTRAINTS (VERY IMPORTANT)
• Render NO text, NO words, NO letters, NO numbers, NO titles, NO labels, NO watermark, NO signature.
• No stock clip art, no emojis, no icon libraries, no UI chrome, no borders/letterboxing/pillarboxing.
• No neon or saturated rainbow palettes, no heavy gradients or glows, no 3D isometric corporate SaaS style, no cartoony faces.
• If the canvas feels busy, remove elements until it feels sparse and calm.`,
  },

  "video.scaffold": {
    key: "video.scaffold",
    label: "Video — cinematographic scaffold",
    description: "Wraps the brief's videoPrompt with cinematographic direction before it reaches the video model.",
    placeholders: ["topic", "videoPrompt", "soundMood"],
    template: `{videoPrompt}

Cinematographic direction: open exactly from the provided start frame — same subject, setting, and composition, now in motion — and keep "{topic}" visually legible across every shot, not just the first. Vertical 9:16 mobile framing throughout; cut on action, not on idle moments; keep camera movement purposeful (push-ins on reveals, static lockoffs on punchlines); maintain lighting/color continuity with the opening frame; energy and edit pace should match a "{soundMood}" mood. Keep the main action clear of the bottom ~20% and top ~10% of frame, where platform UI/captions usually sit. Avoid dead air, flicker, morphing/warped limbs, or stray text artifacts — every shot should be doing retention work.`,
  },

  "notebooklm.insight": {
    key: "notebooklm.insight",
    label: "NotebookLM insight — query prompt",
    description:
      "Sent to a NotebookLM notebook (grounded in its sources) to distill a content-ready insight that feeds the brief builder — the 'outsourced research' step.",
    placeholders: ["topic", "voiceContext"],
    template: `You are a research analyst working strictly from the sources in this notebook — never invent facts not supported by them. Distill an insight on "{topic}" that a short-form creator can build a video around.
{voiceContext}

Return a tight, evidence-grounded insight (not a summary of everything):
- The single most counterintuitive, surprising, or under-appreciated point the sources actually support — the "angle" worth making content about.
- 2-4 specific, citable facts/figures/quotes from the sources that back it up (name the source where you can).
- Why it matters now / why an audience would care.
- What a generic take on this topic gets wrong, so the creator can differentiate.

Be concrete and specific to what the sources say. If the sources don't support a strong angle, say so plainly rather than padding. Do not describe the notebook or your process — output only the insight.`,
  },
};

/** One section of an editorial infographic: a header and its short bullet phrases. */
export type InfographicSection = { header: string; bullets: string[] };
/** The content fed verbatim into `infographic.editorial` (section III). */
export type ExtractedStructure = { mainTitle: string; sections: InfographicSection[] };

/** Render `sections` into the numbered "Section N — header / 1. bullet" block the editorial prompt expects. */
export function formatContentStructure(structure: ExtractedStructure): string {
  return structure.sections
    .map(
      (section, i) =>
        `Section ${i + 1} — ${section.header}\n` +
        section.bullets.map((bullet, j) => `  ${j + 1}. ${bullet}`).join("\n"),
    )
    .join("\n\n")
    .trim();
}

/** Resolve the full editorial infographic prompt with `structure` filled into section III. */
export function buildEditorialInfographicPrompt(
  structure: ExtractedStructure,
  overrides?: Record<string, string | undefined>,
): string {
  return resolvePrompt(
    "infographic.editorial",
    { mainTitle: structure.mainTitle, contentStructure: formatContentStructure(structure) },
    overrides,
  );
}

/** Fill `{placeholder}` tokens in `template` from `vars` (missing vars become ""). */
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => vars[name] ?? "");
}

/**
 * Resolve one prompt template: the DB override for `key` if present, else the
 * built-in default, with `{placeholder}` tokens filled from `vars`. Pure and
 * synchronous, so both the LLM builders and the orchestrator (for emitting
 * "prompt used" to the dashboard) can call it and get an identical string.
 */
export function resolvePrompt(
  key: PromptKey,
  vars: Record<string, string> = {},
  overrides?: Record<string, string | undefined>,
): string {
  const template = overrides?.[key] ?? PROMPT_DEFAULTS[key].template;
  return fillTemplate(template, vars);
}

/** Load every stored override as a plain `{key: value}` map (DB-backed; empty if none saved). */
export function loadPromptOverrides(db: DB): Record<string, string> {
  const rows = db.select().from(promptOverrides).all();
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

/** Upsert one prompt override. */
export function savePromptOverride(db: DB, key: PromptKey, value: string, now: string): void {
  db.insert(promptOverrides)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: promptOverrides.key, set: { value, updatedAt: now } })
    .run();
}

/** Remove one prompt override, reverting it to the built-in default. */
export function clearPromptOverride(db: DB, key: PromptKey): void {
  db.delete(promptOverrides).where(eq(promptOverrides.key, key)).run();
}
