type Rule = { type: "allow" | "disallow"; pattern: string };
export type RobotsRules = Rule[];

function patternToRegex(pattern: string): RegExp {
  const endAnchor = pattern.endsWith("$");
  const body = endAnchor ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + escaped + (endAnchor ? "$" : ""));
}

/**
 * Parse a robots.txt body into the rules that apply to `userAgent`. The group
 * whose `User-agent:` token matches `userAgent` (case-insensitive substring)
 * wins; falls back to the `*` group(s) when there's no specific match.
 */
export function parseRobots(body: string, userAgent: string): RobotsRules {
  const ua = userAgent.toLowerCase();
  const lines = body.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());

  type Group = { agents: string[]; rules: Rule[] };
  const groups: Group[] = [];
  let current: Group | null = null;

  for (const line of lines) {
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();

    if (field === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === "allow" || field === "disallow") {
      if (!current) continue;
      if (value) current.rules.push({ type: field, pattern: value });
    }
  }

  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const wildcard = groups.filter((g) => g.agents.includes("*"));
  const matched = specific.length > 0 ? specific : wildcard;
  return matched.flatMap((g) => g.rules);
}

/** True if `path` is allowed by `rules` (longest pattern match wins; ties favour Allow). */
export function isAllowedByRules(rules: RobotsRules, path: string): boolean {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!patternToRegex(rule.pattern).test(path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.type === "allow")
    ) {
      best = rule;
    }
  }
  return best ? best.type === "allow" : true;
}

export type RobotsCheckOptions = {
  fetchImpl?: typeof fetch;
  /** per-origin robots.txt body cache; pass a shared Map to cache across calls */
  cache?: Map<string, string | null>;
};

const sharedCache = new Map<string, string | null>();

/**
 * Fetch (and cache, per origin) robots.txt for `url` and check whether
 * `userAgent` may fetch its path. Fails open (returns true) if robots.txt
 * can't be fetched or parsed — a hiccup here must never block the scrape.
 */
export async function isAllowed(
  url: string,
  userAgent: string,
  opts: RobotsCheckOptions = {},
): Promise<boolean> {
  const { fetchImpl = fetch, cache = sharedCache } = opts;
  const u = new URL(url);
  const origin = u.origin;

  let body = cache.get(origin);
  if (body === undefined) {
    try {
      const res = await fetchImpl(`${origin}/robots.txt`, {
        headers: { "user-agent": userAgent },
      });
      body = res.ok ? await res.text() : null;
    } catch {
      body = null;
    }
    cache.set(origin, body);
  }

  if (body === null) return true;
  return isAllowedByRules(parseRobots(body, userAgent), u.pathname);
}
