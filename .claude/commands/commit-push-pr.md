---
name: commit-push-pr
description: Stage, commit, push, and create a PR with conventional commits
disable-model-invocation: true
---

## Current State

- Status: !`git status --short`
- Recent commits: !`git log --oneline -5`
- Diff stats: !`git diff --stat`
- Current branch: !`git branch --show-current`

## Instructions

Create a commit and PR following these steps. Ask for confirmation before each step.

### 1. Stage Changes
Review the status above. Stage only relevant files (no secrets, no lock files, no generated files).

### 2. Write Commit Message
Use conventional commit format: `type(scope): description`

Types: feat, fix, docs, refactor, test, chore
- Subject line < 72 characters
- Explain WHY, not just WHAT
- Add body if the change is non-trivial

Show the proposed commit message and wait for approval.

### 3. Commit
Create the commit with the approved message.

### 4. Push
Push the current branch to origin with `-u` flag.

### 5. Create PR
Create a PR using `gh pr create` with:
- Title matching the commit message subject
- Body with:
  - ## Summary (2-3 bullet points)
  - ## Test Plan (verification checklist)
  - Footer: Generated with Claude Code

Show the proposed PR title and body, wait for approval, then create.
