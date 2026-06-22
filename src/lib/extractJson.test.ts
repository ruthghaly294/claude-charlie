import { describe, it, expect } from "vitest";
import { extractJson } from "./extractJson";

describe("extractJson", () => {
  it("parses clean JSON unchanged", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson("  [1, 2, 3]  ")).toEqual([1, 2, 3]);
  });

  it("strips a ```json fenced block", () => {
    const raw = "```json\n{\"exemplars\":[{\"k\":\"v\"}]}\n```";
    expect(extractJson(raw)).toEqual({ exemplars: [{ k: "v" }] });
  });

  it("strips a bare ``` fence", () => {
    expect(extractJson("```\n[true,false]\n```")).toEqual([true, false]);
  });

  it("recovers JSON buried in prose — the **exemplars** crash", () => {
    const raw = '**exemplars** — here is the analysis:\n\n{"exemplars": [{"hookType": "x"}]}\n\nHope that helps!';
    expect(extractJson(raw)).toEqual({ exemplars: [{ hookType: "x" }] });
  });

  it("ignores braces inside string literals when scanning prose", () => {
    const raw = 'note: {"caption": "use {curly} braces", "n": 2} done';
    expect(extractJson(raw)).toEqual({ caption: "use {curly} braces", n: 2 });
  });

  it("repairs raw control characters inside string literals", () => {
    const raw = '{ "cta": "line one\nline two\twith tab" }';
    expect(extractJson(raw)).toEqual({ cta: "line one\nline two\twith tab" });
  });

  it("repairs control chars in prose-wrapped, fenced JSON together", () => {
    const raw = 'Here:\n```json\n{"exemplars":[{"cta":"frame the title\nas breaking news"}]}\n```';
    expect(extractJson(raw)).toEqual({ exemplars: [{ cta: "frame the title\nas breaking news" }] });
  });

  it("does not double-escape already-valid escape sequences", () => {
    expect(extractJson('{"s":"a\\nb"}')).toEqual({ s: "a\nb" });
  });

  it("strips a leaked endoftext sentinel token after the JSON", () => {
    expect(extractJson('{"exemplars":[{"k":"v"}]}<|endoftext|>')).toEqual({ exemplars: [{ k: "v" }] });
  });

  it("recovers a truncated array-of-objects cut off mid-element", () => {
    const raw = '{ "exemplars": [ {"cta":"a"}, {"cta":"b"}, {"cta":"truncat<|endoftext|>';
    expect(extractJson(raw)).toEqual({ exemplars: [{ cta: "a" }, { cta: "b" }] });
  });

  it("recovers a truncated top-level array", () => {
    const raw = '[ {"id":1}, {"id":2}, {"id":';
    expect(extractJson(raw)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("throws a descriptive error when there is no JSON at all", () => {
    expect(() => extractJson("I refuse to answer.")).toThrow(/no parseable JSON/);
  });
});
