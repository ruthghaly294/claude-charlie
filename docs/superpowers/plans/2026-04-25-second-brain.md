# Second Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combine markitdown, kepano/obsidian-skills, graphify, and tobi/qmd into one cohesive `/brain` workflow backed by a global `~/second-brain/` Obsidian-compatible vault, installable via `setup.sh`.

**Architecture:** A bash orchestration layer in `templates/brain/` (rsynced to `~/.claude/scripts/brain/` by setup.sh) wraps four CLI tools. A `/brain` slash command exposes capture/reindex/query/canvas pipelines. qmd's MCP server is registered globally so Claude can search the vault mid-conversation without explicit slash commands. All scripts read a single `brain.config.yml` at the vault root.

**Tech Stack:** Bash 4+, bats-core (testing), `yq` (YAML parsing), `jq` (JSON merge for MCP registration), `markitdown` (Python/pipx), `@tobilu/qmd` (Node), `graphify` (Python via `uv tool`), `obsidian-skills` plugin (already installed).

**Spec:** `docs/superpowers/specs/2026-04-25-second-brain-design.md`

---

## File Structure

### Repo files (this codebase)

```
templates/brain/                          ← Source of truth, rsynced to ~/.claude/scripts/brain/
├── brain                                 ← Main router (executable bash)
├── lib/
│   ├── log.sh                            ← log_ok / log_warn / log_fail / log_die
│   ├── config.sh                         ← Loads brain.config.yml → env vars
│   └── classify.sh                       ← Input → adapter name (pure function)
├── adapters/
│   ├── markitdown.sh                     ← File → markdown
│   ├── defuddle.sh                       ← URL → markdown (via obsidian-skills' defuddle)
│   └── text.sh                           ← Stdin/inline text → markdown
├── pipelines/
│   ├── init.sh                           ← Bootstrap vault
│   ├── capture.sh                        ← classify → adapter → atomic write
│   ├── reindex.sh                        ← qmd embed + graphify --update
│   ├── status.sh                         ← Vault stats
│   ├── query.sh                          ← qmd query passthrough
│   └── canvas.sh                         ← graphify 2-hop → JSON Canvas
└── tests/
    ├── helpers.bash                      ← Common test setup
    ├── test_classify.bats
    ├── test_log.bats
    ├── test_config.bats
    ├── test_text.bats
    ├── test_markitdown.bats
    ├── test_defuddle.bats
    ├── test_capture.bats
    ├── test_init.bats
    └── fixtures/
        ├── sample.txt
        ├── sample.html
        └── sample.pdf

.claude/commands/brain.md                  ← Slash command entry (in this repo's .claude/)
setup.sh                                  ← Step 12 added before Summary
docs/superpowers/specs/2026-04-25-second-brain-design.md  ← (already exists)
```

### Installed files (created by setup.sh on the user's machine)

```
~/.claude/scripts/brain/                   ← rsynced from templates/brain/
~/.claude/commands/brain.md                ← copied from .claude/commands/brain.md
~/.claude/settings.json                    ← qmd MCP entry merged in
~/.local/bin/brain                         ← symlink → ~/.claude/scripts/brain/brain
~/second-brain/                            ← Created by /brain init
├── brain.config.yml
├── 00-Inbox/.gitkeep
├── 10-Sources/_attachments/.gitkeep
├── 20-Notes/.gitkeep
├── 30-Canvases/.gitkeep
├── 40-Bases/.gitkeep
├── 90-Graphs/.gitkeep
├── .gitignore
└── README.md
```

---

## Conventions

**Commit format:** `type(scope): description` (Conventional Commits, per project CLAUDE.md).
**Shell strictness:** Every script starts with `set -euo pipefail`.
**Test runner:** `bats templates/brain/tests/` (after `ensure_bats` step in setup.sh; locally install via `npm i -g bats` or `apt install bats`).
**Path style:** Always absolute paths in plan (`/workspaces/claude-charlie/...`). Scripts use `${BRAIN_HOME:-$HOME/.claude/scripts/brain}` and `${BRAIN_VAULT:-$HOME/second-brain}` so they're testable.

---

## Task 1: Repo scaffolding + bats test harness

**Files:**

- Create: `/workspaces/claude-charlie/templates/brain/.gitkeep`
- Create: `/workspaces/claude-charlie/templates/brain/tests/helpers.bash`
- Create: `/workspaces/claude-charlie/templates/brain/tests/fixtures/sample.txt`
- Create: `/workspaces/claude-charlie/.gitignore` entry for test artifacts

- [ ] **Step 1: Create the directory skeleton**

```bash
mkdir -p /workspaces/claude-charlie/templates/brain/{lib,adapters,pipelines,tests/fixtures}
touch /workspaces/claude-charlie/templates/brain/.gitkeep
touch /workspaces/claude-charlie/templates/brain/{lib,adapters,pipelines,tests}/.gitkeep
```

- [ ] **Step 2: Verify bats is available**

```bash
command -v bats || echo "BATS_MISSING — install with 'sudo apt install bats' or 'npm i -g bats'"
```

If missing, install: `sudo apt install -y bats` (or `npm i -g bats`).

- [ ] **Step 3: Write `tests/helpers.bash`**

File: `/workspaces/claude-charlie/templates/brain/tests/helpers.bash`

```bash
#!/usr/bin/env bash
# Common test helpers for brain bats tests.

setup_brain_temp_vault() {
  BRAIN_VAULT="$(mktemp -d)"
  export BRAIN_VAULT
  export BRAIN_INBOX="00-Inbox"
  export BRAIN_SOURCES="10-Sources"
  export BRAIN_GRAPHS="90-Graphs"
  mkdir -p "$BRAIN_VAULT/$BRAIN_INBOX" \
           "$BRAIN_VAULT/$BRAIN_SOURCES/_attachments" \
           "$BRAIN_VAULT/$BRAIN_GRAPHS"
}

teardown_brain_temp_vault() {
  if [ -n "${BRAIN_VAULT:-}" ] && [ -d "$BRAIN_VAULT" ] && [[ "$BRAIN_VAULT" == /tmp/* ]]; then
    rm -rf "$BRAIN_VAULT"
  fi
}

brain_root() {
  cd "$(dirname "${BATS_TEST_FILENAME}")/.." && pwd
}
```

- [ ] **Step 4: Create fixture file**

File: `/workspaces/claude-charlie/templates/brain/tests/fixtures/sample.txt`

```
Hello second brain.
This is a sample text file for testing capture.
```

- [ ] **Step 5: Run a sanity bats invocation**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
echo '@test "harness loads" { source helpers.bash; setup_brain_temp_vault; [ -d "$BRAIN_VAULT" ]; teardown_brain_temp_vault; }' > test_harness.bats
bats test_harness.bats
rm test_harness.bats
```

Expected: `1 test, 0 failures`.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/claude-charlie
git add templates/brain
git commit -m "chore(brain): scaffold templates/brain/ + bats helpers"
```

---

## Task 2: `lib/log.sh` (TDD)

**Files:**

- Create: `/workspaces/claude-charlie/templates/brain/tests/test_log.bats`
- Create: `/workspaces/claude-charlie/templates/brain/lib/log.sh`

- [ ] **Step 1: Write the failing test**

File: `/workspaces/claude-charlie/templates/brain/tests/test_log.bats`

```bash
#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  source "$ROOT/lib/log.sh"
}

@test "log_ok prints checkmark prefix" {
  result="$(log_ok 'all good')"
  [[ "$result" == *"✓"* ]]
  [[ "$result" == *"all good"* ]]
}

@test "log_warn prints warning prefix" {
  result="$(log_warn 'careful')"
  [[ "$result" == *"!"* ]]
  [[ "$result" == *"careful"* ]]
}

@test "log_fail prints x prefix" {
  result="$(log_fail 'broken')"
  [[ "$result" == *"✗"* ]]
  [[ "$result" == *"broken"* ]]
}

@test "log_die exits 1 after logging" {
  run bash -c "source $ROOT/lib/log.sh; log_die 'fatal'"
  [ "$status" -eq 1 ]
  [[ "$output" == *"fatal"* ]]
}

@test "log_step prints headline" {
  result="$(log_step 'Starting')"
  [[ "$result" == *"Starting"* ]]
}
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_log.bats
```

Expected: All 5 tests fail with `lib/log.sh: No such file or directory`.

- [ ] **Step 3: Implement `lib/log.sh`**

File: `/workspaces/claude-charlie/templates/brain/lib/log.sh`

```bash
#!/usr/bin/env bash
# Consistent logging primitives for brain scripts.
# Source-only; do not execute directly.

set -euo pipefail

BRAIN_BOLD='\033[1m'
BRAIN_GREEN='\033[0;32m'
BRAIN_RED='\033[0;31m'
BRAIN_YELLOW='\033[0;33m'
BRAIN_NC='\033[0m'

log_ok()   { echo -e "  ${BRAIN_GREEN}✓${BRAIN_NC} $*"; }
log_warn() { echo -e "  ${BRAIN_YELLOW}!${BRAIN_NC} $*"; }
log_fail() { echo -e "  ${BRAIN_RED}✗${BRAIN_NC} $*" >&2; }
log_step() { echo -e "\n${BRAIN_BOLD}$*${BRAIN_NC}"; }
log_die()  { log_fail "$*"; exit 1; }
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_log.bats
```

Expected: `5 tests, 0 failures`.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/claude-charlie
git add templates/brain/lib/log.sh templates/brain/tests/test_log.bats
git commit -m "feat(brain): add lib/log.sh with bats coverage"
```

---

## Task 3: `lib/classify.sh` (TDD — pure function, easiest unit)

**Files:**

- Create: `/workspaces/claude-charlie/templates/brain/tests/test_classify.bats`
- Create: `/workspaces/claude-charlie/templates/brain/lib/classify.sh`

- [ ] **Step 1: Write the failing test**

File: `/workspaces/claude-charlie/templates/brain/tests/test_classify.bats`

```bash
#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  source "$ROOT/lib/classify.sh"
}

