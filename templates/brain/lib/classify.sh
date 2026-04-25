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
