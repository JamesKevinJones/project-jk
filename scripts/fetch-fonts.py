#!/usr/bin/env python3
"""
Download Google Fonts into hud/fonts/ and write the @font-face CSS.

The console serves everything from 127.0.0.1 with no external requests, so the
fonts have to live on disk rather than being linked from Google. This fetches
them once and generates `hud/fonts/fonts.css` pointing at the local copies.

Swapping a typeface is one command, not a rebuild:

    python scripts/fetch-fonts.py "Archivo Black" "Fraunces:wght@400;600" \\
                                  "IBM Plex Mono:wght@400;600"

Then update --font-display / --font-serif / --font-mono in hud/hud.css to the
family names it reports. Re-running replaces everything in hud/fonts/.
"""

from __future__ import annotations

import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HUD_FONTS = Path(__file__).resolve().parent.parent / "hud" / "fonts"

# Google serves TTF to unknown clients and woff2 only to browsers that
# advertise support. Without a modern UA you silently get 3x the bytes.
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

DEFAULTS = [
    "Archivo Black",
    "Fraunces:opsz,wght@9..144,400;9..144,600",
    "IBM Plex Mono:wght@400;600",
]


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main() -> int:
    families = sys.argv[1:] or DEFAULTS
    HUD_FONTS.mkdir(parents=True, exist_ok=True)

    # clear previous run so a swap does not leave orphans behind
    for old in HUD_FONTS.glob("*"):
        old.unlink()

    query = "&".join("family=" + urllib.parse.quote(f) for f in families)
    url = f"https://fonts.googleapis.com/css2?{query}&display=swap"
    print(f"  fetching {len(families)} famil{'y' if len(families)==1 else 'ies'}")

    try:
        css = get(url).decode("utf-8")
    except Exception as e:
        print(f"  FAILED to reach Google Fonts: {e}", file=sys.stderr)
        print("  The console still runs; it falls back to system faces.",
              file=sys.stderr)
        return 1

    seen: dict[str, str] = {}
    count = 0

    def swap(m: re.Match) -> str:
        nonlocal count
        remote = m.group(1)
        if remote in seen:
            return f"url({seen[remote]})"
        fam = re.search(r"font-family: '([^']+)'", css[:m.start()][::-1][::-1])
        name = f"{slug(fam.group(1)) if fam else 'font'}-{count}.woff2"
        # derive a stable readable name from the URL path instead
        parts = urllib.parse.urlparse(remote).path.split("/")
        if len(parts) > 3:
            name = f"{parts[3]}-{count}.woff2"
        try:
            (HUD_FONTS / name).write_bytes(get(remote))
        except Exception as e:
            print(f"  warn: could not fetch {remote}: {e}", file=sys.stderr)
            return m.group(0)
        local = f"/fonts/{name}"
        seen[remote] = local
        count += 1
        print(f"    {name}  ({(HUD_FONTS / name).stat().st_size // 1024} KB)")
        return f"url({local})"

    out = re.sub(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", swap, css)
    (HUD_FONTS / "fonts.css").write_text(out, encoding="utf-8")

    names = sorted(set(re.findall(r"font-family: '([^']+)'", out)))
    print()
    print(f"  wrote hud/fonts/fonts.css and {count} woff2 file(s)")
    print("  families available to CSS:")
    for n in names:
        print(f"    \"{n}\"")
    return 0


if __name__ == "__main__":
    sys.exit(main())
