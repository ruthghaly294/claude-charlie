#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo 'Install Google Chrome for your platform and set EBAY_CHROME_EXECUTABLE.' >&2
  exit 1
fi

chrome_cache="$HOME/.cache/ebay-search"
chrome_binary="$chrome_cache/google-chrome/chrome"
if [[ -x "$chrome_binary" ]]; then
  "$chrome_binary" --version
  exit 0
fi

chrome_download="$(mktemp -d "${TMPDIR:-/tmp}/ebay-chrome-install.XXXXXX")"
trap 'rm -rf -- "$chrome_download"' EXIT
curl --fail --location --silent --show-error --max-time 180 \
  'https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb' \
  --output "$chrome_download/chrome.deb"
dpkg-deb --extract "$chrome_download/chrome.deb" "$chrome_download/extracted"
mkdir -p "$chrome_cache"
cp -a "$chrome_download/extracted/opt/google/chrome" "$chrome_cache/google-chrome"
"$chrome_binary" --version
if ! command -v xvfb-run >/dev/null || ! command -v xauth >/dev/null; then
  echo 'For headed Chrome on Linux without a display, install Xvfb and xauth.' >&2
fi