@test "URL → url" {
  [ "$(classify 'https://example.com')" = "url" ]
  [ "$(classify 'http://example.com/page')" = "url" ]
}

@test ".md file → copy" {
  tmp="$(mktemp --suffix=.md)"
  [ "$(classify "$tmp")" = "copy" ]
  rm "$tmp"
}

@test ".pdf file → markitdown" {
  tmp="$(mktemp --suffix=.pdf)"
  [ "$(classify "$tmp")" = "markitdown" ]
  rm "$tmp"
}

@test ".docx file → markitdown" {
  tmp="$(mktemp --suffix=.docx)"
  [ "$(classify "$tmp")" = "markitdown" ]
  rm "$tmp"
}

@test ".html file → markitdown" {
  tmp="$(mktemp --suffix=.html)"
  [ "$(classify "$tmp")" = "markitdown" ]
  rm "$tmp"
}

@test "plain text (no path, no URL) → text" {
  [ "$(classify 'just a thought')" = "text" ]
  [ "$(classify 'multi word note about things')" = "text" ]
}

@test "non-existent file path → text (fallback)" {
  [ "$(classify '/no/such/file.xyz')" = "text" ]
}
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_classify.bats
```

Expected: All tests fail with `lib/classify.sh: No such file or directory`.

- [ ] **Step 3: Implement `lib/classify.sh`**

File: `/workspaces/claude-charlie/templates/brain/lib/classify.sh`

```bash
#!/usr/bin/env bash
# classify <input> — emit one of: url, copy, markitdown, text
# Source-only; do not execute directly.

set -euo pipefail

classify() {
  local input="$1"

  if [[ "$input" =~ ^https?:// ]]; then
    echo "url"
    return
  fi

  if [ -f "$input" ]; then
    case "${input,,}" in
      *.md|*.markdown) echo "copy" ;;
      *.pdf|*.docx|*.doc|*.pptx|*.ppt|*.xlsx|*.xls|*.html|*.htm|*.epub|*.csv|*.json|*.xml|*.zip|*.mp3|*.wav|*.m4a|*.png|*.jpg|*.jpeg)
        echo "markitdown" ;;
      *) echo "markitdown" ;;
    esac
    return
  fi

  echo "text"
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_classify.bats
```

Expected: `7 tests, 0 failures`.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/claude-charlie
git add templates/brain/lib/classify.sh templates/brain/tests/test_classify.bats
git commit -m "feat(brain): add lib/classify.sh input-type router"
```

---

## Task 4: `lib/config.sh` (TDD — depends on yq)

**Files:**

- Create: `/workspaces/claude-charlie/templates/brain/tests/test_config.bats`
- Create: `/workspaces/claude-charlie/templates/brain/lib/config.sh`

- [ ] **Step 1: Verify yq is available**

```bash
command -v yq || echo "YQ_MISSING — install with 'sudo apt install yq' or 'snap install yq' or download from https://github.com/mikefarah/yq/releases"
```

If missing, install: `sudo wget -qO /usr/local/bin/yq https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 && sudo chmod +x /usr/local/bin/yq`.

- [ ] **Step 2: Write the failing test**

File: `/workspaces/claude-charlie/templates/brain/tests/test_config.bats`

```bash
#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  TMP="$(mktemp -d)"
  cat > "$TMP/brain.config.yml" <<'EOF'
vault: ~/test-brain
inbox: 00-Inbox
sources: 10-Sources
graphs: 90-Graphs
qmd:
  collections:
    - name: brain
      path: .
graphify:
  mode: standard
  whisper_model: base
markitdown:
  preserve_originals: true
  attachments_dir: 10-Sources/_attachments
EOF
}

teardown() {
  rm -rf "$TMP"
}

@test "config_load reads vault path" {
  source "$ROOT/lib/config.sh"
  config_load "$TMP/brain.config.yml"
  [ "$BRAIN_VAULT" = "$HOME/test-brain" ]   # ~ expanded
}

@test "config_load reads folder names" {
  source "$ROOT/lib/config.sh"
  config_load "$TMP/brain.config.yml"
  [ "$BRAIN_INBOX" = "00-Inbox" ]
  [ "$BRAIN_SOURCES" = "10-Sources" ]
  [ "$BRAIN_GRAPHS" = "90-Graphs" ]
}

@test "config_load reads graphify mode" {
  source "$ROOT/lib/config.sh"
  config_load "$TMP/brain.config.yml"
  [ "$BRAIN_GRAPHIFY_MODE" = "standard" ]
}

@test "config_load aborts on missing file" {
  source "$ROOT/lib/config.sh"
  run config_load "/no/such/file.yml"
  [ "$status" -ne 0 ]
  [[ "$output" == *"config not found"* ]]
}

@test "config_load aborts on missing vault key" {
  echo "inbox: 00-Inbox" > "$TMP/bad.yml"
  source "$ROOT/lib/config.sh"
  run config_load "$TMP/bad.yml"
  [ "$status" -ne 0 ]
  [[ "$output" == *"vault"* ]]
}
```

- [ ] **Step 3: Run test, verify fail**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_config.bats
```

Expected: All 5 tests fail with `lib/config.sh: No such file or directory`.

- [ ] **Step 4: Implement `lib/config.sh`**

File: `/workspaces/claude-charlie/templates/brain/lib/config.sh`

```bash
#!/usr/bin/env bash
# Loads brain.config.yml and exports BRAIN_* env vars.
# Source-only; do not execute directly.
# Requires: yq (mikefarah)

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/log.sh"

config_load() {
  local config_path="${1:-$HOME/second-brain/brain.config.yml}"

  if [ ! -f "$config_path" ]; then
    log_fail "config not found: $config_path"
    return 1
  fi

  command -v yq >/dev/null || { log_fail "yq is required but not installed"; return 1; }

  local raw_vault inbox sources graphs gmode whisper preserve attach
  raw_vault="$(yq '.vault' "$config_path")"
  inbox="$(yq '.inbox' "$config_path")"
  sources="$(yq '.sources' "$config_path")"
  graphs="$(yq '.graphs' "$config_path")"
  gmode="$(yq '.graphify.mode // "standard"' "$config_path")"
  whisper="$(yq '.graphify.whisper_model // "base"' "$config_path")"
  preserve="$(yq '.markitdown.preserve_originals // true' "$config_path")"
  attach="$(yq '.markitdown.attachments_dir // "10-Sources/_attachments"' "$config_path")"

  if [ "$raw_vault" = "null" ] || [ -z "$raw_vault" ]; then
    log_fail "config missing required key: vault"
    return 1
  fi

  # Expand ~ to $HOME
  case "$raw_vault" in
    "~"|"~/"*) raw_vault="${HOME}${raw_vault:1}" ;;
  esac

  export BRAIN_VAULT="$raw_vault"
  export BRAIN_INBOX="${inbox:-00-Inbox}"
  export BRAIN_SOURCES="${sources:-10-Sources}"
  export BRAIN_GRAPHS="${graphs:-90-Graphs}"
  export BRAIN_GRAPHIFY_MODE="$gmode"
  export BRAIN_GRAPHIFY_WHISPER="$whisper"
  export BRAIN_MARKITDOWN_PRESERVE="$preserve"
  export BRAIN_MARKITDOWN_ATTACHMENTS="$attach"
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_config.bats
```

Expected: `5 tests, 0 failures`.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/claude-charlie
git add templates/brain/lib/config.sh templates/brain/tests/test_config.bats
git commit -m "feat(brain): add lib/config.sh yaml→env loader"
```

---

## Task 5: `adapters/text.sh` (TDD — simplest adapter)

**Files:**

- Create: `/workspaces/claude-charlie/templates/brain/tests/test_text.bats`
- Create: `/workspaces/claude-charlie/templates/brain/adapters/text.sh`

- [ ] **Step 1: Write the failing test**

File: `/workspaces/claude-charlie/templates/brain/tests/test_text.bats`

```bash
#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  setup_brain_temp_vault
}

teardown() {
  teardown_brain_temp_vault
}

@test "adapter_text writes a markdown file with frontmatter" {
  echo "Hello brain" | "$ROOT/adapters/text.sh"
  ls "$BRAIN_VAULT/$BRAIN_INBOX"/*.md
  count=$(ls "$BRAIN_VAULT/$BRAIN_INBOX"/*.md | wc -l)
  [ "$count" -eq 1 ]
}

@test "adapter_text frontmatter includes type:text and source" {
  echo "First line is the title" | "$ROOT/adapters/text.sh"
  file="$(ls "$BRAIN_VAULT/$BRAIN_INBOX"/*.md | head -1)"
  grep -q '^type: text$' "$file"
  grep -q '^source: stdin$' "$file"
  grep -q '^captured_at: ' "$file"
}

@test "adapter_text slug derives from first line" {
  echo "My grand idea today" | "$ROOT/adapters/text.sh"
  file="$(ls "$BRAIN_VAULT/$BRAIN_INBOX"/*.md | head -1)"
  [[ "$(basename "$file")" == *"my-grand-idea-today.md" ]]
}

@test "adapter_text body preserved verbatim after frontmatter" {
  printf "Title here\n\nBody paragraph.\n" | "$ROOT/adapters/text.sh"
  file="$(ls "$BRAIN_VAULT/$BRAIN_INBOX"/*.md | head -1)"
  grep -q "^Body paragraph.$" "$file"
}

@test "adapter_text writes atomically (no .tmp lingers)" {
  echo "atomic test" | "$ROOT/adapters/text.sh"
  count=$(ls "$BRAIN_VAULT/$BRAIN_INBOX"/*.tmp 2>/dev/null | wc -l)
  [ "$count" -eq 0 ]
}
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_text.bats
```

