---
name: project-onboarding
description: Explains the Claude Code setup in this project — how skills, agents, hooks, commands, GSD, and Superpowers work together. Use when onboarding new developers or when someone asks how the setup works.
user-invocable: false
---

# Project Onboarding

This project uses a layered Claude Code setup combining multiple tool ecosystems.

## Quick Orientation

| Layer | Location | What It Provides |
|-------|----------|-----------------|
| Global tools | ~/.claude/ | citypaul skills (TDD, testing, TS-strict, etc.), GSD project management, Superpowers workflows |
| Project config | .claude/ | Custom commands, agents, hooks, skills specific to this project |
| Conventions | CLAUDE.md | Mandatory workflow, tech stack, coding standards |
| MCP servers | .mcp.json | GitHub integration for PRs and issues |

## Mandatory Workflow

Every change follows this order:
1. **PLAN** — Start in plan mode (Shift+Tab x2), get plan approved
2. **RED** — Write failing test first
3. **GREEN** — Minimum code to pass
4. **MUTATE** — Run mutation-testing skill
5. **KILL MUTANTS** — Address survivors
6. **REFACTOR** — Only if it adds value
7. **VERIFY** — Run `/verify`
8. **COMMIT** — Run `/commit-push-pr`

## Which Tool For Which Job

| I want to... | Use this |
|--------------|----------|
| Start a new feature | Superpowers `/brainstorming` then `/writing-plans` |
| Execute a plan | Superpowers `/executing-plans` or `/subagent-driven-development` |
| Manage project phases | GSD `/gsd:plan-phase`, `/gsd:execute-phase` |
| Debug a bug | Superpowers `/systematic-debugging` or GSD `/gsd:debug` |
| Write tests first | citypaul `tdd` skill (auto-loaded) |
| Check test effectiveness | citypaul `mutation-testing` skill |
| Clean up code after changes | `code-simplifier` agent (auto-delegated) |
| Verify before shipping | `/verify` command or `verify-app` agent |
| Scan for security issues | `security-auditor` agent |
| Check tech debt | `/techdebt` command |
| Catch up on project state | `/sync-context` command |
| Commit and create PR | `/commit-push-pr` command |
| Ship a PR with review | GSD `/gsd:ship` |

## Reference Material

The `hello` through `hello9` files in the repo root contain source material:
- `hello` — Project structure reference
- `hello1` — Terminal setup docs
- `hello2` — Skills documentation
- `hello3` — Subagents documentation
- `hello4` — Hooks documentation
- `hello5` — Boris Cherny's personal setup (13 tips)
- `hello6` — Boris's 10 team-sourced tips
- `hello7` — Workflow orchestration principles
- `hello8` — Example CLAUDE.md for a real project
- `hello9` — Global Claude configuration template
