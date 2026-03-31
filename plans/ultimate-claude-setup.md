# Plan: Ultimate Claude Code Setup

**Branch**: feat/ultimate-claude-setup
**Status**: Active

## Goal

Configure this project with a production-grade Claude Code setup that combines Boris Cherny's best practices, citypaul/.dotfiles skills framework, Superpowers plugin workflows, and GSD project management — creating a fully integrated, team-ready development environment.

## Context & Sources

This plan synthesizes guidance from:
- **hello**: Project structure reference (MLTUT / Brij Kishore Pandey)
- **hello1**: Terminal setup docs (notifications, line breaks, vim mode)
- **hello2**: Skills documentation (creating, configuring, sharing skills)
- **hello3**: Subagents documentation (built-in + custom agents)
- **hello4**: Hooks documentation (auto-format, notifications, file protection)
- **hello5**: Boris Cherny's personal 13-tip setup
- **hello6**: Boris's 10 team-sourced tips
- **hello7**: Workflow orchestration principles (plan mode, subagents, verification)
- **hello8**: Example CLAUDE.md for a Next.js/Drizzle/shadcn project
- **hello9**: Global Claude configuration template (SOLID, KISS, YAGNI)

Already installed at `~/.claude/`:
- **citypaul/.dotfiles**: CLAUDE.md (TDD core), 22 skills, 5 commands, 10+ agents
- **Superpowers plugin**: brainstorming, TDD, debugging, code review, parallel agents, verification
- **GSD plugin**: project lifecycle, phases, execution, verification, session management
- **Atlassian plugin**: Jira/Confluence integration
- **Skill creator plugin**: skill authoring assistance
- **Claude MD management plugin**: CLAUDE.md improvement workflows

## Acceptance Criteria

- [ ] Project has a `.claude/` directory with project-specific settings, commands, agents, and skills
- [ ] `settings.json` configures hooks (PostToolUse formatter, PreToolUse file protection, Notification alerts, Stop verification)
- [ ] `.mcp.json` configures GitHub MCP server for PR/issue workflows
- [ ] Custom slash commands exist for inner-loop workflows (`commit-push-pr`, `verify`, `techdebt`, `sync-context`)
- [ ] Custom subagents exist for project-specific tasks (`code-simplifier`, `verify-app`, `security-auditor`)
- [ ] Project-level CLAUDE.md ties together all installed tools with project conventions
- [ ] Permission pre-allows are configured to reduce prompts for safe commands
- [ ] The setup works end-to-end: a developer can clone, run `/setup`, and have full Claude Code capabilities

## Steps

This plan is broken into multiple small PRs. Each PR is independently mergeable.

---

### PR 1: Project Structure & Settings Foundation

#### Step 1: Create `.claude/` directory structure

**RED**: Write a test script (`.claude/hooks/test-setup.sh`) that verifies the expected directory structure exists: `.claude/settings.json`, `.claude/commands/`, `.claude/agents/`, `.claude/skills/`.
**GREEN**: Create the directory structure with minimal placeholder files.
**MUTATE**: Run `mutation-testing` skill on the test script.
**KILL MUTANTS**: Address any surviving mutants.
**REFACTOR**: Ensure directory naming follows conventions from hello (project layout reference).
**Done when**: `ls .claude/` shows `settings.json`, `commands/`, `agents/`, `skills/` directories.

#### Step 2: Configure `settings.json` with hooks and permissions

**RED**: Write a test that validates `settings.json` is valid JSON and contains required keys: `hooks`, `permissions`.
**GREEN**: Create `.claude/settings.json` with:
- **PreToolUse hook** (Bash matcher): safety check script that blocks dangerous commands (`rm -rf /`, `git push --force main`)
- **PostToolUse hook** (Edit|Write matcher): auto-format with Prettier/ESLint (if available) or a no-op placeholder
- **Notification hook**: desktop notification when Claude needs input (Linux `notify-send`)
- **Stop hook**: verification reminder that prompts "Did you run tests?"
- **Permission pre-allows**: `git status`, `git diff`, `git log`, `git branch`, `npm test`, `npm run lint`, `npm run build`, `ls`, `cat`, `echo`
- **Environment**: `CLAUDE_THINKING_BUDGET_TOKENS: "10000"`
**MUTATE**: Run `mutation-testing` skill.
**KILL MUTANTS**: Address surviving mutants.
**REFACTOR**: Ensure hook commands are idempotent and fast (< 1s timeout).
**Done when**: `/hooks` in Claude Code shows all configured hooks; safe commands run without permission prompts.