Expected: All 5 tests fail (script does not exist).

- [ ] **Step 3: Implement `adapters/text.sh`**

File: `/workspaces/claude-charlie/templates/brain/adapters/text.sh`

```bash
#!/usr/bin/env bash
# adapters/text.sh — read text on stdin, write a markdown note in $BRAIN_VAULT/$BRAIN_INBOX.
# Required env: BRAIN_VAULT, BRAIN_INBOX
# Output: prints absolute path of written file.

set -euo pipefail

: "${BRAIN_VAULT:?BRAIN_VAULT must be set}"
: "${BRAIN_INBOX:=00-Inbox}"

input="$(cat)"
[ -n "$input" ] || { echo "adapter_text: empty input" >&2; exit 1; }

first_line="$(printf '%s\n' "$input" | head -1)"
slug="$(printf '%s' "$first_line" | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-60)"
[ -n "$slug" ] || slug="note"

date_prefix="$(date -u +%Y-%m-%d)"
captured_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
target_dir="$BRAIN_VAULT/$BRAIN_INBOX"
mkdir -p "$target_dir"

base="$date_prefix-$slug"
target="$target_dir/$base.md"
i=1
while [ -e "$target" ]; do
  target="$target_dir/$base-$i.md"
  i=$((i + 1))
done

tmp="$target.tmp"
{
  printf -- '---\n'
  printf 'source: stdin\n'
  printf 'captured_at: %s\n' "$captured_at"
  printf 'type: text\n'
  printf 'tags: [inbox]\n'
  printf -- '---\n\n'
  printf '%s\n' "$input"
} > "$tmp"
mv "$tmp" "$target"

echo "$target"
```

- [ ] **Step 4: Make executable**

```bash
chmod +x /workspaces/claude-charlie/templates/brain/adapters/text.sh
```

- [ ] **Step 5: Run test, verify pass**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_text.bats
```

Expected: `5 tests, 0 failures`.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/claude-charlie
git add templates/brain/adapters/text.sh templates/brain/tests/test_text.bats
git commit -m "feat(brain): add text adapter with atomic frontmatter writes"
```

---

## Task 6: `adapters/markitdown.sh` (TDD — file → markdown)

**Files:**

- Create: `/workspaces/claude-charlie/templates/brain/tests/fixtures/sample.html`
- Create: `/workspaces/claude-charlie/templates/brain/tests/test_markitdown.bats`
- Create: `/workspaces/claude-charlie/templates/brain/adapters/markitdown.sh`

- [ ] **Step 1: Verify markitdown is available**

```bash
command -v markitdown || echo "MARKITDOWN_MISSING — install with: pipx install 'markitdown[all]'"
```

If missing: `pipx install 'markitdown[all]'`. Tests for this adapter will be skipped on machines without markitdown (the test file uses `skip_if_no_tool`).

- [ ] **Step 2: Add HTML fixture**

File: `/workspaces/claude-charlie/templates/brain/tests/fixtures/sample.html`

```html
<!doctype html>
<html>
  <head>
    <title>Sample</title>
  </head>
  <body>
    <h1>Hello Markitdown</h1>
    <p>Paragraph one.</p>
    <ul>
      <li>One</li>
      <li>Two</li>
    </ul>
  </body>
</html>
```

- [ ] **Step 3: Write the failing test**

File: `/workspaces/claude-charlie/templates/brain/tests/test_markitdown.bats`

```bash
#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  setup_brain_temp_vault
  if ! command -v markitdown >/dev/null; then
    skip "markitdown not installed"
  fi
}

teardown() {
  teardown_brain_temp_vault
}

@test "adapter_markitdown converts html to markdown note" {
  out="$("$ROOT/adapters/markitdown.sh" "$ROOT/tests/fixtures/sample.html")"
  [ -f "$out" ]
  grep -q "Hello Markitdown" "$out"
}

@test "adapter_markitdown writes frontmatter with type matching extension" {
  out="$("$ROOT/adapters/markitdown.sh" "$ROOT/tests/fixtures/sample.html")"
  grep -q '^type: html$' "$out"
  grep -q '^source: ' "$out"
}

@test "adapter_markitdown preserves original under attachments_dir" {
  export BRAIN_MARKITDOWN_PRESERVE=true
  export BRAIN_MARKITDOWN_ATTACHMENTS="10-Sources/_attachments"
  "$ROOT/adapters/markitdown.sh" "$ROOT/tests/fixtures/sample.html"
  ls "$BRAIN_VAULT/10-Sources/_attachments/sample.html"
}

@test "adapter_markitdown returns nonzero on missing input" {
  run "$ROOT/adapters/markitdown.sh" "/no/such/file.pdf"
  [ "$status" -ne 0 ]
}
```

- [ ] **Step 4: Run test, verify fail**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_markitdown.bats
```

Expected: tests fail (script missing) — or are skipped if markitdown isn't installed.

- [ ] **Step 5: Implement `adapters/markitdown.sh`**

File: `/workspaces/claude-charlie/templates/brain/adapters/markitdown.sh`

```bash
#!/usr/bin/env bash
# adapters/markitdown.sh — convert any file to markdown via markitdown,
# write a note in $BRAIN_VAULT/$BRAIN_INBOX, optionally preserve the original.
# Required env: BRAIN_VAULT, BRAIN_INBOX
# Optional env: BRAIN_MARKITDOWN_PRESERVE (default: true), BRAIN_MARKITDOWN_ATTACHMENTS
# Args: $1 = path to source file
# Output: prints absolute path of written markdown.

set -euo pipefail

: "${BRAIN_VAULT:?BRAIN_VAULT must be set}"
: "${BRAIN_INBOX:=00-Inbox}"
: "${BRAIN_MARKITDOWN_PRESERVE:=true}"
: "${BRAIN_MARKITDOWN_ATTACHMENTS:=10-Sources/_attachments}"

src="${1:-}"
[ -n "$src" ] || { echo "adapter_markitdown: missing path arg" >&2; exit 2; }
[ -f "$src" ] || { echo "adapter_markitdown: not a file: $src" >&2; exit 1; }
command -v markitdown >/dev/null || { echo "adapter_markitdown: markitdown not installed" >&2; exit 1; }

abs_src="$(cd "$(dirname "$src")" && pwd)/$(basename "$src")"
ext="${src##*.}"; ext="${ext,,}"
basename_noext="$(basename "${src%.*}")"
slug="$(printf '%s' "$basename_noext" | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-60)"
[ -n "$slug" ] || slug="source"

date_prefix="$(date -u +%Y-%m-%d)"
captured_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
target_dir="$BRAIN_VAULT/$BRAIN_INBOX"
mkdir -p "$target_dir"

base="$date_prefix-$slug"
target="$target_dir/$base.md"
i=1
while [ -e "$target" ]; do
  target="$target_dir/$base-$i.md"
  i=$((i + 1))
done

original_path=""
if [ "$BRAIN_MARKITDOWN_PRESERVE" = "true" ]; then
  attach_dir="$BRAIN_VAULT/$BRAIN_MARKITDOWN_ATTACHMENTS"
  mkdir -p "$attach_dir"
  cp "$abs_src" "$attach_dir/"
  original_path="$BRAIN_MARKITDOWN_ATTACHMENTS/$(basename "$abs_src")"
fi

body="$(markitdown "$abs_src" 2>/dev/null)" || {
  echo "adapter_markitdown: markitdown failed on $abs_src" >&2
  exit 1
}

tmp="$target.tmp"
{
  printf -- '---\n'
  printf 'source: %s\n' "$abs_src"
  printf 'captured_at: %s\n' "$captured_at"
  printf 'type: %s\n' "$ext"
  [ -n "$original_path" ] && printf 'original_path: %s\n' "$original_path"
  printf 'tags: [inbox]\n'
  printf -- '---\n\n'
  printf '%s\n' "$body"
} > "$tmp"
mv "$tmp" "$target"

echo "$target"
```

- [ ] **Step 6: Make executable**

```bash
chmod +x /workspaces/claude-charlie/templates/brain/adapters/markitdown.sh
```

- [ ] **Step 7: Run test, verify pass**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_markitdown.bats
```

