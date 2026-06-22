#!/usr/bin/env bash
# pipelines/feedback.sh — Feedback stage. Read a manually-provided metrics file
# ($DECODE_FEEDBACK/metrics.csv or metrics.md) of `keyword,value` performance
# pairs and write:
#   ranking.tsv  — keyword<TAB>multiplier (0.50–1.50), consumed by curate.sh
#   ranking.md   — human-readable table, best performer first
# Higher value ⇒ higher multiplier ⇒ that keyword's signals score higher.
#
# Required env: DECODE_VAULT.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${DECODE_VAULT:?DECODE_VAULT must be set}"
: "${DECODE_FEEDBACK:=70-Feedback}"
fb="$DECODE_VAULT/$DECODE_FEEDBACK"
mkdir -p "$fb"

src=""
if   [ -f "$fb/metrics.csv" ]; then src="$fb/metrics.csv"
elif [ -f "$fb/metrics.md" ];  then src="$fb/metrics.md"
fi
[ -n "$src" ] || { log_warn "feedback: no metrics.csv/metrics.md in $DECODE_FEEDBACK — nothing to do"; exit 0; }

# Extract clean keyword<TAB>value pairs from CSV or a markdown pipe-table.
pairs="$(awk -F'[,|]' '
  {
    k=$1; v=$2;
    if (k ~ /^[ \t]*$/) { k=$2; v=$3 }          # leading | in md tables
    gsub(/^[ \t]+|[ \t]+$/, "", k);
    gsub(/^[ \t]+|[ \t]+$/, "", v);
    if (k=="" || tolower(k)=="keyword") next;
    if (v ~ /^-?[0-9]+(\.[0-9]+)?$/) printf "%s\t%s\n", k, v;
  }' "$src")"

[ -n "$pairs" ] || { log_warn "feedback: no numeric keyword,value rows found in $src"; exit 0; }

# Compute multipliers in [0.50, 1.50] via min-max normalisation.
ranked="$(printf '%s\n' "$pairs" | awk -F'\t' '
  { k[NR]=$1; v[NR]=$2; if (min==""||$2<min) min=$2; if (max==""||$2>max) max=$2 }
  END {
    for (i=1;i<=NR;i++) {
      m = (max>min) ? 0.50 + (v[i]-min)/(max-min) : 1.00;
      printf "%s\t%.2f\t%s\n", k[i], m, v[i];
    }
  }')"

# ranking.tsv (machine): keyword<TAB>multiplier
printf '%s\n' "$ranked" | awk -F'\t' '{printf "%s\t%s\n", $1, $2}' > "$fb/ranking.tsv.tmp"
mv "$fb/ranking.tsv.tmp" "$fb/ranking.tsv"

# ranking.md (human): sorted by multiplier desc
{
  printf '# Feedback ranking\n\n'
  printf '_Derived from %s on %s._\n\n' "$(basename "$src")" "$(date -u +%Y-%m-%d)"
  printf '| keyword | multiplier | value |\n'
  printf '| --- | --- | --- |\n'
  printf '%s\n' "$ranked" | sort -t$'\t' -k2 -gr \
    | awk -F'\t' '{printf "| %s | %s | %s |\n", $1, $2, $3}'
} > "$fb/ranking.md.tmp"
mv "$fb/ranking.md.tmp" "$fb/ranking.md"

n="$(printf '%s\n' "$ranked" | grep -c . || true)"
log_step "Feedback — ranked $n keyword(s) → $DECODE_FEEDBACK/ranking.{tsv,md}"
