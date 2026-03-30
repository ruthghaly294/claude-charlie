---
name: verify
description: Run the full verification pipeline — tests, types, lint, diff
disable-model-invocation: true
---

Run each verification step in order. Report pass/fail for each. Stop on first failure and suggest a fix.

### Step 1: Tests
Run: `npm test`
If no test script exists, report "SKIP: no test script configured" and continue.

### Step 2: Type Check
Run: `npx tsc --noEmit`
If no tsconfig.json exists, report "SKIP: no TypeScript config" and continue.

### Step 3: Lint
Run: `npm run lint`
If no lint script exists, report "SKIP: no lint script configured" and continue.

### Step 4: Diff Review
Run: `git diff main...HEAD --stat`
Review the changed files. Flag anything suspicious:
- Files > 300 lines changed
- Changes to protected files (.env, lock files)
- Console.log or debugger statements left in code
- Skipped tests (.skip, .only)

### Summary
Report a table:
| Check | Status | Details |
|-------|--------|---------|
| Tests | PASS/FAIL/SKIP | ... |
| Types | PASS/FAIL/SKIP | ... |
| Lint  | PASS/FAIL/SKIP | ... |
| Diff  | CLEAN/WARNINGS | ... |
