/**
 * Tolerantly pull a JSON value out of an LLM completion. Even with
 * `response_format: json_schema` and `strict: true`, some models (notably
 * gpt-oss) wrap the payload in a ```json fence or prepend prose/reasoning such
 * as `**exemplars**: { ... }`. A raw `JSON.parse` throws on those, so every
 * structured-output call site routes its `res.content` through here first.
 *
 * Strategy, cheapest first:
 *  1. Parse the trimmed string as-is (the happy path when the model behaves).
 *  2. Strip leaked model sentinel tokens (`<|endoftext|>`, `<|im_end|>`, …).
 *  3. Strip a single Markdown code fence and retry.
 *  4. Scan for the first balanced `{...}` or `[...]`, string/escape aware, and
 *     parse that — this rescues payloads buried in surrounding prose.
 *  5. Repair a truncated array-of-objects (model cut off mid-stream) by closing
 *     at the last complete element.
 * Each candidate is also retried with raw control characters inside strings
 * escaped, since models frequently emit literal newlines/tabs in string values.
 */
export function extractJson(raw: string): unknown {
  if (typeof raw !== "string") {
    throw new TypeError(`extractJson expected a string, got ${typeof raw}`);
  }

  const trimmed = raw.trim();
  const cleaned = stripSentinelTokens(trimmed);
  const candidates = [
    trimmed,
    cleaned,
    stripFence(cleaned),
    firstBalanced(cleaned),
    repairTruncated(cleaned),
  ];

  let lastError: unknown;
  for (const candidate of candidates) {
    if (!candidate) continue;
    // Try the candidate verbatim first, then a control-char-repaired version:
    // models often emit raw newlines/tabs inside string values ("Bad control
    // character in string literal"), which are illegal in JSON but trivially
    // fixable by escaping them.
    for (const text of [candidate, escapeControlChars(candidate)]) {
      try {
        return JSON.parse(text);
      } catch (err) {
        lastError = err;
      }
    }
  }

  const preview = trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
  throw new Error(
    `extractJson: no parseable JSON in model output (${(lastError as Error)?.message ?? "unknown"}). Got: ${preview}`,
  );
}

/**
 * Escape raw control characters (newlines, tabs, etc.) that appear *inside*
 * string literals, where JSON forbids them. Control chars between tokens are
 * legal whitespace and left untouched. String/escape aware so an already-valid
 * `\n` (backslash + n) is not double-escaped.
 */
function escapeControlChars(s: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        out += ch;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        out += ch;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += code === 0x0a ? "\\n" : code === 0x0d ? "\\r" : code === 0x09 ? "\\t" : `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

/**
 * Strip leaked model control tokens such as `<|endoftext|>`, `<|im_end|>`,
 * `<|eot_id|>`, or `<|return|>`. gpt-oss/Harmony-style models sometimes emit
 * these inside or after the JSON, which `JSON.parse` rejects with
 * "Unexpected token '<'".
 */
function stripSentinelTokens(s: string): string {
  return s.replace(/<\|[^|>]*\|>/g, "");
}

/**
 * Recover a truncated array-of-objects payload — the shape every structured
 * extractor here emits — when the model stops mid-stream (hit max_tokens or a
 * leaked end token). Walks the string, string/escape aware, tracking the open
 * bracket stack, and remembers the last index at which an *array element*
 * completed. Cutting there and closing the still-open containers drops the
 * half-written trailing element and yields valid JSON. Returns null when no
 * such clean boundary exists.
 */
function repairTruncated(s: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let cutAt = -1;
  let cutStack: string[] | null = null;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      stack.pop();
      // A completed container whose parent is an array = a clean element end.
      if (stack[stack.length - 1] === "[") {
        cutAt = i;
        cutStack = [...stack];
      }
    }
  }

  if (cutAt === -1 || !cutStack) return null;
  const closers = cutStack
    .reverse()
    .map((c) => (c === "{" ? "}" : "]"))
    .join("");
  return s.slice(0, cutAt + 1) + closers;
}

/** Remove a single leading/trailing Markdown code fence, e.g. ```json … ```. */
function stripFence(s: string): string | null {
  const fence = /^```(?:json|jsonc)?\s*\n?([\s\S]*?)\n?```$/i.exec(s);
  return fence && fence[1] != null ? fence[1].trim() : null;
}

/**
 * Return the first balanced JSON object or array embedded in `s`, tracking
 * string literals and escapes so braces inside strings don't throw off the
 * depth count. Returns null when there is no complete structure.
 */
function firstBalanced(s: string): string | null {
  const start = firstOf(s, "{", "[");
  if (start === -1) return null;

  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function firstOf(s: string, a: string, b: string): number {
  const ia = s.indexOf(a);
  const ib = s.indexOf(b);
  if (ia === -1) return ib;
  if (ib === -1) return ia;
  return Math.min(ia, ib);
}
