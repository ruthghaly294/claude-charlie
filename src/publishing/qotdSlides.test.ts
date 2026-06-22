import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { wrapText, escapeXml, slideToSvg, renderSlidePng, SLIDE_W, SLIDE_H } from "./qotdSlides";
import type { QotdSlide } from "./qotdCarousel";

describe("wrapText", () => {
  it("wraps on word boundaries to the char budget", () => {
    const lines = wrapText("the quick brown fox jumps over", 10);
    expect(lines.every((l) => l.length <= 10)).toBe(true);
    expect(lines.join(" ")).toBe("the quick brown fox jumps over");
  });

  it("splits a word longer than the budget", () => {
    const lines = wrapText("supercalifragilistic", 6);
    expect(lines.every((l) => l.length <= 6)).toBe(true);
    expect(lines.join("")).toBe("supercalifragilistic");
  });
});

describe("escapeXml", () => {
  it("escapes XML-significant characters", () => {
    expect(escapeXml('a < b & c > "d"')).toBe("a &lt; b &amp; c &gt; &quot;d&quot;");
  });
});

describe("slideToSvg", () => {
  const statement: QotdSlide = {
    role: "answer",
    label: "a)",
    statement: "T1 < T2 in most tissues & this matters.",
    answer: false,
    explanation: "In most tissues T1 is greater than T2.",
    subtopic: "MRI physics",
    index: 1,
    total: 5,
    handle: "@frcrbank",
  };

  it("renders the exact statement text (escaped) and the correct answer label", () => {
    const svg = slideToSvg(statement);
    // text may wrap across tspans; reconstruct the tspan contents and confirm it's verbatim.
    const tspanText = (svg.match(/<tspan[^>]*>([^<]*)<\/tspan>/g) ?? [])
      .map((t) => t.replace(/<[^>]+>/g, ""))
      .join(" ");
    expect(tspanText).toContain("a) T1 &lt; T2 in most tissues &amp; this matters.");
    expect(svg).toContain(">FALSE</text>");
    expect(svg).not.toContain(">TRUE</text>");
    expect(svg).toContain("MRI physics · 1/5");
  });

  it("renders a questions slide listing all statements (no answers) with the subtopic and handle", () => {
    const svg = slideToSvg({
      role: "questions",
      subtopic: "CT physics",
      kicker: "FRCR Part 1 Physics",
      prompt: "True or False?",
      items: [
        { label: "a)", statement: "First statement here." },
        { label: "b)", statement: "Second statement here." },
      ],
      handle: "@frcrbank",
    });
    expect(svg).toContain("CT physics");
    expect(svg).toContain("@frcrbank");
    expect(svg).toContain("First statement here.");
    expect(svg).toContain("Second statement here.");
    expect(svg).not.toContain("TRUE");
    expect(svg).not.toContain("FALSE");
  });

  it("rasterises to a valid PNG via sharp", async () => {
    const png = await renderSlidePng(statement);
    expect(png.length).toBeGreaterThan(1000);
    expect(png.slice(1, 4).toString()).toBe("PNG");
  });

  it("transparent mode drops the solid background so it can composite over an image", () => {
    expect(slideToSvg(statement, false)).toContain('fill="url(#bg)"');
    const transparent = slideToSvg(statement, true);
    expect(transparent).not.toContain('fill="url(#bg)"');
    expect(transparent).not.toContain("linearGradient");
    // text is still rendered (verbatim, deterministic)
    expect(transparent).toContain("FALSE");
  });

  it("composites the text over a provided background, keeping the slide canvas size", async () => {
    const background = await sharp({
      create: { width: SLIDE_W, height: SLIDE_H, channels: 3, background: "#efe7d8" },
    })
      .png()
      .toBuffer();
    const png = await renderSlidePng(statement, background);
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(SLIDE_W);
    expect(meta.height).toBe(SLIDE_H);
    expect(png.slice(1, 4).toString()).toBe("PNG");
  });
});