Expected: `4 tests, 0 failures` (or all skipped if markitdown is not installed — that's also acceptable).

- [ ] **Step 8: Commit**

```bash
cd /workspaces/claude-charlie
git add templates/brain/adapters/markitdown.sh \
        templates/brain/tests/test_markitdown.bats \
        templates/brain/tests/fixtures/sample.html
git commit -m "feat(brain): add markitdown adapter for office/web/audio files"
```

---

## Task 7: `adapters/defuddle.sh` (TDD — URL → markdown)

**Files:**

- Create: `/workspaces/claude-charlie/templates/brain/tests/test_defuddle.bats`
- Create: `/workspaces/claude-charlie/templates/brain/adapters/defuddle.sh`

- [ ] **Step 1: Verify defuddle is available**

```bash
command -v defuddle || echo "DEFUDDLE_MISSING — installs with the obsidian-skills plugin (npm i -g defuddle-cli)"
```

If missing: `npm install -g defuddle-cli`.

- [ ] **Step 2: Write the failing test**

File: `/workspaces/claude-charlie/templates/brain/tests/test_defuddle.bats`

```bash
#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  setup_brain_temp_vault
  if ! command -v defuddle >/dev/null; then
    skip "defuddle not installed"
  fi
}

teardown() {
  teardown_brain_temp_vault
}

@test "adapter_defuddle writes a note for a URL" {
  out="$("$ROOT/adapters/defuddle.sh" "https://example.com/")"
  [ -f "$out" ]
}

@test "adapter_defuddle frontmatter has type:url and source URL" {
  out="$("$ROOT/adapters/defuddle.sh" "https://example.com/")"
  grep -q '^type: url$' "$out"
  grep -q '^source: https://example.com/$' "$out"
}

@test "adapter_defuddle aborts on non-URL arg" {
  run "$ROOT/adapters/defuddle.sh" "not a url"
  [ "$status" -ne 0 ]
}
```

- [ ] **Step 3: Run test, verify fail**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_defuddle.bats
```

Expected: tests fail (script missing) — or skipped if defuddle isn't installed.

- [ ] **Step 4: Implement `adapters/defuddle.sh`**

File: `/workspaces/claude-charlie/templates/brain/adapters/defuddle.sh`

```bash
#!/usr/bin/env bash
# adapters/defuddle.sh — fetch a URL via defuddle, write markdown to $BRAIN_VAULT/$BRAIN_INBOX.
# Required env: BRAIN_VAULT, BRAIN_INBOX
# Args: $1 = URL (http:// or https://)
# Output: prints absolute path of written markdown.

set -euo pipefail

: "${BRAIN_VAULT:?BRAIN_VAULT must be set}"
: "${BRAIN_INBOX:=00-Inbox}"

url="${1:-}"
[[ "$url" =~ ^https?:// ]] || { echo "adapter_defuddle: not a URL: $url" >&2; exit 2; }
command -v defuddle >/dev/null || { echo "adapter_defuddle: defuddle not installed" >&2; exit 1; }

host_path="$(printf '%s' "$url" | sed -E 's,^https?://,,; s,/,-,g; s,[^a-zA-Z0-9-],,g' | cut -c1-60)"
[ -n "$host_path" ] || host_path="page"
slug="$(printf '%s' "$host_path" | tr '[:upper:]' '[:lower:]')"

date_prefix="$(date -u +%Y-%m-%d)"
captured_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
target_dir="$BRAIN_VAULT/$BRAIN_INBOX"
mkdir -p "$target_dir"

base="$date_prefix-$slug"
target="$target_dir/$base.md"
i=1
while [ -e "$target" ]; do
  target="$target_dir/$base-$i.md"
  i=$((i + 1))
done

body="$(defuddle "$url" --markdown 2>/dev/null)" || {
  echo "adapter_defuddle: defuddle failed on $url" >&2
  exit 1
}

tmp="$target.tmp"
{
  printf -- '---\n'
  printf 'source: %s\n' "$url"
  printf 'captured_at: %s\n' "$captured_at"
  printf 'type: url\n'
  printf 'tags: [inbox]\n'
  printf -- '---\n\n'
  printf '%s\n' "$body"
} > "$tmp"
mv "$tmp" "$target"

echo "$target"
```

> **Note:** the exact defuddle CLI flag (`--markdown` vs `--md` vs default markdown output) varies by version. Verify by running `defuddle --help` before implementing; adjust flag if needed.

- [ ] **Step 5: Make executable**

```bash
chmod +x /workspaces/claude-charlie/templates/brain/adapters/defuddle.sh
```

- [ ] **Step 6: Run test, verify pass**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_defuddle.bats
```

Expected: `3 tests, 0 failures` (or skipped if defuddle is not installed).

- [ ] **Step 7: Commit**

```bash
cd /workspaces/claude-charlie
git add templates/brain/adapters/defuddle.sh templates/brain/tests/test_defuddle.bats
git commit -m "feat(brain): add defuddle adapter for URL captures"
```

---

## Task 8: `pipelines/init.sh` (TDD — vault bootstrap)

**Files:**

- Create: `/workspaces/claude-charlie/templates/brain/tests/test_init.bats`
- Create: `/workspaces/claude-charlie/templates/brain/pipelines/init.sh`

- [ ] **Step 1: Write the failing test**

File: `/workspaces/claude-charlie/templates/brain/tests/test_init.bats`

```bash
#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  TMP_VAULT="$(mktemp -d)/second-brain"
  export BRAIN_VAULT_OVERRIDE="$TMP_VAULT"
}

teardown() {
  [ -d "$(dirname "$TMP_VAULT")" ] && rm -rf "$(dirname "$TMP_VAULT")"
}

@test "init creates the vault directory" {
  "$ROOT/pipelines/init.sh"
  [ -d "$TMP_VAULT" ]
}

@test "init creates all numbered folders" {
  "$ROOT/pipelines/init.sh"
  [ -d "$TMP_VAULT/00-Inbox" ]
  [ -d "$TMP_VAULT/10-Sources/_attachments" ]
  [ -d "$TMP_VAULT/20-Notes" ]
  [ -d "$TMP_VAULT/30-Canvases" ]
  [ -d "$TMP_VAULT/40-Bases" ]
  [ -d "$TMP_VAULT/90-Graphs" ]
}

@test "init writes brain.config.yml at vault root" {
  "$ROOT/pipelines/init.sh"
  [ -f "$TMP_VAULT/brain.config.yml" ]
  grep -q "vault:" "$TMP_VAULT/brain.config.yml"
}

@test "init writes .gitignore" {
  "$ROOT/pipelines/init.sh"
  [ -f "$TMP_VAULT/.gitignore" ]
  grep -q "^.qmd/" "$TMP_VAULT/.gitignore"
  grep -q "^.graphify-out/" "$TMP_VAULT/.gitignore"
}

@test "init writes README.md" {
  "$ROOT/pipelines/init.sh"
  [ -f "$TMP_VAULT/README.md" ]
}

@test "init is idempotent" {
  "$ROOT/pipelines/init.sh"
  "$ROOT/pipelines/init.sh"   # second run must not fail
  [ -d "$TMP_VAULT/00-Inbox" ]
}

@test "init does not overwrite existing brain.config.yml" {
  "$ROOT/pipelines/init.sh"
  echo "# user edited" >> "$TMP_VAULT/brain.config.yml"
  "$ROOT/pipelines/init.sh"
  grep -q "# user edited" "$TMP_VAULT/brain.config.yml"
}
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_init.bats
```

Expected: tests fail (script missing).

- [ ] **Step 3: Implement `pipelines/init.sh`**

File: `/workspaces/claude-charlie/templates/brain/pipelines/init.sh`

```bash
#!/usr/bin/env bash
# pipelines/init.sh — idempotent bootstrap of ~/second-brain vault.
# Optional env: BRAIN_VAULT_OVERRIDE (used by tests; defaults to ~/second-brain)

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/../lib/log.sh"

vault="${BRAIN_VAULT_OVERRIDE:-$HOME/second-brain}"

mkdir -p "$vault" \
         "$vault/00-Inbox" \
         "$vault/10-Sources/_attachments" \
         "$vault/20-Notes" \
         "$vault/30-Canvases" \
         "$vault/40-Bases" \
         "$vault/90-Graphs"

for d in 00-Inbox "10-Sources/_attachments" 20-Notes 30-Canvases 40-Bases 90-Graphs; do
  touch "$vault/$d/.gitkeep"
done

if [ ! -f "$vault/brain.config.yml" ]; then
  cat > "$vault/brain.config.yml" <<EOF
# Single source of truth for /brain pipelines.
vault: $vault
inbox: 00-Inbox
sources: 10-Sources
graphs: 90-Graphs

qmd:
  collections:
    - name: brain
      path: .
      pattern: "**/*.md"
      exclude:
        - ".qmd/**"
        - ".graphify-out/**"
        - ".obsidian/**"

graphify:
  mode: standard
  whisper_model: base

markitdown:
  preserve_originals: true
  attachments_dir: 10-Sources/_attachments
EOF
  log_ok "wrote brain.config.yml"
else
  log_warn "brain.config.yml already exists — preserved"
fi

if [ ! -f "$vault/.gitignore" ]; then
  cat > "$vault/.gitignore" <<'EOF'
.qmd/
.graphify-out/
.obsidian/workspace*
.obsidian/cache
*.tmp
EOF
fi

if [ ! -f "$vault/README.md" ]; then
  cat > "$vault/README.md" <<EOF
# Second Brain

Obsidian-compatible vault. Operated via the \`/brain\` slash command in Claude
Code, or via \`brain\` from any shell (symlinked into ~/.local/bin).

## Folders

| Folder            | Contents                                            |
|-------------------|-----------------------------------------------------|
| \`00-Inbox/\`     | Fresh captures, untriaged                           |
| \`10-Sources/\`   | Markitdown-converted files (PDFs, docs, audio)      |
| \`20-Notes/\`     | Atomic notes (your own writing)                     |
| \`30-Canvases/\`  | JSON Canvas visual maps                             |
| \`40-Bases/\`     | Obsidian Base files (DB-style views)                |
| \`90-Graphs/\`    | graphify outputs (HTML + GRAPH_REPORT.md)           |

## Common operations

\`\`\`
brain capture <file-or-url-or-text>
brain reindex
brain status
brain query "your question"
brain canvas <topic>
\`\`\`

See \`brain.config.yml\` for paths and tool config.
EOF
fi

log_ok "vault ready at $vault"
```

- [ ] **Step 4: Make executable**

```bash
chmod +x /workspaces/claude-charlie/templates/brain/pipelines/init.sh
```

- [ ] **Step 5: Run test, verify pass**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_init.bats
```

Expected: `7 tests, 0 failures`.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/claude-charlie
git add templates/brain/pipelines/init.sh templates/brain/tests/test_init.bats
git commit -m "feat(brain): add pipelines/init.sh idempotent vault bootstrap"
```

---

## Task 9: `pipelines/capture.sh` (TDD — orchestrates classify → adapter)

**Files:**

- Create: `/workspaces/claude-charlie/templates/brain/tests/test_capture.bats`
- Create: `/workspaces/claude-charlie/templates/brain/pipelines/capture.sh`

- [ ] **Step 1: Write the failing test**

File: `/workspaces/claude-charlie/templates/brain/tests/test_capture.bats`

```bash
#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  setup_brain_temp_vault
}

teardown() {
  teardown_brain_temp_vault
}

@test "capture routes plain text to text adapter" {
  out="$("$ROOT/pipelines/capture.sh" "a quick thought")"
  [ -f "$out" ]
  grep -q '^type: text$' "$out"
}

@test "capture routes existing .md path to copy adapter" {
  src="$(mktemp --suffix=.md)"
  printf -- '---\nfoo: bar\n---\n\nhello\n' > "$src"
  out="$("$ROOT/pipelines/capture.sh" "$src")"
  [ -f "$out" ]
  grep -q "^hello$" "$out"
  rm "$src"
}

@test "capture routes URL to defuddle (skipped without defuddle)" {
  if ! command -v defuddle >/dev/null; then
    skip "defuddle not installed"
  fi
  out="$("$ROOT/pipelines/capture.sh" "https://example.com/")"
  [ -f "$out" ]
  grep -q '^type: url$' "$out"
}

@test "capture exits nonzero with empty input" {
  run "$ROOT/pipelines/capture.sh" ""
  [ "$status" -ne 0 ]
}
```

- [ ] **Step 2: Run test, verify fail**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_capture.bats
```

Expected: tests fail (script missing).

- [ ] **Step 3: Implement `pipelines/capture.sh`**

File: `/workspaces/claude-charlie/templates/brain/pipelines/capture.sh`

```bash
#!/usr/bin/env bash
# pipelines/capture.sh — classify input, route to adapter, return the new file path.
# Required env: BRAIN_VAULT, BRAIN_INBOX
# Args: $1 = input (URL, file path, or plain text). For text, can also be passed via stdin.
# Output: prints absolute path of the captured note.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"
# shellcheck disable=SC1091
source "$HERE/../lib/classify.sh"

input="${1:-}"
if [ -z "$input" ] && ! [ -t 0 ]; then
  input="$(cat)"
fi
[ -n "$input" ] || log_die "capture: empty input"

kind="$(classify "$input")"

case "$kind" in
  url)
    "$HERE/../adapters/defuddle.sh" "$input"
    ;;
  copy)
    # Existing .md file: copy verbatim into inbox, prepend frontmatter if missing.
    : "${BRAIN_VAULT:?BRAIN_VAULT must be set}"
    : "${BRAIN_INBOX:=00-Inbox}"
    target_dir="$BRAIN_VAULT/$BRAIN_INBOX"
    mkdir -p "$target_dir"
    base="$(basename "$input")"
    target="$target_dir/$base"
    i=1
    while [ -e "$target" ]; do
      target="$target_dir/${base%.md}-$i.md"
      i=$((i + 1))
    done
    if head -1 "$input" | grep -q '^---$'; then
      cp "$input" "$target.tmp" && mv "$target.tmp" "$target"
    else
      tmp="$target.tmp"
      {
        printf -- '---\n'
        printf 'source: %s\n' "$input"
        printf 'captured_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf 'type: md\n'
        printf 'tags: [inbox]\n'
        printf -- '---\n\n'
        cat "$input"
      } > "$tmp"
      mv "$tmp" "$target"
    fi
    echo "$target"
    ;;
  markitdown)
    "$HERE/../adapters/markitdown.sh" "$input"
    ;;
  text)
    printf '%s\n' "$input" | "$HERE/../adapters/text.sh"
    ;;
  *)
    log_die "capture: unknown classification: $kind"
    ;;
