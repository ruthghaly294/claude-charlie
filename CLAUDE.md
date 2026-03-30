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
| Command | Purpose |
|---------|---------|
| `/commit-push-pr` | Stage, commit, push, create PR |
| `/verify` | Run tests, types, lint, diff review |
| `/techdebt` | Scan for tech debt (runs in subagent) |
| `/sync-context` | Catch up on recent project state |

## Custom Agents
| Agent | Purpose |
|-------|---------|
| `code-simplifier` | Post-change cleanup and deduplication |
| `verify-app` | Background verification (tests, types, lint) |
| `security-auditor` | Background OWASP security scan |

## Hooks (automatic)
- **PreToolUse**: blocks dangerous commands + protects sensitive files
- **PostToolUse**: auto-formats with Prettier on every edit
- **Notification**: desktop alert when Claude needs input
- **Stop**: verification reminder checklist

## Security
- No secrets in code — use env vars
- Validate all user input server-side
- Parameterized queries only
- Run security-auditor before PRs
