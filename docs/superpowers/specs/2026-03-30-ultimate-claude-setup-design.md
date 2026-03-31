# Design: Ultimate Claude Code Setup Template

**Date:** 2026-03-30
**Status:** Approved
**Branch:** feat/ultimate-claude-setup

## Purpose

An opinionated Claude Code starter kit for full-stack TypeScript projects (Next.js + Drizzle + Auth). Combines Boris Cherny's team practices, citypaul/.dotfiles skills framework, Superpowers plugin workflows, and GSD project management into a layered, production-grade template.

Developers clone this repo, run a bootstrap script, and get a fully configured Claude Code environment with enforced TDD, automated formatting, security scanning, and inner-loop workflow automation.

## Decisions

- **Template repo, no sample app** — configuration files only; developers bring their own code
- **Layered architecture** — bootstrap script for global tools, project `.claude/` for project-specific config, lean CLAUDE.md for conventions
- **Heavily opinionated** — TDD mandatory, hooks enforce rules, strict TypeScript, full Boris workflow (plan mode first, subagent verification)
- **Bootstrap script included** — installs global tools automatically, idempotent and safe to re-run
- **Full-stack TypeScript target** — Next.js 16 + Drizzle + NextAuth v5 + Vitest + Playwright

## Architecture

```
claude-charlie/
├── setup.sh                             # Layer 1: Bootstrap (global tools)
├── CLAUDE.md                            # Layer 3: Documentation (project conventions)
├── README.md                            # Layer 3: Documentation (setup guide)
├── .claude/
│   ├── settings.json                    # Layer 2: Project (hooks + permissions)
│   ├── commands/
│   │   ├── commit-push-pr.md            # Git workflow automation
│   │   ├── verify.md                    # Full verification pipeline
│   │   ├── techdebt.md                  # Tech debt scanner
│   │   └── sync-context.md             # Project state awareness
│   ├── agents/
│   │   ├── code-simplifier.md           # Post-change cleanup
│   │   ├── verify-app.md               # Background verification
│   │   └── security-auditor.md          # OWASP security scanning
│   ├── skills/
│   │   └── project-onboarding/
│   │       └── SKILL.md                 # Auto-loaded onboarding context
│   └── hooks/
│       ├── safety-check.sh              # Blocks dangerous commands
│       └── protect-files.sh             # Blocks edits to sensitive files
├── .mcp.json                            # GitHub MCP server config
└── docs/
    └── superpowers/
        └── specs/
            └── this file
```

### Layer 1: Bootstrap Script (`setup.sh`)

Installs global tools to `~/.claude/`. Idempotent, safe to re-run.

**Execution order:**

1. **Prerequisite check** — verify `node`, `npm`, `claude`, `gh` are installed. Hard fail with clear error messages if missing.
2. **Backup existing config** — if `~/.claude/` exists, create timestamped backup at `~/.claude.backup-YYYYMMDD-HHMMSS/`.
3. **Install citypaul dotfiles** — `curl -fsSL https://raw.githubusercontent.com/citypaul/.dotfiles/main/install-claude.sh | bash`
4. **Install plugins** — enable in settings.json:
   - `superpowers@claude-plugins-official`
   - `claude-md-management@claude-plugins-official`
   - `skill-creator@claude-plugins-official`
   - `atlassian@claude-plugins-official`
5. **Install GSD** — if `~/.claude/get-shit-done/` doesn't exist, install via the GSD install script. If it already exists, skip.
6. **Merge settings** — merge plugin/hook entries into `~/.claude/settings.json` preserving existing user config.
7. **Verify installation** — check key directories/files exist, report success/failure per component.
8. **Copy project template** — copy `.claude/`, `CLAUDE.md`, `.mcp.json` into current project if they don't exist.

**Prerequisites:** Node.js >= 18, Claude Code CLI, GitHub CLI (`gh`).

### Layer 2: Project Configuration (`.claude/`)

#### Settings (`settings.json`)

**PreToolUse hooks:**

| Matcher | Script | Behavior |
|---------|--------|----------|
| `Bash` | `safety-check.sh` | Blocks `rm -rf /`, `git push --force main`, `git reset --hard`, `DROP TABLE`. Exit code 2 with feedback. |
| `Edit\|Write` | `protect-files.sh` | Blocks edits to `.env`, `package-lock.json`, `.git/`, `*.generated.ts`. Feedback tells Claude to edit templates instead. |

**PostToolUse hooks:**

| Matcher | Command | Behavior |
|---------|---------|----------|
| `Edit\|Write` | `jq -r '.tool_input.file_path' \| xargs npx prettier --write 2>/dev/null \|\| true` | Auto-format. Falls back gracefully. |
| `Edit\|Write` | `jq -r '.tool_input.file_path' \| xargs npx eslint --fix 2>/dev/null \|\| true` | Auto-lint. Falls back gracefully. |

**Notification hook:**
- `notify-send 'Claude Code' 'Claude Code needs your attention'` (Linux)
- macOS fallback detection via `command -v osascript`

**Stop hook:**
- Prints verification checklist. Nudges Claude to run `/verify` if it hasn't.

**Permission pre-allows:**
```
Bash(git status), Bash(git diff*), Bash(git log*), Bash(git branch*),
Bash(npm test*), Bash(npm run lint*), Bash(npm run build*),
Bash(npx prettier*), Bash(npx eslint*), Bash(npx tsc*),
Bash(ls*), Bash(cat*), Bash(gh pr*), Bash(gh issue*)
```

**Environment:**
```json
{ "CLAUDE_THINKING_BUDGET_TOKENS": "10000" }
```

#### Commands