esac
```

- [ ] **Step 4: Make executable**

```bash
chmod +x /workspaces/claude-charlie/templates/brain/pipelines/capture.sh
```

- [ ] **Step 5: Run test, verify pass**

```bash
cd /workspaces/claude-charlie/templates/brain/tests
bats test_capture.bats
```

Expected: `4 tests, 0 failures` (URL test skipped if defuddle missing).

- [ ] **Step 6: Commit**

```bash
cd /workspaces/claude-charlie
git add templates/brain/pipelines/capture.sh templates/brain/tests/test_capture.bats
git commit -m "feat(brain): add pipelines/capture.sh orchestrator"
```

---

## Task 10: `pipelines/reindex.sh`, `status.sh`, `query.sh` (TDD-light — tool passthroughs)

**Files:**

- Create: `/workspaces/claude-charlie/templates/brain/pipelines/reindex.sh`
- Create: `/workspaces/claude-charlie/templates/brain/pipelines/status.sh`
- Create: `/workspaces/claude-charlie/templates/brain/pipelines/query.sh`
- Create: `/workspaces/claude-charlie/templates/brain/tests/test_status.bats`

> **Why TDD-light:** these three are thin passthroughs to `qmd` / `graphify`. We test that they invoke the right binary with the right args (using a fake binary in PATH) rather than re-testing those tools' behavior.

- [ ] **Step 1: Implement `pipelines/reindex.sh`**

File: `/workspaces/claude-charlie/templates/brain/pipelines/reindex.sh`

```bash
#!/usr/bin/env bash
# pipelines/reindex.sh — run qmd embed and graphify --update against the vault.
# Required env: BRAIN_VAULT
# Exit code: 0 only if both succeeded; 1 if either failed.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${BRAIN_VAULT:?BRAIN_VAULT must be set}"

qmd_status=0
graphify_status=0

log_step "Reindex (1/2) — qmd embed"
if command -v qmd >/dev/null; then
  (cd "$BRAIN_VAULT" && qmd embed) || qmd_status=$?
else
  log_warn "qmd not installed — skipping"
  qmd_status=127
fi

log_step "Reindex (2/2) — graphify --update --obsidian"
if command -v graphify >/dev/null; then
  graphify "$BRAIN_VAULT" --update --obsidian --obsidian-dir "$BRAIN_VAULT" || graphify_status=$?
else
  log_warn "graphify not installed — skipping"
  graphify_status=127
fi

date -u +%Y-%m-%dT%H:%M:%SZ > "$BRAIN_VAULT/.graphify-out/last_reindex.txt" 2>/dev/null || true

if [ "$qmd_status" -eq 0 ] && [ "$graphify_status" -eq 0 ]; then
  log_ok "reindex complete"
  exit 0
fi
log_fail "reindex failures: qmd=$qmd_status graphify=$graphify_status"
exit 1
```

- [ ] **Step 2: Implement `pipelines/status.sh`**

File: `/workspaces/claude-charlie/templates/brain/pipelines/status.sh`

```bash
#!/usr/bin/env bash
# pipelines/status.sh — print vault stats.
# Required env: BRAIN_VAULT, BRAIN_INBOX, BRAIN_SOURCES, BRAIN_GRAPHS

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${BRAIN_VAULT:?BRAIN_VAULT must be set}"
: "${BRAIN_INBOX:=00-Inbox}"
: "${BRAIN_SOURCES:=10-Sources}"
: "${BRAIN_GRAPHS:=90-Graphs}"

count_md() {
  local d="$1"
  [ -d "$d" ] || { echo 0; return; }
  find "$d" -maxdepth 4 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' '
}

log_step "Brain status — $BRAIN_VAULT"
echo "  Inbox    : $(count_md "$BRAIN_VAULT/$BRAIN_INBOX") notes"
echo "  Sources  : $(count_md "$BRAIN_VAULT/$BRAIN_SOURCES") notes"
echo "  Notes    : $(count_md "$BRAIN_VAULT/20-Notes") notes"
echo "  Graphs   : $(count_md "$BRAIN_VAULT/$BRAIN_GRAPHS") notes"

if [ -f "$BRAIN_VAULT/.graphify-out/last_reindex.txt" ]; then
  echo "  Last reindex: $(cat "$BRAIN_VAULT/.graphify-out/last_reindex.txt")"
else
  echo "  Last reindex: never"
fi

if command -v qmd >/dev/null; then
  echo "  qmd      : $(qmd --version 2>/dev/null | head -1) [installed]"
else
  echo "  qmd      : NOT installed"
fi

if command -v graphify >/dev/null; then
  echo "  graphify : installed"
else
  echo "  graphify : NOT installed"
fi

if command -v markitdown >/dev/null; then
  echo "  markitdown : installed"
else
  echo "  markitdown : NOT installed"
fi
```

- [ ] **Step 3: Implement `pipelines/query.sh`**

File: `/workspaces/claude-charlie/templates/brain/pipelines/query.sh`

```bash
#!/usr/bin/env bash
# pipelines/query.sh — qmd hybrid query passthrough.
# Required env: BRAIN_VAULT
# Args: "$@" forwarded to `qmd query`.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${BRAIN_VAULT:?BRAIN_VAULT must be set}"
command -v qmd >/dev/null || log_die "qmd not installed"

cd "$BRAIN_VAULT"
qmd query "$@"
```

- [ ] **Step 4: Write the test for `status.sh`**

File: `/workspaces/claude-charlie/templates/brain/tests/test_status.bats`

```bash
#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  setup_brain_temp_vault
  echo "# n1" > "$BRAIN_VAULT/$BRAIN_INBOX/n1.md"
  echo "# n2" > "$BRAIN_VAULT/$BRAIN_INBOX/n2.md"
}

teardown() {
  teardown_brain_temp_vault
}

@test "status counts inbox notes" {
  out="$("$ROOT/pipelines/status.sh")"
  [[ "$out" == *"Inbox    : 2 notes"* ]]
}

