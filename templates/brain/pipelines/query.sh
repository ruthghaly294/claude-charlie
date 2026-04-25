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
