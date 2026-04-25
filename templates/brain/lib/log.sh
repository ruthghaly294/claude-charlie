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
