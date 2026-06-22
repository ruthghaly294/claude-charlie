#!/usr/bin/env bash
# pipelines/init.sh — idempotent bootstrap of ~/second-brain vault.
# Optional env: BRAIN_VAULT_OVERRIDE (used by tests; defaults to ~/second-brain)

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/../lib/log.sh"

vault="${BRAIN_VAULT_OVERRIDE:-$HOME/second-brain}"

mkdir -p "$vault" \
         "$vault/00-Inbox" \
         "$vault/01-Signals/_archive" \
         "$vault/10-Sources/_attachments" \
         "$vault/20-Notes" \
         "$vault/25-Insights" \
         "$vault/30-Canvases" \
         "$vault/40-Bases" \
         "$vault/50-Decisions" \
         "$vault/60-Execution" \
         "$vault/70-Feedback" \
         "$vault/90-Graphs"

for d in 00-Inbox "01-Signals/_archive" "10-Sources/_attachments" 20-Notes \
         25-Insights 30-Canvases 40-Bases 50-Decisions 60-Execution \
         70-Feedback 90-Graphs; do
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

if [ ! -f "$vault/decode.config.yml" ]; then
  cat > "$vault/decode.config.yml" <<EOF
# DECODE — intelligence-to-execution config. Operated via the /decode command.
# API keys are read from the environment, never stored here.
vault: $vault

business:
  name: "My Business"
  description: "What this business does, in one line."
  keywords: ["keyword one", "keyword two"]
  competitors: ["https://competitor-a.com"]

sources:
  rss: ["https://hnrss.org/frontpage"]
  github_trending: { topics: ["ai-agents"], window: "weekly" }
  reddit: { subreddits: ["programming"] }
  hackernews: { query: "" }
  youtube: { channels: [], queries: [] }   # transcripts via yt-dlp
  google_cse: { enabled: false }            # needs GOOGLE_CSE_KEY + GOOGLE_CSE_ID
  twitter:     { enabled: false }           # needs TWITTER_BEARER
  producthunt: { enabled: false }           # needs PRODUCTHUNT_TOKEN

scoring:
  keep_threshold: 0.35

execute:
  top_n: 3
EOF
  log_ok "wrote decode.config.yml"
else
  log_warn "decode.config.yml already exists — preserved"
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
