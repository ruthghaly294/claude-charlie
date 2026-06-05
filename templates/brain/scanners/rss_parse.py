#!/usr/bin/env python3
"""Read an RSS/Atom feed from stdin, emit one NDJSON signal record per item."""
import sys
import json
import xml.etree.ElementTree as ET


def strip_ns(tag):
    return tag.split("}", 1)[1] if "}" in tag else tag


def main():
    feed = sys.argv[1] if len(sys.argv) > 1 else ""
    data = sys.stdin.read()
    if not data.strip():
        return
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return

    items = [el for el in root.iter() if strip_ns(el.tag) in ("item", "entry")]
    for it in items:
        rec = {
            "source": "rss",
            "title": "",
            "url": "",
            "published": "",
            "author": "",
            "tags": ["rss"],
            "raw": "",
            "feed": feed,
        }
        for c in it:
            tag = strip_ns(c.tag)
            if tag == "title":
                rec["title"] = (c.text or "").strip()
            elif tag == "link":
                href = c.get("href")
                rec["url"] = href if href else (c.text or "").strip()
            elif tag in ("pubDate", "published", "updated"):
                if not rec["published"]:
                    rec["published"] = (c.text or "").strip()
            elif tag in ("author", "creator"):
                rec["author"] = "".join(c.itertext()).strip()
            elif tag in ("description", "summary", "content"):
                if not rec["raw"]:
                    rec["raw"] = (c.text or "").strip()
        if rec["title"] or rec["url"]:
            print(json.dumps(rec, ensure_ascii=False))


if __name__ == "__main__":
    main()