#### Step 3: Configure `.mcp.json` for GitHub integration

**RED**: Write a test that validates `.mcp.json` is valid JSON with `mcpServers.github` key.
**GREEN**: Create `.mcp.json` with GitHub MCP server config using `GITHUB_TOKEN` env var.
**MUTATE**: Run `mutation-testing` skill.
**KILL MUTANTS**: Address surviving mutants.
**REFACTOR**: Ensure env vars use `${VAR}` substitution pattern.
**Done when**: `.mcp.json` exists and is valid; GitHub MCP is configured.

---

### PR 2: Custom Slash Commands (Inner-Loop Workflows)

Based on Boris's tip #7: "I use slash commands for every inner loop workflow."

#### Step 4: Create `/commit-push-pr` command

**RED**: Write a test that the command file exists and contains required sections (inline bash for git status, commit message template, PR creation).
**GREEN**: Create `.claude/commands/commit-push-pr.md` with:
- Inline bash (`!`git status``, `!`git log --oneline -5``) for pre-computed context
- Conventional commit message format enforcement
- PR creation via `gh pr create`
- `disable-model-invocation: true` (user-only, per Boris's safety tip)
**MUTATE**: Run `mutation-testing` skill.
**KILL MUTANTS**: Address surviving mutants.
**REFACTOR**: Ensure the command is concise (< 50 lines).
**Done when**: `/commit-push-pr` appears in Claude Code's command list.

#### Step 5: Create `/verify` command

**RED**: Write a test that the command file exists and includes verification checklist.
**GREEN**: Create `.claude/commands/verify.md` with:
- Run tests (`npm test`)
- Run type check (`npx tsc --noEmit`)
- Run linter (`npm run lint`)
- Diff against main branch
- Summary of what changed and why
- `disable-model-invocation: true`
**MUTATE**: Run `mutation-testing` skill.
**KILL MUTANTS**: Address surviving mutants.
**REFACTOR**: Review against Boris tip #13 ("give Claude a way to verify its work").
**Done when**: `/verify` runs the full verification pipeline.

#### Step 6: Create `/techdebt` command

**RED**: Write a test that the command file exists.
**GREEN**: Create `.claude/commands/techdebt.md` with:
- Scan for code duplication
- Find TODOs/FIXMEs/HACKs
- Check for unused exports/imports
- Report findings with priority ranking
- `context: fork` + `agent: Explore` (runs in subagent to preserve context)
**MUTATE**: Run `mutation-testing` skill.
**KILL MUTANTS**: Address surviving mutants.
**REFACTOR**: Ensure it uses the Explore agent for read-only analysis.
**Done when**: `/techdebt` produces a structured report.

#### Step 7: Create `/sync-context` command

**RED**: Write a test that the command file exists.
**GREEN**: Create `.claude/commands/sync-context.md` with:
- Inline bash to gather recent git history (`!`git log --oneline -20``)
- Inline bash for current branch state (`!`git status``)
- Inline bash for recent changes (`!`git diff --stat HEAD~5``)
- Summarize what's been happening in the project
- Based on Boris team tip #4 ("sync recent context into a single dump")
**MUTATE**: Run `mutation-testing` skill.
**KILL MUTANTS**: Address surviving mutants.
**REFACTOR**: Keep pre-computed context fast.
**Done when**: `/sync-context` gives Claude full project awareness.

---

### PR 3: Custom Subagents

Based on Boris's tip #8: "I use a few subagents regularly."

#### Step 8: Create `code-simplifier` subagent

**RED**: Write a test that `.claude/agents/code-simplifier.md` exists and contains valid frontmatter.
**GREEN**: Create the agent with:
- `model: sonnet` (fast, cost-effective for review)
- Tools: Read, Grep, Glob, Edit, Write (needs write access to simplify)
- System prompt: "Review recent changes. Find opportunities to simplify, reduce duplication, and improve readability. Apply changes directly. Follow the refactoring skill patterns."
- `skills: [refactoring]` (preload the refactoring skill)
**MUTATE**: Run `mutation-testing` skill.
**KILL MUTANTS**: Address surviving mutants.
**REFACTOR**: Ensure the system prompt is focused and actionable.
**Done when**: Claude delegates simplification tasks to this agent.

#### Step 9: Create `verify-app` subagent

**RED**: Write a test that `.claude/agents/verify-app.md` exists.
**GREEN**: Create the agent with:
- `model: sonnet`
- Tools: Bash, Read, Grep, Glob
- System prompt: detailed end-to-end verification instructions (run tests, check types, lint, check for console errors, verify build)
- Based on Boris tip #12 ("prompt Claude to verify its work with a background agent")
**MUTATE**: Run `mutation-testing` skill.
**KILL MUTANTS**: Address surviving mutants.
**REFACTOR**: Ensure verification steps are ordered by speed (fast checks first).
**Done when**: Claude can delegate verification to this agent.

#### Step 10: Create `security-auditor` subagent

**RED**: Write a test that `.claude/agents/security-auditor.md` exists.
**GREEN**: Create the agent with:
- `model: sonnet`
- Tools: Read, Grep, Glob (read-only)
- System prompt: scan for OWASP Top 10 issues, secret leaks, dependency vulnerabilities, insecure patterns
- `background: true` (runs in background, reports when done)
**MUTATE**: Run `mutation-testing` skill.
**KILL MUTANTS**: Address surviving mutants.
**REFACTOR**: Focus on actionable findings, not false positives.
**Done when**: Security auditor can scan the codebase independently.

---

### PR 4: Project-Level CLAUDE.md

#### Step 11: Create project CLAUDE.md

**RED**: Write a test that `CLAUDE.md` (project root) exists and contains required sections.
**GREEN**: Create `CLAUDE.md` that:
- Describes this project's purpose (Claude Code setup reference/template)
- Lists the tech stack and conventions
- References installed tools: citypaul skills, Superpowers workflows, GSD project management
- Documents the custom commands (`/commit-push-pr`, `/verify`, `/techdebt`, `/sync-context`)
- Documents the custom agents (`code-simplifier`, `verify-app`, `security-auditor`)
- Documents hook behaviors (auto-format, file protection, notifications)
- Includes workflow guidance from hello7 (Plan Mode Default, Subagent Strategy, Verification Before Done)
- Follows the lean format from citypaul's CLAUDE.md (< 100 lines, always loaded, skills on-demand)
**MUTATE**: Run `mutation-testing` skill.
**KILL MUTANTS**: Address surviving mutants.
**REFACTOR**: Ensure it's scannable and under 100 lines.
**Done when**: Claude Code loads this CLAUDE.md and follows its conventions.

#### Step 12: Create `.claude/skills/project-onboarding/SKILL.md`

**RED**: Write a test that the skill file exists with valid frontmatter.
**GREEN**: Create a project-specific onboarding skill that:
- Explains how all the pieces fit together (skills + agents + hooks + commands + GSD + Superpowers)
- Provides a "getting started" checklist for new developers
- Links to relevant documentation files (hello through hello9)
- `user-invocable: false` (Claude loads it when onboarding context is needed)
**MUTATE**: Run `mutation-testing` skill.
**KILL MUTANTS**: Address surviving mutants.
**REFACTOR**: Keep under 500 lines per skill docs guidance.
**Done when**: Claude can onboard new developers using this skill.

---

### PR 5: Integration & Documentation

#### Step 13: Create `README.md` documenting the setup

**RED**: Write a test that `README.md` exists and covers all major sections.
**GREEN**: Create `README.md` with:
- Overview of the ultimate Claude Code setup
- Prerequisites (Claude Code CLI, GitHub CLI, Node.js)
- Quick start guide (clone, install, run `/setup`)
- Architecture diagram (ASCII art showing how CLAUDE.md, skills, agents, hooks, commands, MCP, GSD, and Superpowers connect)
- Reference table of all custom commands and agents
- Tips from Boris (parallel sessions, plan mode, verification)
- Links to source documentation (hello files)
**MUTATE**: Run `mutation-testing` skill.
**KILL MUTANTS**: Address surviving mutants.
**REFACTOR**: Ensure it's concise and actionable.
**Done when**: A new developer can understand and use the entire setup from the README alone.

#### Step 14: End-to-end verification

**RED**: Write a comprehensive test script that validates the entire setup: all files exist, all JSON is valid, all commands are discoverable, all agents have valid frontmatter, hooks are configured.
**GREEN**: Create `.claude/hooks/validate-setup.sh` that checks everything.
**MUTATE**: Run `mutation-testing` skill.
**KILL MUTANTS**: Address surviving mutants.
**REFACTOR**: Ensure the script is fast (< 5s) and gives clear error messages.
**Done when**: Running the validation script confirms the setup is complete and correct.

## Pre-PR Quality Gate

Before each PR:
1. Mutation testing — run `mutation-testing` skill
2. Refactoring assessment — run `refactoring` skill
3. All JSON files validate with `jq`
4. All markdown files have valid frontmatter
5. All hook scripts are executable and have shebangs
6. All slash commands appear in Claude Code's `/` menu

## Architecture Overview

```
claude-charlie/                      # Project root
├── CLAUDE.md                        # Project conventions (< 100 lines)
├── .claude/
│   ├── settings.json                # Hooks + permissions + env
│   ├── commands/
│   │   ├── commit-push-pr.md        # Boris tip #7: inner-loop automation
│   │   ├── verify.md                # Boris tip #13: verification loop
│   │   ├── techdebt.md              # Boris team tip #4: tech debt scan
│   │   └── sync-context.md          # Boris team tip #4: context sync
│   ├── agents/
│   │   ├── code-simplifier.md       # Boris tip #8: post-change cleanup
│   │   ├── verify-app.md            # Boris tip #12: background verification
│   │   └── security-auditor.md      # OWASP scanning
│   ├── skills/
│   │   └── project-onboarding/
│   │       └── SKILL.md             # Onboarding skill for new devs
│   └── hooks/
│       ├── protect-files.sh         # Block edits to sensitive files
│       ├── validate-setup.sh        # E2E setup validation
│       └── test-setup.sh            # Structure verification
├── .mcp.json                        # GitHub MCP server
├── README.md                        # Setup documentation
├── hello through hello9             # Source reference material
└── claude.md                        # Existing reference (keep as-is)
```

## Tool Integration Map

```
User Session
├── Superpowers Plugin
│   ├── /brainstorming          → Before any creative/design work
│   ├── /test-driven-development → RED-GREEN-REFACTOR enforcement
│   ├── /systematic-debugging    → Bug investigation workflow
│   ├── /writing-plans           → Spec → implementation plan
│   ├── /executing-plans         → Plan → code with subagents
│   ├── /verification-before-completion → Final quality gate
│   └── /requesting-code-review  → Post-implementation review
│
├── GSD Plugin
│   ├── /gsd:new-project        → Initialize project with research
│   ├── /gsd:plan-phase         → Detailed phase planning
│   ├── /gsd:execute-phase      → Execute with atomic commits
│   ├── /gsd:verify-work        → Validate built features
│   ├── /gsd:debug              → Scientific method debugging
│   └── /gsd:ship               → PR + review + ship
│
├── citypaul Skills (loaded on-demand)
│   ├── tdd                     → TDD workflow patterns
│   ├── testing                 → Behavior-driven testing
│   ├── mutation-testing        → Test effectiveness verification
│   ├── refactoring             → Safe refactoring patterns
│   ├── typescript-strict       → Type safety enforcement
│   ├── functional              → FP patterns
│   ├── planning                → Small increment planning
│   ├── frontend-design         → UI implementation
│   ├── hexagonal-architecture  → Ports & adapters
│   ├── domain-driven-design    → DDD patterns
│   └── twelve-factor           → Cloud-native patterns
│
├── Custom Commands (this setup)
│   ├── /commit-push-pr         → Git workflow automation
│   ├── /verify                 → Full verification pipeline
│   ├── /techdebt               → Tech debt scanning
│   └── /sync-context           → Project state awareness
│
├── Custom Agents (this setup)
│   ├── code-simplifier         → Post-change cleanup
│   ├── verify-app              → Background verification
│   └── security-auditor        → Security scanning
│
└── Hooks (this setup)
    ├── PreToolUse              → Safety checks, file protection
    ├── PostToolUse             → Auto-formatting
    ├── Notification            → Desktop alerts
    └── Stop                    → Verification reminder
```

---
*Delete this file when the plan is complete. If `plans/` is empty, delete the directory.*
