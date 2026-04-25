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
