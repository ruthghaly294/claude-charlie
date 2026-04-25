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

node_id="$(jq -r --arg q "$topic" '
  .nodes // [] |
  map(select((.label // .id // "" | ascii_downcase) | contains($q | ascii_downcase))) |
  sort_by(.label // .id // "") |
  (.[0].id // empty)
' "$graph")"
[ -n "$node_id" ] || log_die "canvas: no node matches \"$topic\""

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
