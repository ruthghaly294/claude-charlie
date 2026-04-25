# Second Brain — Design Spec

**Date:** 2026-04-25
**Status:** Approved (pending implementation plan)
**Owner:** Ruth (`aaroncarlisle4@gmail.com`)

## Goal

Combine four independent local-first tools into one cohesive personal knowledge system — a "second brain" — installable via `setup.sh`:

1. **[microsoft/markitdown](https://github.com/microsoft/markitdown)** — converts any file (PDF / DOCX / PPTX / XLSX / audio / HTML / images) to markdown.
2. **[kepano/obsidian-skills](https://github.com/kepano/obsidian-skills)** — Claude skills for vault operations: `obsidian-cli`, `defuddle` (URL → markdown), `json-canvas`, `obsidian-markdown`, `obsidian-bases`.
3. **[safishamsi/graphify](https://github.com/safishamsi/graphify)** — turns a folder of files into a knowledge graph (HTML + JSON + GRAPH_REPORT.md), with `--obsidian` flag to write back into the vault.
4. **[tobi/qmd](https://github.com/tobi/qmd)** — local search engine (BM25 + vector + LLM rerank) with an MCP server.

The vault is **global** (`~/second-brain/`), Obsidian-compatible, and operated through one `/brain` slash command plus an always-on `qmd` MCP server.

## Non-Goals

- Multi-user / sync support. The vault is single-user, local-first.
- Replacing Obsidian. The vault is Obsidian-compatible; Obsidian is the canonical UI.
- Real-time auto-indexing. Reindexing is explicit (`/brain reindex`) — graphify and qmd embedding are slow enough that decoupling capture from indexing is a feature, not a limitation.
- Cloud / hosted AI. All four tools are local-first by design; we do not introduce cloud dependencies.

## Architecture

```
~/second-brain/                          ← Obsidian-compatible vault (root)
├── .obsidian/                           ← Obsidian config (created on first launch)
├── 00-Inbox/                            ← Fresh captures land here, untriaged
├── 10-Sources/                          ← Markitdown-converted files (PDF/DOCX/HTML/audio → .md)
│   └── _attachments/                    ← Original files preserved alongside
├── 20-Notes/                            ← Atomic notes (your own writing)
├── 30-Canvases/                         ← .canvas files (visual maps)
├── 40-Bases/                            ← .base files (DB-style views)
├── 90-Graphs/                           ← graphify HTML + GRAPH_REPORT.md (vault-visible)
├── .qmd/                                ← qmd index DB (gitignored, hidden from vault)
├── .graphify-out/                       ← graphify JSON / cache (gitignored)
└── brain.config.yml                     ← Single source of truth for paths/collections
```

### Tool Roles

| Tool              | Role                                                                    | Lifecycle                                 |
| ----------------- | ----------------------------------------------------------------------- | ----------------------------------------- |
| `markitdown`      | Input adapter — any file → markdown in `10-Sources/`                    | Invoked synchronously by `/brain capture` |
| `obsidian-skills` | Vault grammar — wikilinks, properties, canvas, bases, defuddle for URLs | Always-loaded Claude skills               |
| `graphify`        | Structural insight — cross-file connections in `90-Graphs/`             | Invoked by `/brain reindex`               |
| `qmd`             | Retrieval — BM25 + vector + rerank, exposed as MCP server               | Always-on stdio MCP per Claude session    |

### Two Integration Surfaces

1. **CLI** — `~/.claude/commands/brain.md` slash command with subcommands. Logic lives in `~/.claude/scripts/brain/` (testable, version-controlled).
2. **MCP** — qmd's MCP server registered globally in `~/.claude/settings.json`, available in every Claude session. Claude can search the brain mid-conversation without an explicit slash command.

graphify's MCP is opt-in (`/brain mcp-graphify`) — the graph isn't queried often enough to justify a second always-on MCP.

## Components

### `/brain` slash command

Single global command at `~/.claude/commands/brain.md` with these subcommands:

| Subcommand                             | Behavior                                                                                                                                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/brain capture <file-or-url-or-text>` | Detects input type → routes to right adapter → lands result in `00-Inbox/` with frontmatter. Does **not** auto-reindex.                                                                                                                |
| `/brain reindex`                       | Runs `qmd embed` (incremental) then `graphify --update --obsidian`.                                                                                                                                                                    |
| `/brain status`                        | Vault stats: file counts per folder, qmd index health, graphify last-run timestamp, MCP server reachability.                                                                                                                           |
| `/brain query "<question>"`            | Hybrid qmd query (lex + vec + rerank), returns top results with citations.                                                                                                                                                             |
| `/brain canvas <topic>`                | Finds the graphify node matching `<topic>`, traverses its 2-hop neighborhood, generates a `.canvas` file in `30-Canvases/` with one card per neighbor and edges from graphify. Uses `obsidian-skills:json-canvas` for the file format. |
| `/brain init`                          | Idempotent vault bootstrap. Also called by `setup.sh`.                                                                                                                                                                                 |

The slash command file is a thin Markdown wrapper — real logic lives in `~/.claude/scripts/brain/` so it is testable.

### Capture pipeline

```
/brain capture <input>
        │
        ▼
classify(input)
   • path + binary/office  → markitdown
   • path + already .md    → copy
   • http(s)://...         → defuddle (obsidian-skills)
   • plain text            → write as new note
        │
        ▼
write to ~/second-brain/00-Inbox/YYYY-MM-DD-<slug>.md
   ├── frontmatter: source, captured_at, type, original_path
   └── body: converted markdown
```

**Frontmatter contract** (Obsidian Properties-compatible):

```yaml
---
source: <original path or URL>
captured_at: 2026-04-25T14:30:00Z
type: pdf | docx | url | text | audio | image
original_path: 10-Sources/_attachments/<filename> # if preserved
tags: [inbox]
---
```

### Reindex pipeline

```
/brain reindex
   │
   ├─► qmd embed         (idempotent, only re-embeds changed files)
   │
   └─► graphify ~/second-brain --update --obsidian \
                --obsidian-dir ~/second-brain
```

Sequential, not parallel — they both read the vault but graphify's I/O can spike memory. Each runs independently; failure in one does not abort the other.

### MCP wiring

`~/.claude/settings.json` gets one new entry, idempotently merged via `jq`:

```json
{
  "mcpServers": {
    "qmd": {
      "command": "qmd",
      "args": ["mcp"]
    }
  }
}
```

Stdio mode (not HTTP daemon) — accepts a ~1s cold start per Claude session in exchange for zero process management. Can be upgraded to HTTP later via a `/brain mcp-http` toggle if cold-start latency becomes annoying.

### `brain.config.yml`

Single source of truth at vault root:

```yaml
vault: ~/second-brain
inbox: 00-Inbox
sources: 10-Sources
graphs: 90-Graphs
qmd:
  collections:
    - name: brain
      path: .
      pattern: "**/*.md"
      exclude: [".qmd/**", ".graphify-out/**", ".obsidian/**"]
graphify:
  mode: standard # or 'deep'
  whisper_model: base
markitdown:
  preserve_originals: true
  attachments_dir: 10-Sources/_attachments
```

Every script reads this file. No hardcoded paths in scripts.

## Implementation

### File layout (what the implementation creates)

```
~/.claude/
├── commands/
│   └── brain.md                          ← Slash command entry
├── scripts/brain/
│   ├── brain                             ← Main router (bash, executable)
│   ├── lib/
│   │   ├── config.sh                     ← Loads brain.config.yml
│   │   ├── classify.sh                   ← Input → adapter routing
│   │   └── log.sh                        ← Consistent logging
│   ├── adapters/
│   │   ├── markitdown.sh                 ← File → markdown
│   │   ├── defuddle.sh                   ← URL → markdown (uses obsidian-skills)
│   │   └── text.sh                       ← Stdin/inline text → note
│   ├── pipelines/
│   │   ├── capture.sh                    ← Orchestrates classify → adapter → write
│   │   ├── reindex.sh                    ← qmd embed + graphify --update
│   │   ├── status.sh
│   │   ├── query.sh
│   │   ├── canvas.sh
│   │   └── init.sh                       ← Bootstrap vault, write default config
│   └── tests/
│       ├── test_classify.bats            ← bats-core unit tests
│       ├── test_capture.bats
│       └── fixtures/                     ← sample.pdf, sample.html, etc.
└── settings.json                         ← qmd MCP entry merged here

~/second-brain/                            ← Created by /brain init
├── brain.config.yml
├── 00-Inbox/.gitkeep
├── 10-Sources/_attachments/.gitkeep
├── 20-Notes/.gitkeep
├── 30-Canvases/.gitkeep
├── 40-Bases/.gitkeep
├── 90-Graphs/.gitkeep
├── .gitignore                            ← .qmd/, .graphify-out/, .obsidian/workspace*
└── README.md                             ← Vault map for humans
```

The implementation also keeps a copy of `~/.claude/scripts/brain/` under `templates/brain/` in this repo so `setup.sh` can `rsync` it from a known source.

### setup.sh additions

A new step appended to `setup.sh`, matching the existing `ensure_*` idempotent pattern. Each function checks before installing, logs via `log_ok` / `log_warn` / `log_fail`, and increments `ERRORS` on failure so the existing summary catches it.

```bash
# ─── Step N: Second-Brain stack ──────────────────────────────────────

ensure_python()                  # markitdown needs python3 + pip
ensure_markitdown()              # pipx install 'markitdown[all]'
ensure_qmd()                     # npm i -g @tobilu/qmd  (or bun)
ensure_graphify_python()         # uv tool install graphify  ||  pipx install graphify
ensure_obsidian_skills_plugin()  # verify ~/.claude/plugins/cache/obsidian-skills exists
ensure_jq()                      # required for MCP registration
install_brain_scripts()          # rsync templates/brain/ → ~/.claude/scripts/brain/
                                  # symlink ~/.claude/scripts/brain/brain → ~/.local/bin/brain
register_qmd_mcp()               # idempotent jq merge into ~/.claude/settings.json
bootstrap_vault()                # ~/.claude/scripts/brain/brain init  (if vault missing)
```

A `setup.sh --test` flag is added that runs the bats suite after install to verify the chain end-to-end.

### Error handling boundaries

- **Adapters** propagate tool exit codes. On failure, no half-written file remains in `00-Inbox/`.
- **Vault writes** are atomic — write to `*.tmp`, then `mv`. Interrupts cannot leave half-written notes.
- **Reindex** runs qmd then graphify sequentially. If qmd fails, graphify still runs. Exit code = 1 if either failed; 0 only if both succeeded.
- **MCP registration** uses `jq` with write-then-rename. A malformed `settings.json` cannot result from a partial write.
- **`brain.config.yml`** validation runs on load; missing or malformed config aborts with a human-readable error pointing at the failing key.

### Testing strategy

Three layers, all using **bats-core**:

1. **Unit** (`test_classify.bats`) — pure-function: input → adapter name. No I/O.
2. **Adapter** (`test_markitdown.bats`, `test_defuddle.bats`, `test_text.bats`) — fixture file in, expected markdown out. Real subprocess, real fixtures, no mocks.
3. **Pipeline** (`test_capture.bats`, `test_reindex.bats`) — full `brain` command against a `mktemp -d` vault directory, asserts file lands with correct frontmatter and that reindex updates the qmd DB and graphify outputs.

Fixtures (`sample.pdf`, `sample.html`, `sample.docx`, `sample.txt`) are checked into the repo under `templates/brain/tests/fixtures/`.

CI runs the bats suite via the existing project hooks. `setup.sh --test` runs them after install for end-to-end verification.

## Decision Log

| Decision                | Choice                               | Rationale                                                                      |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| Vault location          | Global `~/second-brain/`             | Survives across projects; matches `setup.sh`'s global-tool pattern.            |
| Capture model           | Explicit `/brain capture` only       | No daemon to manage; user controls reindex timing (graphify is slow).          |
| Indexing cadence        | Manual `/brain reindex`              | Decouples fast capture from slow embedding/graph build.                        |
| qmd transport           | Stdio MCP                            | Zero process management. Upgradeable to HTTP if cold-start becomes annoying.   |
| graphify MCP            | Opt-in                               | Not queried often enough to justify a second always-on MCP.                    |
| Implementation language | Bash + bats                          | Every tool is already a CLI; lightest possible orchestration layer.            |
| Python tool installer   | `uv tool` (fallback `pipx`)          | Matches graphify's own SKILL.md preference.                                    |
| `brain` outside Claude  | Symlinked to `~/.local/bin/brain`    | Usable from any shell, not Claude-only.                                        |
| Folder naming           | Numeric prefixes (`00-`, `10-`, ...) | Sorts deterministically without user thought; matches kepano's own convention. |

## Risks & Mitigations

| Risk                                                               | Mitigation                                                                                                                                                           |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| qmd's GGUF model download is large (~hundreds of MB) on first run  | `setup.sh` warns before triggering download; `bootstrap_vault` defers first `qmd embed` until user runs `/brain reindex`.                                            |
| graphify on a multi-thousand-file vault may take many minutes      | `--update` flag is incremental after first run. `/brain status` surfaces last-run timestamp so user knows when reindex is stale.                                     |
| markitdown audio transcription needs whisper, large download       | `markitdown[all]` extra is opt-in; default `setup.sh` step prompts before installing the audio extras.                                                               |
| Bash scripts in a TypeScript codebase break the house style        | Documented exception in this spec. The orchestration layer is shell-native; everything it calls is a CLI. TypeScript would be ~3× more code with no behavioral gain. |
| `~/.claude/settings.json` has hand-edited entries we might clobber | `jq` merge preserves existing keys; only `mcpServers.qmd` is set. Backup written to `settings.json.bak` before merge.                                                |

## Open Questions

None at design approval. Any open questions surface during the implementation-plan phase (next step).

## Next Step

Invoke `superpowers:writing-plans` to produce a step-by-step implementation plan from this spec.
