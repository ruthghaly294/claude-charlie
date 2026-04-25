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
   the user has captured ≥ 5 files since last reindex (compare
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
