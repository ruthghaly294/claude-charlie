# Ultimate Claude Code Template — Full-Stack TypeScript

> Opinionated starter kit combining citypaul skills, Superpowers, and GSD
> with Boris Cherny's team practices. Config only — bring your own code.

## Setup

Run `./setup.sh` to install global tools. See README.md for details.

## Workflow (Mandatory Order)

1. PLAN — Start in plan mode (Shift+Tab x2). Get plan approved.
2. RED — Write failing test first. No exceptions.
3. GREEN — Minimum code to pass.
4. MUTATE — Run mutation-testing skill, produce report.
5. KILL MUTANTS — Address survivors.
6. REFACTOR — Only if it adds value.
7. VERIFY — Run /verify before declaring done.
8. COMMIT — Run /commit-push-pr when approved.

## Tech Stack

- Next.js 16, TypeScript strict, Tailwind v4, shadcn/ui
- Drizzle ORM, PostgreSQL, NextAuth v5
- Vitest + Testing Library, Playwright for E2E
- Vercel AI SDK for LLM interactions

## Conventions

- TDD is non-negotiable (load `tdd` skill for patterns)
- No `any` types ever (load `typescript-strict` skill)
- Immutable data, pure functions (load `functional` skill)
- Test behavior not implementation (load `testing` skill)
- Conventional commits: type(scope): description
- Never commit directly to main
- Repository pattern for all DB access
- Services orchestrate business logic
- No line-level comments — code is self-documenting

## Custom Commands

| Command           | Purpose                               |
| ----------------- | ------------------------------------- |
| `/commit-push-pr` | Stage, commit, push, create PR        |
| `/verify`         | Run tests, types, lint, diff review   |
| `/techdebt`       | Scan for tech debt (runs in subagent) |
| `/sync-context`   | Catch up on recent project state      |

## Custom Agents

| Agent              | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `code-simplifier`  | Post-change cleanup and deduplication        |
| `verify-app`       | Background verification (tests, types, lint) |
| `security-auditor` | Background OWASP security scan               |

## Second Brain — auto-context reflex

You have access to the `qmd` MCP server, which indexes the user's personal
knowledge vault at `~/second-brain/`. Treat it as the user's long-term memory.

**Use the qmd `query` tool by reflex when:**
- The user asks about something they may have read, captured, or discussed before
  ("what did I learn about X?", "have I seen this?", "remind me of…")
- The user references prior work, decisions, or notes
- A question would be answered better with cited prior context than from
  general knowledge alone
- The user pastes or references a topic that maps cleanly to vault content

**Do NOT call qmd for:**
- Pure code generation, refactoring, or implementation tasks
- Questions that have nothing to do with the user's saved knowledge
- Trivial factual lookups answerable from your training

When you do call qmd, cite the result file paths so the user can open them in
Obsidian (`~/second-brain/...`).

## Hooks (automatic)

- **PreToolUse**: blocks dangerous commands + protects sensitive files
- **PostToolUse**: auto-formats with Prettier on every edit
- **Notification**: desktop alert when Claude needs input
- **Stop**: verification reminder checklist

## gstack

Use the `/browse` skill from gstack for **all web browsing**. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills:
`/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`

## Security

- No secrets in code — use env vars
- Validate all user input server-side
- Parameterized queries only
- Run security-auditor before PRs