@test "status reports last reindex 'never' when missing" {
  out="$("$ROOT/pipelines/status.sh")"
  [[ "$out" == *"Last reindex: never"* ]]
}
```

- [ ] **Step 5: Make executable + run tests**

```bash
chmod +x /workspaces/claude-charlie/templates/brain/pipelines/{reindex.sh,status.sh,query.sh}
cd /workspaces/claude-charlie/templates/brain/tests
bats test_status.bats
```

Expected: `2 tests, 0 failures`.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/claude-charlie
git add templates/brain/pipelines/{reindex.sh,status.sh,query.sh} \
        templates/brain/tests/test_status.bats
git commit -m "feat(brain): add reindex/status/query pipelines"
```

---

## Task 11: `pipelines/canvas.sh` (graphify 2-hop → JSON Canvas)

**Files:**

- Create: `/workspaces/claude-charlie/templates/brain/pipelines/canvas.sh`

> **TDD note:** This pipeline depends on a populated graphify graph. Unit-testing it requires a real graphify run, which is heavy. We deliberately keep it as an integration check during `setup.sh --test` rather than a fast bats test. The script itself is small enough to verify by inspection.

- [ ] **Step 1: Implement `pipelines/canvas.sh`**

File: `/workspaces/claude-charlie/templates/brain/pipelines/canvas.sh`

```bash
#!/usr/bin/env bash
# pipelines/canvas.sh — given a topic, find graphify node, traverse 2 hops,
# write a JSON Canvas file in 30-Canvases/.
# Required env: BRAIN_VAULT
# Args: $1 = topic string (matched against node names)
# Requires: jq, graphify-out/graph.json (from a prior `brain reindex`).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${BRAIN_VAULT:?BRAIN_VAULT must be set}"

topic="${1:-}"
[ -n "$topic" ] || log_die "canvas: topic argument required"
command -v jq >/dev/null || log_die "jq required"

graph="$BRAIN_VAULT/.graphify-out/graph.json"
[ -f "$graph" ] || graph="$BRAIN_VAULT/90-Graphs/graph.json"
[ -f "$graph" ] || log_die "no graph.json found — run /brain reindex first"

# Find best-matching node (case-insensitive contains).
node_id="$(jq -r --arg q "$topic" '
  .nodes // [] |
  map(select((.label // .id // "" | ascii_downcase) | contains($q | ascii_downcase))) |
  sort_by(.label // .id // "") |
  (.[0].id // empty)
' "$graph")"
[ -n "$node_id" ] || log_die "canvas: no node matches \"$topic\""

# Collect 2-hop neighborhood node ids.
nodes_json="$(jq --arg src "$node_id" '
  ((.edges // []) | map(select(.source == $src or .target == $src))) as $e1 |
  ($e1 | map(select(.source == $src) | .target) +
         map(select(.target == $src) | .source)) as $hop1 |
  ((.edges // []) | map(select((.source as $s | $hop1 | index($s)) or
                               (.target as $t | $hop1 | index($t))))) as $e2 |
  ($e2 | map(.source) + map(.target)) as $hop2 |
  ([$src] + $hop1 + $hop2 | unique) as $ids |
  .nodes // [] | map(select(.id as $id | $ids | index($id)))
' "$graph")"

# Build a JSON Canvas document.
out_dir="$BRAIN_VAULT/30-Canvases"
mkdir -p "$out_dir"
slug="$(printf '%s' "$topic" | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-40)"
target="$out_dir/$slug.canvas"

jq -n --argjson n "$nodes_json" --arg topic "$topic" '
  def card($i): {
    id: ($n[$i].id // ("n"+($i|tostring))),
    type: "text",
    text: ("**" + ($n[$i].label // $n[$i].id // "") + "**\n\n" + ($n[$i].summary // "")),
    x: ((($i % 5) * 320) - 800),
    y: ((($i / 5 | floor) * 200) - 400),
    width: 280,
    height: 160
  };
  {
    nodes: ([range(0; ($n|length)) | card(.)]),
    edges: []
  }
' > "$target.tmp"
mv "$target.tmp" "$target"

log_ok "canvas written: $target"
echo "$target"
```

- [ ] **Step 2: Make executable**

```bash
chmod +x /workspaces/claude-charlie/templates/brain/pipelines/canvas.sh
```

- [ ] **Step 3: Smoke test (manual — script-level only)**

```bash
mkdir -p /tmp/canvas-test/.graphify-out /tmp/canvas-test/30-Canvases
cat > /tmp/canvas-test/.graphify-out/graph.json <<'EOF'
{
  "nodes": [
    {"id":"a","label":"Alpha","summary":"first node"},
    {"id":"b","label":"Beta","summary":"second"},
    {"id":"c","label":"Gamma","summary":"third"}
  ],
  "edges": [
    {"source":"a","target":"b"},
    {"source":"b","target":"c"}
  ]
}
EOF
BRAIN_VAULT=/tmp/canvas-test \
  /workspaces/claude-charlie/templates/brain/pipelines/canvas.sh "alpha"
ls /tmp/canvas-test/30-Canvases/
rm -rf /tmp/canvas-test
```

Expected: `alpha.canvas` listed.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/claude-charlie
git add templates/brain/pipelines/canvas.sh
git commit -m "feat(brain): add canvas pipeline (graphify 2-hop → JSON Canvas)"
```

---

## Task 12: `brain` main router

**Files:**

- Create: `/workspaces/claude-charlie/templates/brain/brain`

- [ ] **Step 1: Implement the router**

File: `/workspaces/claude-charlie/templates/brain/brain`

```bash
#!/usr/bin/env bash
# brain — main router for second-brain pipelines.
# Subcommands: capture, reindex, status, query, canvas, init, help

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib/log.sh"
# shellcheck disable=SC1091
source "$HERE/lib/config.sh"

CONFIG_PATH="${BRAIN_CONFIG:-$HOME/second-brain/brain.config.yml}"

usage() {
  cat <<'EOF'
brain — second-brain orchestrator.

Usage:
  brain capture <file|url|"text...">      Convert input → markdown in 00-Inbox/
  brain reindex                            qmd embed + graphify --update
  brain status                             Vault stats + tool availability
  brain query "<question>"                 Hybrid qmd search
  brain canvas <topic>                     Build JSON Canvas of topic neighborhood
  brain init                               Bootstrap or repair the vault
  brain help                               This message
EOF
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  init|help|-h|--help)
    : # config not required for these
    ;;
  *)
    config_load "$CONFIG_PATH"
    ;;
esac

case "$cmd" in
  capture)
    "$HERE/pipelines/capture.sh" "$@"
    ;;
  reindex)
    "$HERE/pipelines/reindex.sh" "$@"
    ;;
  status)
    "$HERE/pipelines/status.sh"
    ;;
  query)
    "$HERE/pipelines/query.sh" "$@"
    ;;
  canvas)
    "$HERE/pipelines/canvas.sh" "$@"
    ;;
  init)
    "$HERE/pipelines/init.sh"
    ;;
  help|-h|--help|"")
    usage
    ;;
  *)
    log_fail "unknown subcommand: $cmd"
    usage
    exit 2
    ;;
esac
```

- [ ] **Step 2: Make executable**

```bash
chmod +x /workspaces/claude-charlie/templates/brain/brain
```

- [ ] **Step 3: Smoke test the router**

```bash
/workspaces/claude-charlie/templates/brain/brain help
/workspaces/claude-charlie/templates/brain/brain init
ls ~/second-brain/  # should show the folder structure
```

Expected: `help` prints usage; `init` creates `~/second-brain/`.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/claude-charlie
git add templates/brain/brain
git commit -m "feat(brain): add main router with subcommand dispatch"
```

---

## Task 13: `.claude/commands/brain.md` slash command

**Files:**

- Create: `/workspaces/claude-charlie/.claude/commands/brain.md`

- [ ] **Step 1: Implement the slash command**

File: `/workspaces/claude-charlie/.claude/commands/brain.md`

````markdown
---
description: Second-brain orchestrator — capture, reindex, status, query, canvas
allowed-tools: Bash
---

# /brain

Combine markitdown, kepano/obsidian-skills, graphify, and tobi/qmd into a single
second-brain workflow backed by `~/second-brain/`. See
`docs/superpowers/specs/2026-04-25-second-brain-design.md` for the full design.

## Usage

```
/brain capture <file-or-url-or-text>      → convert + land in 00-Inbox/
/brain reindex                            → qmd embed + graphify --update
/brain status                             → vault stats and tool availability
/brain query "<question>"                 → hybrid qmd search
/brain canvas <topic>                     → JSON Canvas of topic neighborhood
/brain init                               → bootstrap or repair the vault
```

## What to do when invoked

1. Parse the user's subcommand and args from `$ARGUMENTS`.
2. Resolve the brain script path: `${BRAIN_HOME:-$HOME/.claude/scripts/brain}/brain`.
3. Run that command via Bash, forwarding all arguments.
4. Stream output back to the user.
5. If the subcommand is `capture`, after success suggest `/brain reindex` only if
   the user has captured >= 5 files since last reindex (check
   `$BRAIN_VAULT/.graphify-out/last_reindex.txt` mtime vs newest inbox file).

## Examples

- `/brain capture ~/Downloads/paper.pdf` — runs markitdown, lands a markdown copy
  in `00-Inbox/` and the original in `10-Sources/_attachments/`.
- `/brain capture https://example.com/article` — runs defuddle, lands cleaned markdown.
- `/brain capture "an idea worth keeping"` — writes a plain note from the text.
- `/brain reindex` — re-runs qmd embed and graphify (incremental).
- `/brain query "what do I know about X"` — qmd hybrid search.

## Notes

- qmd is also registered as an MCP server, so you can ask Claude to search the
  brain mid-conversation without using `/brain query`.
