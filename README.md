# Ultimate Claude Code Setup

Opinionated Claude Code starter kit for full-stack TypeScript projects. Combines Boris Cherny's team practices, citypaul/.dotfiles skills framework, Superpowers plugin workflows, and GSD project management into a production-grade development environment.

No sample app included — this is configuration only. Bring your own code.

## Quick Start

```bash
# 1. Clone this template
git clone <this-repo> my-project
cd my-project

# 2. Run the bootstrap script
./setup.sh

# 3. Start Claude Code
claude

# 4. Get oriented
/sync-context
```

## What You Get

### Global Tools (~/.claude/)

| Tool | What It Provides |
|------|-----------------|
| citypaul dotfiles | 22 skills (TDD, testing, TypeScript, refactoring, etc.), 5 commands, 10 agents |
| Superpowers plugin | Brainstorming, plan writing, plan execution, debugging, code review workflows |
| GSD plugin | Project phases, execution, verification, session management |
| Atlassian plugin | Jira/Confluence integration |

### Project Config (.claude/)

| Component | Files |
|-----------|-------|
| Hooks | `safety-check.sh` (blocks dangerous commands), `protect-files.sh` (guards sensitive files) |
| Commands | `/commit-push-pr`, `/verify`, `/techdebt`, `/sync-context` |
| Agents | `code-simplifier`, `verify-app`, `security-auditor` |
| Skills | `project-onboarding` (auto-loaded for new developers) |
| Settings | Auto-format on edit, desktop notifications, permission pre-allows |

### Documentation

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Mandatory workflow, conventions, tool reference |
| `README.md` | This file |
| `.mcp.json` | GitHub MCP server for PR/issue workflows |

## Architecture

```
setup.sh (bootstrap)
    |
    v
~/.claude/ (global)
    |-- CLAUDE.md (TDD core principles)
    |-- skills/ (22 on-demand patterns)
    |-- commands/ (5 reusable workflows)
    |-- agents/ (28 specialized agents)
    |-- plugins (Superpowers, GSD, Atlassian, Skill Creator)
    |
    v
.claude/ (project)
    |-- settings.json (hooks + permissions)
    |-- commands/ (4 inner-loop workflows)
    |-- agents/ (3 specialized agents)
    |-- skills/ (1 onboarding skill)
    |-- hooks/ (2 safety scripts)
    |
    v
CLAUDE.md (conventions)
    |-- Mandatory TDD workflow
    |-- Tech stack reference
    |-- Tool quick-reference tables
```

## Mandatory Workflow

Every change follows: PLAN -> RED -> GREEN -> MUTATE -> KILL MUTANTS -> REFACTOR -> VERIFY -> COMMIT

See `CLAUDE.md` for details.

## Reference Material

The `hello` through `hello9` files contain the source material this setup was built from — Boris Cherny's tips, official Claude Code documentation, and workflow principles.
