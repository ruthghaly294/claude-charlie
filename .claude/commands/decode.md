---
description: DECODE intelligence-to-execution loop — discover, curate, observe, decide, execute, feedback, run
allowed-tools: Bash, Read, Write, Glob, Grep
---

# /decode

DECODE continuously scans the outside world for signals, curates them into the
vault, distills them into insights, turns insights into prioritized decisions,
drafts the assets to execute them, and learns from outcomes.

```
DISCOVER → EXTRACT → CURATE → OBSERVE → DECIDE → EXECUTE → FEEDBACK → (loop)
```

It is built on top of `/brain` and shares the same vault (`~/second-brain` by
default). Deterministic stages run in bash via the `decode` CLI; the reasoning
stages (observe / decide / execute) are performed by you, Claude, reading and
writing vault notes. See
`docs/superpowers/specs/2026-04-25-second-brain-design.md` for the brain layer.

## Usage

```
/decode init                 → bootstrap the vault + decode.config.yml
/decode discover             → scan sources → 01-Signals/
/decode curate               → dedup, score, cluster + reindex
/decode observe              → 01-Signals → 25-Insights/   (reasoning)
/decode decide               → 25-Insights → 50-Decisions/ (reasoning)
/decode execute              → top-N decisions → 60-Execution/ (reasoning)
/decode feedback             → 70-Feedback/metrics.* → keyword ranking
/decode run                  → full loop end-to-end + a 4-panel digest
/decode status               → config, sources, vault counts
```

## Resolving the CLI

The `decode` script lives next to `brain`:
`${BRAIN_HOME:-$HOME/.claude/scripts/brain}/decode`. Run it via Bash, forwarding
arguments. Config defaults to `$HOME/second-brain/decode.config.yml` (override
with `DECODE_CONFIG`).

## What to do for each subcommand

### Deterministic (just shell out)

`init`, `discover`, `curate`, `feedback`, `status` → run the `decode` CLI with the
subcommand and stream output back.

### `observe` (Signals → Insights) — reasoning

1. List signal notes: `01-Signals/*.md` (skip `_archive/`). Read their
   frontmatter (`source`, `url`, `score`, `cluster`) and bodies.
2. Group by `cluster`. For extra context on a cluster, use `brain query "<topic>"`
   (hybrid semantic search over the whole vault) — qmd is also an MCP server, so
   you can search mid-reasoning.
3. For each meaningful cluster (skip noise), write one insight note to
   `25-Insights/<date>-<slug>.md` with this frontmatter + body:

   ```
   ---
   type: insight
   created: <ISO8601>
   importance: high|medium|low
   cluster: <cluster>
   evidence: [<links to the source signal notes>]
   ---
   # <trend, one line>

   **What changed:** …
   **Why it matters:** …
   **Recommended action:** …
   ```

   Link evidence with `[[wikilinks]]` to the signal notes.

### `decide` (Insights → Decisions) — reasoning

1. Read all `25-Insights/*.md`.
2. Produce prioritized recommendations across four lanes: **product**,
   **content**, **marketing**, **strategic**. Each goes to
   `50-Decisions/<date>-<slug>.md`:

   ```
   ---
   type: decision
   lane: product|content|marketing|strategic
   created: <ISO8601>
   impact: high|medium|low
   effort: high|medium|low
   priority: <impact/effort score 1–10>
   from_insights: [<links>]
   ---
   # <imperative recommendation, e.g. "Build a viva simulator">

   **Rationale:** … (cite the insights)
   **Success metric:** … (what to measure later — feeds Feedback)
   ```

3. Be concrete and actionable — convert "users struggle with viva" into "Build a
   viva simulator within 90 days", not a restatement of the problem.

### `execute` (top-N Decisions → asset drafts) — reasoning

1. Read `execute.top_n` from `decode.config.yml` (default 3). Pick the highest
   `priority` decisions.
2. For each, draft the appropriate asset into `60-Execution/<date>-<slug>.md`:
   - content lane → a blog post / article draft
   - marketing lane → landing-page copy or an email sequence
   - product lane → a short product spec / user stories
   - strategic lane → a one-page brief
     Frontmatter: `type: execution`, `decision: [[link]]`, `lane`, `status: draft`.
3. These are drafts for human review — do **not** publish, push, or open PRs.

### `run` (full loop)

1. Shell out: `decode discover` then `decode curate` (and `decode feedback` if a
   `70-Feedback/metrics.*` file exists).
2. Then perform `observe` → `decide` → `execute` as above.
3. Finish by printing the 4-panel digest (also shown by the CLI):
   **Signals** (what changed) · **Insights** (what it means) ·
   **Decisions** (what to do) · **Execution** (what shipped/drafted),
   each with counts and the top 3 items.

## Notes

- The vault is a normal Obsidian vault — open `~/second-brain` in Obsidian to
  browse Signals → Insights → Decisions → Execution as a linked graph.
- API-key sources (Google CSE, X/Twitter, Product Hunt) stay disabled until you
  set `enabled: true` in `decode.config.yml` and export the relevant env keys;
  without them those scanners skip silently. `/decode status` shows what is wired.
- Feedback is manual in this version: drop a `keyword,value` CSV at
  `70-Feedback/metrics.csv`, then `/decode feedback` re-weights which keywords
  score higher in the next `curate`.
