---
name: techdebt
description: Scan codebase for tech debt — duplication, TODOs, complexity
context: fork
agent: Explore
disable-model-invocation: true
---

Scan the codebase and produce a prioritized tech debt report.

## Scan Categories

### 1. TODOs and FIXMEs
Search for TODO, FIXME, HACK, XXX, TEMP comments. List each with file path and line number.

### 2. Large Files
Find files exceeding 300 lines (excluding tests, generated files, lock files, and node_modules).

### 3. Complex Functions
Find functions exceeding 30 lines or with nesting deeper than 3 levels.

### 4. Unused Exports
Look for exported functions/types/constants that have no imports elsewhere in the codebase.

### 5. Duplicate Patterns
Identify code blocks that appear nearly identical in multiple locations.

## Output Format

Group findings by severity:

**Critical** (fix now): Security issues, broken patterns
**High** (fix soon): Large files, complex functions, significant duplication
**Medium** (plan to fix): TODOs, minor duplication
**Low** (nice to have): Unused exports, style inconsistencies

For each finding: file path, line number, description, suggested action.