- The vault is a regular Obsidian vault. Open it in Obsidian directly any time.
````

- [ ] **Step 2: Smoke test** (after Task 14 makes the script available globally — for now, manual verification)

```bash
ls /workspaces/claude-charlie/.claude/commands/brain.md
```

- [ ] **Step 3: Commit**

```bash
cd /workspaces/claude-charlie
git add .claude/commands/brain.md
git commit -m "feat(brain): add /brain slash command"
```

---

## Task 14: setup.sh — `ensure_python` + `ensure_markitdown` + `ensure_yq` + `ensure_jq` + `ensure_bats`

**Files:**

- Modify: `/workspaces/claude-charlie/setup.sh:after-line-364` (insert Step 12 before Summary)

- [ ] **Step 1: Verify current setup.sh structure**

```bash
grep -n "^# ─── Summary ─" /workspaces/claude-charlie/setup.sh
```

Expected: line ~365–367. Insertion point is **immediately before** that line.

- [ ] **Step 2: Insert prerequisite-ensuring functions for the brain stack**

Insert this block before `# ─── Summary ─` in `/workspaces/claude-charlie/setup.sh`:

```bash
# ─── Step 12: Second Brain stack ─────────────────────────────────────

log_step "Step 12: Installing Second-Brain stack..."

ensure_python3() {
  if command -v python3 >/dev/null 2>&1; then
    log_ok "python3 found: $(python3 --version 2>&1)"
  else
    log_warn "python3 not found. Installing..."
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update && sudo apt-get install -y python3 python3-pip pipx
    elif command -v brew >/dev/null 2>&1; then
      brew install python pipx
    else
      log_fail "Cannot auto-install python3. Install from https://python.org"
      ERRORS=$((ERRORS + 1))
      return
    fi
    if command -v python3 >/dev/null 2>&1; then
      log_ok "python3 installed: $(python3 --version 2>&1)"
    else
      log_fail "Failed to install python3"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_pipx() {
  if command -v pipx >/dev/null 2>&1; then
    log_ok "pipx found: $(pipx --version 2>&1)"
  else
    log_warn "pipx not found. Installing..."
    python3 -m pip install --user pipx 2>/dev/null || true
    python3 -m pipx ensurepath 2>/dev/null || true
    export PATH="$HOME/.local/bin:$PATH"
    if command -v pipx >/dev/null 2>&1; then
      log_ok "pipx installed"
    else
      log_fail "Failed to install pipx"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_markitdown() {
  if command -v markitdown >/dev/null 2>&1; then
    log_ok "markitdown found"
  else
    log_warn "markitdown not found. Installing markitdown[all] via pipx..."
    pipx install 'markitdown[all]' 2>/dev/null || pipx install markitdown
    if command -v markitdown >/dev/null 2>&1; then
      log_ok "markitdown installed"
    else
      log_fail "Failed to install markitdown. Run: pipx install 'markitdown[all]'"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_yq() {
  if command -v yq >/dev/null 2>&1; then
    log_ok "yq found: $(yq --version 2>&1 | head -1)"
  else
    log_warn "yq not found. Installing..."
    if command -v apt-get >/dev/null 2>&1; then
      local arch
      arch="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
      sudo wget -qO /usr/local/bin/yq \
        "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_${arch}" \
        && sudo chmod +x /usr/local/bin/yq
    elif command -v brew >/dev/null 2>&1; then
      brew install yq
    else
      log_fail "Cannot auto-install yq. Install from https://github.com/mikefarah/yq"
      ERRORS=$((ERRORS + 1))
      return
    fi
    if command -v yq >/dev/null 2>&1; then
      log_ok "yq installed"
    else
      log_fail "Failed to install yq"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_jq() {
  if command -v jq >/dev/null 2>&1; then
    log_ok "jq found: $(jq --version 2>&1)"
  else
    log_warn "jq not found. Installing..."
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get install -y jq
    elif command -v brew >/dev/null 2>&1; then
      brew install jq
    else
      log_fail "Cannot auto-install jq"
      ERRORS=$((ERRORS + 1))
      return
    fi
    if command -v jq >/dev/null 2>&1; then
      log_ok "jq installed"
    else
      log_fail "Failed to install jq"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_bats() {
  if command -v bats >/dev/null 2>&1; then
    log_ok "bats found: $(bats --version 2>&1 | head -1)"
  else
    log_warn "bats not found. Installing..."
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get install -y bats
    elif command -v brew >/dev/null 2>&1; then
      brew install bats-core
    else
      npm install -g bats
    fi
    if command -v bats >/dev/null 2>&1; then
      log_ok "bats installed"
    else
      log_warn "bats install failed — tests will be unavailable until bats is installed manually"
    fi
  fi
}

ensure_python3
ensure_pipx
ensure_markitdown
ensure_yq
ensure_jq
ensure_bats
```

- [ ] **Step 3: Run setup.sh up to Step 12 to verify (dry-run by checking idempotency)**

```bash
cd /workspaces/claude-charlie
bash setup.sh 2>&1 | tail -40
```

Expected: Step 12 logs `python3 found`, `pipx found`, etc., or installs them; no fatal errors. ERRORS counter is unaffected if all are present.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/claude-charlie
git add setup.sh
git commit -m "feat(setup): step 12 — ensure python/pipx/markitdown/yq/jq/bats"
```

---

## Task 15: setup.sh — `ensure_qmd` + `ensure_graphify_python`

**Files:**

- Modify: `/workspaces/claude-charlie/setup.sh` (extend Step 12 block)

- [ ] **Step 1: Append qmd + graphify ensures inside Step 12**

Add **inside** the Step 12 block (after `ensure_bats`), before the call sequence. Then add invocations:

```bash
ensure_qmd() {
  if command -v qmd >/dev/null 2>&1; then
    log_ok "qmd found: $(qmd --version 2>&1 | head -1)"
  else
    log_warn "qmd not found. Installing @tobilu/qmd..."
    if command -v bun >/dev/null 2>&1; then
      bun install -g @tobilu/qmd
    elif command -v npm >/dev/null 2>&1; then
      npm install -g @tobilu/qmd
    else
      log_fail "Need bun or npm to install qmd"
      ERRORS=$((ERRORS + 1))
      return
    fi
    if command -v qmd >/dev/null 2>&1; then
      log_ok "qmd installed"
      log_warn "qmd will download GGUF models on first 'qmd embed' (~hundreds of MB)"
    else
      log_fail "Failed to install qmd"
      ERRORS=$((ERRORS + 1))
    fi
  fi
}

ensure_graphify_python() {
  if command -v graphify >/dev/null 2>&1; then
    log_ok "graphify found"
  else
    log_warn "graphify not found. Installing..."
    if command -v uv >/dev/null 2>&1; then
      uv tool install graphify || uv tool install graphifyy
    elif command -v pipx >/dev/null 2>&1; then
      pipx install graphify || pipx install graphifyy
    else
      log_fail "Need uv or pipx to install graphify"
      ERRORS=$((ERRORS + 1))
      return
    fi
    if command -v graphify >/dev/null 2>&1; then
      log_ok "graphify installed"
    else
      log_warn "graphify install attempted — may need manual follow-up"
    fi
  fi
}

