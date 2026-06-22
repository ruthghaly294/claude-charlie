import { examQuestionInputSchema, type ExamQuestionInput } from "./examQuestions";

export type SupabaseEnv = {
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
  SUPABASE_SERVICE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
};

export type SupabaseSource = { url: string; key: string };

/** Resolve the Supabase REST base URL + key from env (service key preferred over anon). */
export function resolveSupabaseSource(env: SupabaseEnv): SupabaseSource | null {
  const url = env.SUPABASE_URL?.trim();
  const key = (env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY || env.SUPABASE_ANON_KEY)?.trim();
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

/** Fetch raw rows from a PostgREST table (default question_bank). */
export async function fetchQuestionBankRows(
  source: SupabaseSource,
  opts: { table?: string; limit?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>[]> {
  const table = opts.table ?? "question_bank";
  const limit = opts.limit ?? 1000;
  const endpoint = `${source.url}/rest/v1/${table}?select=*&limit=${limit}`;
  const res = await fetchImpl(endpoint, {
    headers: { apikey: source.key, Authorization: `Bearer ${source.key}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase fetch failed (HTTP ${res.status}) for ${table}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) throw new Error("Supabase returned a non-array response");
  return json as Record<string, unknown>[];
}

/**
 * True when a `explanation1` value carries the source data's known auto-generated
 * defects: an unreliable verdict prefix ("This statement is correct/incorrect…",
 * which is often wrong and redundant with the T/F answer), generic filler tails,
 * or it's empty/too short to teach anything. These are the rows worth regenerating.
 */
export function isWeakExplanation(text: unknown): boolean {
  if (typeof text !== "string") return true;
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length < 25) return true;
  return (
    /^This statement is (correct|incorrect)\b/i.test(s) ||
    /\bconforming to fundamental principles\b/i.test(s) ||
    /\boccurs as described as a consequence of the underlying physics\b/i.test(s) ||
    /\bThis reflects the underlying physics of the process described\b/i.test(s)
  );
}

/** PATCH one question_bank row by id (PostgREST). Used to write back regenerated explanations. */
export async function patchQuestionRow(
  source: SupabaseSource,
  id: string,
  fields: Record<string, unknown>,
  opts: { table?: string } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const table = opts.table ?? "question_bank";
  const endpoint = `${source.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`;
  const res = await fetchImpl(endpoint, {
    method: "PATCH",
    headers: {
      apikey: source.key,
      Authorization: `Bearer ${source.key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase PATCH failed (HTTP ${res.status}) for ${table} id=${id}: ${body.slice(0, 200)}`);
  }
}

const SUBTOPIC_KEYS = ["subtopic", "category", "topic", "module", "section", "subject"];
const STATEMENT_KEYS = ["statement", "question_text", "question", "stem", "text", "prompt"];
const ANSWER_KEYS = ["correct_answer", "answer", "correct", "is_correct", "is_true"];
// explanation1 is the concise paragraph (best for a slide); explanation is long markdown.
const EXPLANATION_KEYS = ["explanation1", "explanation", "rationale", "teaching", "notes"];

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
  }
  return undefined;
}

/** Coerce a boolean-ish value (true/1/"true"/"T"/"yes") to a boolean. */
function coerceBool(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1;
  if (typeof raw === "string") return /^(true|t|1|yes)$/i.test(raw.trim());
  return false;
}

const ACRONYMS: Record<string, string> = { ct: "CT", mri: "MRI", pet: "PET" };

/** Humanise a snake_case category into a readable subtopic, e.g. "ct_physics" → "CT physics", "x_ray_physics" → "X-ray physics". */
export function humaniseSubtopic(raw: string): string {
  const words = raw.replace(/-/g, "_").split("_").filter(Boolean);
  const out = words.map((w, i) => {
    const lower = w.toLowerCase();
    if (ACRONYMS[lower]) return ACRONYMS[lower];
    if (lower === "x") return "X-ray"; // "x_ray_physics" → collapse "x ray" into "X-ray"
    if (lower === "ray" && words[i - 1]?.toLowerCase() === "x") return "";
    return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : lower;
  });
  return out.filter(Boolean).join(" ");
}

/**
 * Map one question_bank row (a single true/false statement) to the verified shape.
 * Tolerant of common column names; validated by examQuestionInputSchema so a bad
 * mapping fails loudly rather than posting junk.
 */
export function mapQuestionBankRow(
  row: Record<string, unknown>,
  fallbackSubtopic = "FRCR Physics",
): ExamQuestionInput {
  const rawSubtopic = (pick(row, SUBTOPIC_KEYS) as string) || fallbackSubtopic;
  const statement = pick(row, STATEMENT_KEYS) as string;
  const explanation = (pick(row, EXPLANATION_KEYS) as string) ?? "";
  const difficulty = typeof row.difficulty === "string" ? row.difficulty : undefined;
  const id = row.id ?? row.uuid;

  return examQuestionInputSchema.parse({
    subtopic: humaniseSubtopic(rawSubtopic),
    statement,
    correctAnswer: coerceBool(pick(row, ANSWER_KEYS)),
    explanation,
    difficulty,
    source: id ? `question_bank:${id}` : "question_bank",
  });
}
