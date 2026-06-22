import sharp from "sharp";
import type { QotdSlide, QotdCarousel } from "./qotdCarousel";

/** Instagram portrait carousel canvas (4:5). */
export const SLIDE_W = 1080;
export const SLIDE_H = 1350;
/** Centre line — all text is centred on this so it sits inside the watercolor border. */
const CX = SLIDE_W / 2;
/** Text safe column: keeps wrapped lines off the busy watercolor edges. */
const MARGIN = 150;
const CONTENT_W = SLIDE_W - MARGIN * 2;
/** The readability card is inset this far from each edge, leaving the watercolor border visible. */
const PANEL_INSET = 96;

// On-brand editorial palette (warm neutrals, dark-charcoal ink, muted sage/rust
// accents) matching the watercolor brand background — see prompts.ts
// "infographic.brandBackground". Dark text on a light canvas, per the brand
// title colour rules.
const THEME = {
  bg: "#f5efe3",
  bgAccent: "#e9dcc6",
  ink: "#23271d",
  muted: "#5b5142",
  header: "#3c3528",
  accent: "#b4633a",
  trueColor: "#2f7d4f",
  falseColor: "#b4452f",
  panel: "#fbf7ef",
  font: "Helvetica, Arial, sans-serif",
};

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Greedy word-wrap to an approximate character budget; splits over-long words. */
export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const wordRaw of text.replace(/\s+/g, " ").trim().split(" ")) {
    let word = wordRaw;
    while (word.length > maxChars) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function maxCharsFor(fontSize: number, width = CONTENT_W): number {
  return Math.max(8, Math.floor(width / (fontSize * 0.55)));
}

type TextOpts = { x: number; y: number; size: number; fill: string; weight?: number; anchor?: string; lineGap?: number; width?: number };

function textBlock(content: string, o: TextOpts): { svg: string; nextY: number } {
  const lineHeight = o.size + (o.lineGap ?? Math.round(o.size * 0.35));
  const lines = wrapText(content, maxCharsFor(o.size, o.width));
  const tspans = lines
    .map((ln, i) => `<tspan x="${o.x}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(ln)}</tspan>`)
    .join("");
  const svg = `<text x="${o.x}" y="${o.y}" font-family="${THEME.font}" font-size="${o.size}" font-weight="${o.weight ?? 400}" fill="${o.fill}" text-anchor="${o.anchor ?? "middle"}">${tspans}</text>`;
  return { svg, nextY: o.y + (lines.length - 1) * lineHeight };
}

/**
 * Wrap slide `inner` in the canvas. With `transparent` (compositing over a
 * generated watercolor background) we lay a soft cream "card" inset from the
 * edges — the watercolor border stays visible around it while the centred text
 * sits on a calm, high-contrast surface. Otherwise we paint the warm-neutral
 * brand gradient as a standalone fallback.
 */
function frame(inner: string, transparent = false): string {
  const backdrop = transparent
    ? `<rect x="${PANEL_INSET}" y="${PANEL_INSET}" width="${SLIDE_W - PANEL_INSET * 2}" height="${SLIDE_H - PANEL_INSET * 2}" rx="48" fill="${THEME.panel}" fill-opacity="0.74"/>`
    : `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${THEME.bg}"/><stop offset="1" stop-color="${THEME.bgAccent}"/></linearGradient></defs>
  <rect width="${SLIDE_W}" height="${SLIDE_H}" fill="url(#bg)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_W}" height="${SLIDE_H}" viewBox="0 0 ${SLIDE_W} ${SLIDE_H}">
  ${backdrop}
  ${inner}
</svg>`;
}

function handleFooter(handle: string): string {
  if (!handle) return "";
  return `<text x="${CX}" y="${SLIDE_H - 150}" font-family="${THEME.font}" font-size="36" font-weight="800" fill="${THEME.header}" text-anchor="middle">${escapeXml(handle)}</text>`;
}

// Largest body size (down to a floor) at which the whole question list fits the
// available height — so 5 long statements never overflow the card / footer.
const QUESTION_SIZES = [40, 38, 36, 34, 32, 30, 28, 26, 24] as const;

function fitQuestionList(
  items: { label: string; statement: string }[],
  startY: number,
  availableH: number,
): string {
  const lineGap = 6;
  for (const size of QUESTION_SIZES) {
    const lineHeight = size + lineGap;
    const itemGap = Math.round(size * 0.85);
    const total =
      items.reduce((acc, it) => acc + wrapText(`${it.label} ${it.statement}`, maxCharsFor(size)).length * lineHeight, 0) +
      itemGap * Math.max(0, items.length - 1);
    if (total <= availableH || size === QUESTION_SIZES[QUESTION_SIZES.length - 1]) {
      let y = startY;
      return items
        .map((it) => {
          const b = textBlock(`${it.label} ${it.statement}`, { x: CX, y, size, fill: THEME.ink, weight: 600, lineGap });
          y = b.nextY + lineHeight + itemGap - lineGap;
          return b.svg;
        })
        .join("");
    }
  }
  return "";
}

export function slideToSvg(slide: QotdSlide, transparent = false): string {
  if (slide.role === "questions") {
    const kicker = `<text x="${CX}" y="184" font-family="${THEME.font}" font-size="32" font-weight="700" fill="${THEME.accent}" letter-spacing="4" text-anchor="middle">${escapeXml(slide.kicker.toUpperCase())}</text>`;
    const title = textBlock(slide.subtopic, { x: CX, y: 262, size: 70, fill: THEME.ink, weight: 800 });
    const prompt = textBlock(slide.prompt, { x: CX, y: title.nextY + 70, size: 34, fill: THEME.muted, weight: 600 });
    const footerY = SLIDE_H - 150;
    const startY = prompt.nextY + 80;
    const items = fitQuestionList(slide.items, startY, footerY - 56 - startY);
    return frame(`${kicker}${title.svg}${prompt.svg}${items}${handleFooter(slide.handle)}`, transparent);
  }

  if (slide.role === "answer") {
    const header = `<text x="${CX}" y="220" font-family="${THEME.font}" font-size="34" font-weight="700" fill="${THEME.header}" letter-spacing="1" text-anchor="middle">${escapeXml(slide.subtopic)} · ${slide.index}/${slide.total}</text>`;
    const stmt = textBlock(`${slide.label} ${slide.statement}`, { x: CX, y: 340, size: 52, fill: THEME.ink, weight: 700 });
    const dividerY = stmt.nextY + 80;
    const divider = `<line x1="${CX - 130}" y1="${dividerY}" x2="${CX + 130}" y2="${dividerY}" stroke="${THEME.muted}" stroke-opacity="0.4" stroke-width="3"/>`;
    const answerY = dividerY + 130;
    const answerColor = slide.answer ? THEME.trueColor : THEME.falseColor;
    const answerText = slide.answer ? "TRUE" : "FALSE";
    const badge = `<text x="${CX}" y="${answerY}" font-family="${THEME.font}" font-size="92" font-weight="800" fill="${answerColor}" text-anchor="middle">${answerText}</text>`;
    const expl = textBlock(slide.explanation, { x: CX, y: answerY + 96, size: 36, fill: THEME.ink });
    return frame(`${header}${stmt.svg}${divider}${badge}${expl.svg}${handleFooter(slide.handle)}`, transparent);
  }

  // cta
  let y = 480;
  const lines = slide.lines
    .map((l) => {
      const b = textBlock(l, { x: CX, y, size: 54, fill: THEME.ink, weight: 700 });
      y = b.nextY + 120;
      return b.svg;
    })
    .join("");
  return frame(`${lines}${handleFooter(slide.handle)}`, transparent);
}

/**
 * Render one slide to a PNG buffer. The TEXT is always deterministic SVG (exact,
 * never AI) so medical statements stay verbatim. When `background` (a generated
 * on-brand watercolor canvas sized to the slide) is provided, the text layer is
 * composited over it; otherwise the warm-neutral brand gradient is used.
 */
export async function renderSlidePng(slide: QotdSlide, background?: Buffer | null): Promise<Buffer> {
  if (background) {
    const text = Buffer.from(slideToSvg(slide, true));
    return sharp(background).composite([{ input: text }]).png().toBuffer();
  }
  return sharp(Buffer.from(slideToSvg(slide))).png().toBuffer();
}

/** Render every slide of a carousel to PNG buffers, in order, optionally over a shared background. */
export async function renderCarouselPngs(carousel: QotdCarousel, background?: Buffer | null): Promise<Buffer[]> {
  return Promise.all(carousel.slides.map((s) => renderSlidePng(s, background)));
}