ensure_obsidian_skills_plugin() {
  if [ -d "$HOME/.claude/plugins/cache/obsidian-skills" ]; then
    log_ok "obsidian-skills plugin present"
  else
    log_warn "obsidian-skills plugin not found at ~/.claude/plugins/cache/obsidian-skills"
    log_warn "Install via: claude plugin marketplace add kepano/obsidian-skills && claude plugin install obsidian-skills"
  fi
}
```

Then update the invocation sequence at the bottom of the Step 12 block:

```bash
ensure_python3
ensure_pipx
ensure_markitdown
ensure_yq
ensure_jq
ensure_bats
ensure_qmd
ensure_graphify_python
ensure_obsidian_skills_plugin
```

- [ ] **Step 2: Run setup.sh, verify Step 12 outputs**

```bash
cd /workspaces/claude-charlie
bash setup.sh 2>&1 | grep -A1 "Step 12"
bash setup.sh 2>&1 | grep -E "(qmd|graphify|obsidian-skills)"
```

Expected: each tool either reports `found` or attempts install, with clear log lines.

- [ ] **Step 3: Commit**

```bash
cd /workspaces/claude-charlie
git add setup.sh
git commit -m "feat(setup): step 12 — ensure qmd, graphify, obsidian-skills"
```

---

## Task 16: setup.sh — `install_brain_scripts` (rsync + symlink)

**Files:**

- Modify: `/workspaces/claude-charlie/setup.sh` (extend Step 12)

- [ ] **Step 1: Add `install_brain_scripts` function**

Append inside the Step 12 block, after `ensure_obsidian_skills_plugin`:

```bash
install_brain_scripts() {
  local src="$SCRIPT_DIR/templates/brain"
  local dst="$HOME/.claude/scripts/brain"

  if [ ! -d "$src" ]; then
    log_fail "templates/brain/ missing in repo"
    ERRORS=$((ERRORS + 1))
    return
  fi

  mkdir -p "$dst"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude 'tests/' "$src/" "$dst/"
  else
    cp -R "$src/." "$dst/"
    rm -rf "$dst/tests"
  fi

  chmod +x "$dst/brain" "$dst"/adapters/*.sh "$dst"/pipelines/*.sh

  mkdir -p "$HOME/.local/bin"
  ln -sf "$dst/brain" "$HOME/.local/bin/brain"

  # Slash command
  mkdir -p "$HOME/.claude/commands"
  cp "$SCRIPT_DIR/.claude/commands/brain.md" "$HOME/.claude/commands/brain.md"

  log_ok "brain scripts installed at $dst"
  log_ok "brain symlinked to ~/.local/bin/brain"
  log_ok "/brain slash command installed"
}
```

And add `install_brain_scripts` to the invocation sequence at the bottom of the Step 12 block.

- [ ] **Step 2: Run setup.sh, verify install**

```bash
cd /workspaces/claude-charlie
bash setup.sh 2>&1 | grep "brain"
ls -la ~/.claude/scripts/brain/
ls -la ~/.local/bin/brain
ls ~/.claude/commands/brain.md
```

Expected: scripts under `~/.claude/scripts/brain/`, symlink at `~/.local/bin/brain`, slash command at `~/.claude/commands/brain.md`.

- [ ] **Step 3: Smoke test `brain` from any shell**

```bash
brain help
```

Expected: prints usage. (If `~/.local/bin` is not on PATH, run `~/.local/bin/brain help` instead and add a PATH note.)

- [ ] **Step 4: Commit**

```bash
cd /workspaces/claude-charlie
git add setup.sh
git commit -m "feat(setup): step 12 — install brain scripts + slash command"
```

---

## Task 17: setup.sh — `register_qmd_mcp` (idempotent jq merge)

**Files:**

- Modify: `/workspaces/claude-charlie/setup.sh` (extend Step 12)

- [ ] **Step 1: Add `register_qmd_mcp` function**

Append inside the Step 12 block:

```bash
register_qmd_mcp() {
  local settings="$HOME/.claude/settings.json"
  command -v jq >/dev/null || { log_fail "jq required for MCP registration"; ERRORS=$((ERRORS + 1)); return; }

  if [ ! -f "$settings" ]; then
    echo '{}' > "$settings"
  fi

  # Validate existing JSON before mutating; back up if bad.
  if ! jq empty "$settings" 2>/dev/null; then
    log_warn "settings.json is malformed — backing up and resetting"
    cp "$settings" "${settings}.broken.$(date +%s).bak"
    echo '{}' > "$settings"
  fi

  # Backup once before mutation.
  cp "$settings" "${settings}.bak"

  jq '.mcpServers = ((.mcpServers // {}) + {qmd: {command: "qmd", args: ["mcp"]}})' \
    "$settings" > "${settings}.tmp" && mv "${settings}.tmp" "$settings"

  if jq -e '.mcpServers.qmd.command == "qmd"' "$settings" >/dev/null; then
    log_ok "qmd MCP registered in $settings"
  else
    log_fail "failed to register qmd MCP"
    ERRORS=$((ERRORS + 1))
  fi
}
```

And add `register_qmd_mcp` to the invocation sequence at the bottom of Step 12.

- [ ] **Step 2: Verify idempotency — run twice**

```bash
cd /workspaces/claude-charlie
bash setup.sh 2>&1 | grep -i "qmd MCP"
bash setup.sh 2>&1 | grep -i "qmd MCP"
jq '.mcpServers' ~/.claude/settings.json
```

Expected: both runs log `qmd MCP registered`; `.mcpServers.qmd` exists exactly once.

- [ ] **Step 3: Commit**

```bash
cd /workspaces/claude-charlie
git add setup.sh
git commit -m "feat(setup): step 12 — idempotent qmd MCP registration via jq"
```

---

## Task 18: setup.sh — `bootstrap_vault` + `--test` flag

**Files:**

- Modify: `/workspaces/claude-charlie/setup.sh` (extend Step 12 + add flag handling at top)

- [ ] **Step 1: Add `bootstrap_vault` function inside Step 12**

```bash
bootstrap_vault() {
  if [ -d "$HOME/second-brain" ]; then
    log_ok "vault already exists at ~/second-brain"
  else
    "$HOME/.claude/scripts/brain/brain" init
    log_ok "vault bootstrapped"
  fi
}
```

And add `bootstrap_vault` to the Step 12 invocation sequence (last call before the next section).

- [ ] **Step 2: Add flag handling near the top of setup.sh** (after the `set -euo pipefail` line, before Step 1)

```bash
RUN_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --test|-t) RUN_TESTS=1 ;;
  esac
done
```

- [ ] **Step 3: Add a `--test` execution block** at the **end** of Step 12 (after `bootstrap_vault`), before the Summary section:

```bash
if [ "$RUN_TESTS" -eq 1 ]; then
  log_step "Step 12.1: Running brain bats tests..."
  if command -v bats >/dev/null 2>&1; then
    if bats "$SCRIPT_DIR/templates/brain/tests/" 2>&1 | tail -20; then
      log_ok "brain tests passed"
    else
      log_fail "brain tests failed"
      ERRORS=$((ERRORS + 1))
    fi
  else
    log_warn "bats not installed — tests skipped"
  fi
fi
```

- [ ] **Step 4: Run setup.sh with --test flag**

```bash
cd /workspaces/claude-charlie
bash setup.sh --test 2>&1 | tail -30
```

Expected: full setup, then test run, then a final summary; exit 0.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/claude-charlie
git add setup.sh
git commit -m "feat(setup): step 12 — bootstrap_vault + --test flag for bats run"
```

---

## Task 19: End-to-end smoke test (manual)

> **No code, no commits.** This is a checklist run after Tasks 1–18 are merged.

- [ ] **Step 1: Fresh-shell setup test**

```bash
cd /workspaces/claude-charlie
bash setup.sh --test 2>&1 | tee /tmp/setup-output.log
```

Expected: zero ERRORS, all 11 prior steps + Step 12 + tests pass.

- [ ] **Step 2: Capture text**

```bash
brain capture "first thought in the second brain"
ls ~/second-brain/00-Inbox/
cat ~/second-brain/00-Inbox/*-first-thought-in-the-second-brain.md
```

Expected: file exists with frontmatter + body.

- [ ] **Step 3: Capture a file (markitdown)** — only if you have a sample PDF handy

```bash
brain capture ~/some-paper.pdf
ls ~/second-brain/10-Sources/_attachments/
ls ~/second-brain/00-Inbox/
```

Expected: PDF preserved under `_attachments/`, markdown version in `00-Inbox/`.

- [ ] **Step 4: Capture a URL (defuddle)**

```bash
brain capture "https://en.wikipedia.org/wiki/Knowledge_graph"
```

Expected: a markdown note with the article body.

- [ ] **Step 5: Reindex**

```bash
brain reindex
```

Expected: qmd embeds the new files; graphify writes graph outputs.

- [ ] **Step 6: Status**

```bash
brain status
```

Expected: counts > 0, last reindex timestamp is recent.

- [ ] **Step 7: Query**

```bash
brain query "knowledge graph"
```

Expected: top-N hits including the article you just captured.

- [ ] **Step 8: Verify MCP availability** (open a fresh `claude` session)

```bash
claude
# Inside the session, ask: "Use the qmd MCP to find what's in my brain about graphs."
```

Expected: Claude calls qmd's `query` tool and returns hits.

- [ ] **Step 9: Open the vault in Obsidian** (manual)

Confirm the vault opens, the folder layout matches, frontmatter renders as Properties.

- [ ] **Step 10: Canvas**

```bash
brain canvas "knowledge"
ls ~/second-brain/30-Canvases/
```

Expected: `knowledge.canvas` listed; opens in Obsidian as a canvas with topic-neighborhood nodes.

---

## Self-Review

I checked the plan against the spec:

**Spec coverage:**

- Architecture (vault + 4 tools + 2 surfaces): Task 1 (scaffolding), Tasks 14–18 (setup.sh wiring).
- Tool roles (markitdown / obsidian-skills / graphify / qmd): Tasks 6 / 7 / 10–11 / 17 respectively.
- `/brain` slash command + 6 subcommands: Task 13 (slash file) and Tasks 8–12 (each subcommand).
- Capture pipeline + frontmatter contract: Tasks 5–9 (adapters + capture orchestrator).
- Reindex pipeline (sequential, both-or-fail): Task 10.
- MCP wiring (jq idempotent merge with backup): Task 17.
- `brain.config.yml` (single source of truth): Task 8 writes it; Task 4 reads it.
- File layout (repo + installed): Task 1 (repo skeleton); Task 16 (rsync + symlink).
- `ensure_*` idempotent setup.sh pattern: Tasks 14–18.
- Error handling (atomic writes, exit codes, MCP backup): Tasks 5–7 (atomic), Task 10 (reindex codes), Task 17 (MCP backup).
- Testing strategy (3 layers: unit, adapter, pipeline): Task 2 (log unit), Task 3 (classify unit), Task 4 (config unit), Tasks 5–7 (adapter), Task 8 (init pipeline), Task 9 (capture pipeline), Task 10 (status pipeline), Task 18 (`--test` flag E2E).
- Risks/Mitigations (qmd model download warning, graphify incremental, MCP backup, bash-in-TS-codebase note): all covered in setup.sh logs (Task 15) or already in spec.

**Placeholders scan:** none (the only deferred item is the defuddle CLI flag verification, called out explicitly with a note in Task 7).

**Type/symbol consistency:** every script's env var names (`BRAIN_VAULT`, `BRAIN_INBOX`, `BRAIN_SOURCES`, `BRAIN_GRAPHS`, `BRAIN_MARKITDOWN_PRESERVE`, `BRAIN_MARKITDOWN_ATTACHMENTS`, `BRAIN_GRAPHIFY_MODE`) are consistent across `lib/config.sh`, the adapters, and the pipelines. Subcommand names in the router (Task 12) match the slash command's documented usage (Task 13).

**Spec gap fixed during planning:** the spec said `setup.sh --test` runs the bats suite but didn't specify how flags are parsed. Task 18 adds explicit `RUN_TESTS=0; for arg in "$@"; ...` handling at the top of `setup.sh`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-25-second-brain.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