All commands use `disable-model-invocation: true` (user-triggered only).

**`/commit-push-pr`** — Git workflow automation
- Pre-computes context: `!`git status``, `!`git log --oneline -5``, `!`git diff --stat``
- Enforces conventional commits: `feat|fix|docs|refactor|test|chore(scope): description`
- Creates PR via `gh pr create` with structured body
- Asks confirmation before each step (commit, push, PR)

**`/verify`** — Full verification pipeline
- Runs in order: `npm test` -> `npx tsc --noEmit` -> `npm run lint` -> `git diff main...HEAD --stat`
- Reports pass/fail per step, stops on failure with suggested fix
- Summarizes changes at the end

**`/techdebt`** — Tech debt scanner
- `context: fork`, `agent: Explore` (read-only subagent)
- Scans for: TODOs/FIXMEs/HACKs, duplicate patterns, unused exports, files > 300 lines, functions > 30 lines, nesting > 3 levels
- Prioritized report grouped by severity

**`/sync-context`** — Project state awareness
- Pre-computes: `!`git log --oneline -20``, `!`git status``, `!`git diff --stat HEAD~5``, `!`git branch -a``
- Summarizes recent activity, branch state, pending work

#### Agents

**`code-simplifier`**
- Model: `sonnet`
- Tools: Read, Grep, Glob, Edit, Write
- Skills: `refactoring` (preloaded)
- Purpose: Review recently changed files. Reduce duplication, simplify logic, improve naming. Follow functional programming style. Keep changes minimal.

**`verify-app`**
- Model: `sonnet`
- Tools: Bash, Read, Grep, Glob (no write)
- Background: `true`
- Purpose: Run full verification pipeline. Check for console.log/debugger statements, skipped tests (.skip/.only). Report pass/fail per step.

**`security-auditor`**
- Model: `sonnet`
- Tools: Read, Grep, Glob (read-only)
- Background: `true`
- Purpose: Scan for OWASP Top 10: secrets in code, SQL injection, XSS, missing validation, insecure dependencies, hardcoded URLs, missing auth checks. Report with file path, line number, severity, suggested fix. No false positives.

#### Skills

**`project-onboarding`**
- `user-invocable: false` (Claude loads automatically when onboarding context is needed)
- Explains how all pieces fit together (skills + agents + hooks + commands + GSD + Superpowers)
- Maps which tool to use for which situation
- References hello files as learning material

### Layer 3: Documentation

#### CLAUDE.md (< 100 lines)

Covers:
- Project identity (what this template is)
- Mandatory workflow order: PLAN -> RED -> GREEN -> MUTATE -> KILL MUTANTS -> REFACTOR -> VERIFY -> COMMIT
- Tech stack (Next.js 16, TS strict, Tailwind v4, shadcn/ui, Drizzle, NextAuth v5, Vitest, Playwright, Vercel AI SDK)
- Conventions (TDD, no `any`, immutable data, pure functions, conventional commits, repository pattern, service layer, no line comments)
- Custom commands reference table
- Custom agents reference table
- Hooks behavior summary
- Security rules

Points to skills for detail. No duplication of skill content.

#### README.md

Four sections:
1. **What this is** — one paragraph overview
2. **Quick start** — clone, `./setup.sh`, `cd project && claude`
3. **What you get** — table of all layers with one-line descriptions
4. **Architecture** — ASCII diagram of layer connections

#### .mcp.json

GitHub MCP server only:
```json
{
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

## Tool Integration Map

```
User Session
|
+-- Superpowers Plugin (global)
|   +-- /brainstorming           -> Before creative/design work
|   +-- /test-driven-development -> RED-GREEN-REFACTOR enforcement
|   +-- /systematic-debugging    -> Bug investigation
|   +-- /writing-plans           -> Spec -> implementation plan
|   +-- /executing-plans         -> Plan -> code with subagents
|   +-- /verification-before-completion -> Final quality gate
|   +-- /requesting-code-review  -> Post-implementation review
|
+-- GSD Plugin (global)
|   +-- /gsd:new-project         -> Initialize with research
|   +-- /gsd:plan-phase          -> Detailed phase planning
|   +-- /gsd:execute-phase       -> Execute with atomic commits
|   +-- /gsd:verify-work         -> Validate features
|   +-- /gsd:debug               -> Scientific method debugging
|   +-- /gsd:ship                -> PR + review + ship
|
+-- citypaul Skills (global, on-demand)
|   +-- tdd, testing, mutation-testing, refactoring
|   +-- typescript-strict, functional
|   +-- planning, frontend-design
|   +-- hexagonal-architecture, domain-driven-design, twelve-factor
|   +-- accessibility, performance, seo, core-web-vitals
|
+-- Project Commands (.claude/commands/)
|   +-- /commit-push-pr          -> Git workflow automation
|   +-- /verify                  -> Full verification pipeline
|   +-- /techdebt                -> Tech debt scan (subagent)
|   +-- /sync-context            -> Project state awareness
|
+-- Project Agents (.claude/agents/)
|   +-- code-simplifier          -> Post-change cleanup
|   +-- verify-app               -> Background verification
|   +-- security-auditor         -> OWASP scanning
|
+-- Hooks (.claude/settings.json)
    +-- PreToolUse               -> Safety + file protection
    +-- PostToolUse              -> Auto-format + auto-lint
    +-- Notification             -> Desktop alerts
    +-- Stop                     -> Verification reminder
```

## What Is NOT Included

- No sample application code — developers bring their own
- No database setup or migration scripts
- No CI/CD pipeline config (project-specific concern)
- No Docker/deployment config
- No environment variable values (only `.env.example` patterns in CLAUDE.md)
