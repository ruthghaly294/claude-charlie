---
name: sync-context
description: Catch up on recent project state — git history, branch, changes
disable-model-invocation: true
---

## Project State

- Recent history: !`git log --oneline -20`
- Current status: !`git status --short`
- Recent changes: !`git diff --stat HEAD~5 2>/dev/null || echo "Less than 5 commits on this branch"`
- All branches: !`git branch -a`
- Current branch: !`git branch --show-current`

## Instructions

Summarize the project state:

1. **Current branch**: What branch are we on and how does it relate to main?
2. **Recent activity**: What's been happening in the last 20 commits? Group by theme.
3. **Pending work**: Are there uncommitted changes? What do they look like?
4. **Branch landscape**: What other branches exist? Any that look stale or related?

Keep the summary concise — this is a status update, not an investigation.
