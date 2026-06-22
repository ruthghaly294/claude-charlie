#!/usr/bin/env bash
# pipelines/curate.sh — Curate stage. For each signal note in $DECODE_SIGNALS:
#   1. dedup by url (archive later duplicates),
#   2. relevance-score against DECODE_KEYWORDS (token overlap, 0–1),
#   3. assign a cluster from the first matching keyword,
#   4. archive anything below DECODE_KEEP_THRESHOLD,
# then run `brain reindex` (qmd + graphify) unless DECODE_SKIP_REINDEX=1.
#
# Required env: DECODE_VAULT. Reads: DECODE_KEYWORDS, DECODE_KEEP_THRESHOLD.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${DECODE_VAULT:?DECODE_VAULT must be set}"
: "${DECODE_SIGNALS:=01-Signals}"
: "${DECODE_KEEP_THRESHOLD:=0.35}"

signals_dir="$DECODE_VAULT/$DECODE_SIGNALS"
archive_dir="$signals_dir/_archive"
mkdir -p "$archive_dir"
[ -d "$signals_dir" ] || { log_warn "curate: no signals dir — nothing to do"; exit 0; }

# keywords (newline-separated) → array
mapfile -t KEYWORDS < <(printf '%s\n' "${DECODE_KEYWORDS:-}" | grep -v '^$' || true)
total="${#KEYWORDS[@]}"

# Optional feedback multipliers (keyword → 0.50–1.50), produced by feedback.sh.
declare -A MULT
ranking="$DECODE_VAULT/${DECODE_FEEDBACK:-70-Feedback}/ranking.tsv"
if [ -f "$ranking" ]; then
  while IFS=$'\t' read -r rk rm; do
    [ -n "$rk" ] || continue
    MULT["$(printf '%s' "$rk" | tr '[:upper:]' '[:lower:]')"]="$rm"
  done < "$ranking"
fi

_slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-40
}

fm_value() { # $1 file, $2 key — first value of a frontmatter key
  sed -n -E "s/^$2: (.*)$/\1/p" "$1" | head -1
}

archive_note() { mv "$1" "$archive_dir/$(basename "$1")"; }

declare -A seen_urls
kept=0; archived=0

shopt -s nullglob
for f in "$signals_dir"/*.md; do
  [ -f "$f" ] || continue

  # 1. dedup by url
  url="$(fm_value "$f" url)"
  if [ -n "$url" ] && [ "$url" != '""' ]; then
    if [ -n "${seen_urls[$url]:-}" ]; then
      archive_note "$f"; archived=$((archived + 1)); continue
    fi
    seen_urls[$url]=1
  fi

  # 2. score against keywords (case-insensitive substring overlap)
  text="$(tr '[:upper:]' '[:lower:]' < "$f")"
  cluster="unclustered"
  if [ "$total" -gt 0 ]; then
    mults=()
    for kw in "${KEYWORDS[@]}"; do
      kwl="$(printf '%s' "$kw" | tr '[:upper:]' '[:lower:]')"
      [ -n "$kwl" ] || continue
      if [[ "$text" == *"$kwl"* ]]; then
        mults+=("${MULT[$kwl]:-1.0}")
        [ "$cluster" = "unclustered" ] && cluster="$(_slugify "$kw")"
      fi
    done
    # score = sum(matched multipliers) / total keywords, clamped to 1.00
    score="$(printf '%s\n' "${mults[@]:-}" | awk -v t="$total" '
      {s += $1} END { v = (t>0 ? s/t : 1); if (v>1) v=1; printf "%.2f", v }')"
  else
    score="1.00"   # no keywords configured → keep everything
  fi

  # 3. write score + cluster into the frontmatter (first block only)
  awk -v score="$score" -v cluster="$cluster" '
    /^---$/ { fm++; print; next }
    (fm==1 && /^score: /)   { print "score: " score; next }
    (fm==1 && /^cluster: /) { print "cluster: " cluster; next }
    { print }
  ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"

  # 4. archive below threshold
  below="$(awk -v s="$score" -v t="$DECODE_KEEP_THRESHOLD" 'BEGIN{print (s < t) ? 1 : 0}')"
  if [ "$below" -eq 1 ]; then
    archive_note "$f"; archived=$((archived + 1))
  else
    kept=$((kept + 1))
  fi
done
shopt -u nullglob

log_step "Curate — kept $kept, archived $archived (threshold $DECODE_KEEP_THRESHOLD)"

if [ "${DECODE_SKIP_REINDEX:-0}" != "1" ]; then
  log_step "Curate — reindex (qmd + graphify)"
  BRAIN_VAULT="$DECODE_VAULT" "$HERE/reindex.sh" || log_warn "curate: reindex reported issues (tools may be missing)"
fi
