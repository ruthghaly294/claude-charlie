#!/usr/bin/env python3
"""
NotebookLM cookie refresh.
Converts Cookie-Editor JSON export to Playwright storage_state format.

Usage:
  python3 scripts/refresh_notebooklm_auth.py
  Paste Cookie Editor JSON, then Ctrl+D

Or pipe: pbpaste | python3 scripts/refresh_notebooklm_auth.py

Setup:
  1. Open https://notebooklm.google.com in your browser (logged into Google)
  2. Install the Cookie-Editor browser extension
  3. Click Cookie-Editor icon -> Export -> JSON
  4. Run this script and paste the JSON
"""
import json, sys, os, subprocess
from pathlib import Path

STORAGE_PATH = Path.home() / ".notebooklm" / "storage_state.json"

REQUIRED_COOKIES = [
    "SID", "HSID", "APISID", "SAPISID",
    "__Secure-1PSID", "__Secure-3PSID",
    "OSID", "__Secure-OSID",
]


def convert_cookie(c):
    pw = {
        "name": c["name"],
        "value": c["value"],
        "domain": c["domain"],
        "path": c.get("path", "/"),
        "secure": c.get("secure", False),
        "httpOnly": c.get("httpOnly", False),
    }
    ss = c.get("sameSite", "")
    pw["sameSite"] = (
        "Lax" if ss == "lax" else ("Strict" if ss == "strict" else "None")
    )
    if c.get("expirationDate"):
        pw["expires"] = c["expirationDate"]
    return pw


def main():
    if sys.stdin.isatty():
        print("Paste Cookie Editor JSON, then Ctrl+D:")
    raw = sys.stdin.read().strip()

    try:
        cookies = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Invalid JSON: {e}", file=sys.stderr)
        sys.exit(1)

    pw_cookies = [convert_cookie(c) for c in cookies]

    found = {c["name"] for c in cookies}
    missing = [name for name in REQUIRED_COOKIES if name not in found]
    if missing:
        print(f"Warning: missing cookies: {', '.join(missing)}", file=sys.stderr)
        print("Auth may not work without these.", file=sys.stderr)

    STORAGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    if STORAGE_PATH.exists():
        STORAGE_PATH.rename(STORAGE_PATH.with_suffix(".backup.json"))
    STORAGE_PATH.write_text(
        json.dumps({"cookies": pw_cookies, "origins": []}, indent=2)
    )
    print(f"Wrote {len(pw_cookies)} cookies to {STORAGE_PATH}")

    try:
        r = subprocess.run(
            ["notebooklm", "auth", "check"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if r.returncode == 0 and "pass" in r.stdout.lower():
            print("AUTH VALID")
        else:
            print("AUTH CHECK: cookies written but could not verify.")
            print("Run 'notebooklm auth check' manually to confirm.")
    except FileNotFoundError:
        print("notebooklm CLI not found. Run: pip install notebooklm-py")
    except Exception as e:
        print(f"Auth check error: {e}")


if __name__ == "__main__":
    main()
