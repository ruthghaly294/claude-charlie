import type { BrandConfig } from "@/discovery/config";
import type { ExamQuestion } from "@/db/schema";

/** A single rendered carousel slide. The medical text is verbatim from verified questions. */
export type QotdSlide =
  | {
      role: "questions";
      subtopic: string;
      kicker: string;
      prompt: string;
      items: { label: string; statement: string }[];
      handle: string;
    }
  | {
      role: "answer";
      label: string;
      statement: string;
      answer: boolean;
      explanation: string;
      subtopic: string;
      index: number;
      total: number;
      handle: string;
    }
  | { role: "cta"; lines: string[]; handle: string };

export type QotdCarousel = {
  subtopic: string;
  slides: QotdSlide[];
  /** Full Instagram caption (insight stated up front per the caption rule), no hashtags. */
  caption: string;
  hashtags: string[];
};

const LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];

function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : cleaned).trim();
}

/**
 * Turn a raw, often auto-generated source explanation into a clean one-sentence
 * takeaway. The source data carries two systematic defects: an UNRELIABLE verdict
 * prefix ("This statement is correct/incorrect…" — frequently wrong, e.g. "correct"
 * on a false item, and redundant with the TRUE/FALSE badge) and generic filler
 * tails ("…occurs as described as a consequence of the underlying physics…"). We
 * strip both so the slide never contradicts its own badge, then take the first
 * substantive sentence. The remaining medical text is verbatim from the source.
 */
export function cleanExplanation(text: string): string {
  let s = text.replace(/\s+/g, " ").trim();
  s = s.replace(/^This statement is (?:correct|incorrect)\b[\s.,:;-]*(?:because\s+|as\s+|since\s+)?/i, "");
  s = s.replace(/\s*\boccurs as described as a consequence of the underlying physics\b.*$/i, ".");
  s = s.replace(/\s*\bThis reflects the underlying physics of the process described\.?/i, "");
  s = s.replace(/\s*,?\s*with causes and effects conforming to fundamental principles\.?/i, ".");
  s = s.trim();
  const out = firstSentence(s) || firstSentence(text);
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}

/** The concrete, correct fact a statement teaches: the statement itself if true, else the explanation's correction. */
function factFromQuestion(q: ExamQuestion): string {
  return q.correctAnswer ? q.statement.trim() : cleanExplanation(q.explanation);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function buildHashtags(subtopic: string): string[] {
  const base = ["frcr", "frcrphysics", "frcrpart1", "radiology", "radiologyregistrar", "radres"];
  const topicTag = slug(subtopic);
  return Array.from(new Set([...base, topicTag])).filter((t) => t.length > 1).slice(0, 8);
}

/**
 * Assemble a standardized Question-of-the-Day carousel from a set of verified
 * statements (one subtopic). Structure: ONE questions slide listing all
 * statements (no answers — the viewer commits before swiping) → one answer slide
 * per statement (restated statement + revealed TRUE/FALSE + concise explanation)
 * → CTA. Deterministic: the medical content is copied verbatim, never generated.
 */
export function buildQotdCarousel(questions: ExamQuestion[], brand: BrandConfig): QotdCarousel {
  if (questions.length === 0) throw new Error("buildQotdCarousel: no questions provided");
  const subtopic = questions[0]!.subtopic;
  const total = questions.length;
  const labelFor = (i: number) => `${LETTERS[i] ?? String(i + 1)})`;

  const questionsSlide: QotdSlide = {
    role: "questions",
    subtopic,
    kicker: "FRCR Part 1 Physics",
    prompt: "True or False? Decide each, then swipe for the answers",
    items: questions.map((q, i) => ({ label: labelFor(i), statement: q.statement.trim() })),
    handle: brand.handle,
  };

  const answerSlides: QotdSlide[] = questions.map((q, i) => ({
    role: "answer",
    label: labelFor(i),
    statement: q.statement.trim(),
    answer: q.correctAnswer,
    explanation: cleanExplanation(q.explanation),
    subtopic,
    index: i + 1,
    total,
    handle: brand.handle,
  }));

  const ctaLines = [brand.ctaPrimary, brand.ctaSecondary].filter((l) => l && l.trim());
  const cta: QotdSlide = { role: "cta", lines: ctaLines, handle: brand.handle };

  const caption = [
    factFromQuestion(questions[0]!),
    `${total} ${subtopic} true/false statements every FRCR Part 1 candidate should nail — answers and explanations in the slides.`,
    ctaLines.join("\n"),
  ]
    .filter((p) => p && p.trim())
    .join("\n\n")
    .trim();

  return { subtopic, slides: [questionsSlide, ...answerSlides, cta], caption, hashtags: buildHashtags(subtopic) };
}

/** Compose the final post text (caption + hashtags), mirroring the trend pipeline's composePostText. */
export function composeQotdPostText(carousel: QotdCarousel): string {
  const tags = carousel.hashtags.map((h) => `#${h}`).join(" ");
  return tags ? `${carousel.caption}\n\n${tags}` : carousel.caption;
}
