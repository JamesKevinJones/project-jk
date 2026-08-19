#!/usr/bin/env python3
"""
J.K. HUD — a local heads-up display for the memory vault.

Serves a single-page dashboard that reads the vault live: what is open, what
the projects are, what Jobs exist and what each one loads, what the daily log
says, and whether the vault still validates.

Standard library only. No build step, no dependencies, no network access. It
binds to 127.0.0.1 so nothing is exposed off the machine, and it serves exactly
three static files by name rather than a directory, because the vault it reads
is private.

Usage:
    python scripts/hud.py                 # start and open a browser
    python scripts/hud.py --port 7878
    python scripts/hud.py --no-browser
    python scripts/hud.py --vault "G:\\My Drive\\Kevin Jones"
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import threading
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HUD_DIR = REPO / "hud"

# Only these are ever served. The vault is private; a directory handler here
# would be a way to read arbitrary files off the machine.
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/hud.css": ("hud.css", "text/css; charset=utf-8"),
    "/hud.js": ("hud.js", "text/javascript; charset=utf-8"),
}

SYSTEM_FOLDER = re.compile(r"^\d{2} - .+")
ZK_FOLDER = re.compile(r"^\d - .+")
FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.S)
TASK = re.compile(r"^\s*-\s*\[( |x|X)\]\s*(.+?)\s*$")
TAG = re.compile(r"^\*\*\[([^\]]+)\]\*\*\s*")
WIKILINK = re.compile(r"\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]")


# --- vault reading ---------------------------------------------------------

def vault_from_agents_md() -> Path | None:
    agents = REPO / "AGENTS.md"
    if not agents.exists():
        return None
    m = re.search(r"## Where your memory lives.*?```\s*\n(.+?)\n\s*```",
                  agents.read_text(encoding="utf-8"), re.S)
    return Path(m.group(1).strip()) if m else None


def agent_name() -> str:
    agents = REPO / "AGENTS.md"
    if agents.exists():
        m = re.search(r"You are \*\*(.+?)\*\*", agents.read_text(encoding="utf-8"))
        if m:
            return m.group(1)
    return "J.K."


def read(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def strip_frontmatter(text: str) -> str:
    return FRONTMATTER.sub("", text, count=1)


def first_prose_line(text: str) -> str:
    """First real sentence of a note, for a one-line summary."""
    for line in strip_frontmatter(text).splitlines():
        s = line.strip()
        if not s or s.startswith(("#", "-", ">", "|", "```", "<!--", "*")):
            continue
        return _plain(s)[:220]
    return ""


def parse_priorities(vault: Path) -> dict:
    text = read(vault / "Active Priorities.md")
    open_, done = [], []
    section = None
    for line in strip_frontmatter(text).splitlines():
        low = line.strip().lower()
        if low.startswith("###"):
            section = "done" if "completed" in low else "open"
            continue
        m = TASK.match(line)
        if not m:
            continue
        checked = m.group(1).lower() == "x"
        body = m.group(2)
        tag = ""
        tm = TAG.match(body)
        if tm:
            tag = tm.group(1)
            body = body[tm.end():]
        item = {"tag": tag, "text": _plain(body)}
        (done if (checked or section == "done") else open_).append(item)
    return {"open": open_, "done": done}


def _plain(s: str) -> str:
    """Markdown to readable text: unwrap wikilinks, drop bold and code ticks."""
    s = re.sub(r"\[\[([^\]|#]+?)(?:\|([^\]]*))?\]\]", r"\2\1", s)
    return re.sub(r"\*\*|\*|`", "", s).strip()


def _count(text: str, section: str, item: str) -> int:
    """Count lines matching `item` inside the first `section` match."""
    block = re.search(section, text, re.S)
    if not block:
        return 0
    return len(re.findall(item, block.group(1), re.M))


def parse_jobs(vault: Path, folders: list[str]) -> list[dict]:
    jobs = []
    for folder in folders:
        d = vault / folder / "Jobs"
        if not d.is_dir():
            continue
        for p in sorted(d.glob("*.md")):
            if p.stem == "Jobs" or p.stem.startswith("_"):
                continue
            text = read(p)
            jm = re.search(r"\*\*The job:\*\*\s*(.+)", text)
            summary = _plain(jm.group(1)) if jm else ""
            chain_block = re.search(r"## Boot chain.*?\n(.*?)(?=\n## )", text, re.S)
            chain, chain_notes = [], []
            if chain_block:
                # Keep the raw wikilink targets as well as the readable prose:
                # the HUD lights exactly these nodes in the graph, which is the
                # claim "it loads four notes, not the vault" made visible.
                chain_notes = [t.strip() for t in
                               WIKILINK.findall(chain_block.group(1))]
                for line in chain_block.group(1).splitlines():
                    s = re.sub(r"^\s*\d+\.\s*", "", line).strip()
                    if not s:
                        continue
                    chain.append(_plain(s))
            steps = _count(text, r"## The procedure.*?\n(.*?)(?=\n## )",
                           r"^\s*\d+\.")
            lessons = _count(text, r"## Lessons.*?\n(.*)", r"^\s*-\s+\S")
            jobs.append({
                "name": p.stem,
                "job": summary,
                "chain": chain,
                "chainNotes": chain_notes,
                "steps": steps,
                "lessons": lessons,
            })
    return jobs


def parse_projects(vault: Path, folders: list[str]) -> list[dict]:
    skip = {"01 - Daily Notes", "17 - Archive"}
    out = []
    for folder in folders:
        if folder in skip:
            continue
        d = vault / folder
        notes = [p for p in d.rglob("*.md")]
        idx = d / f"{folder}.md"
        text = read(idx) if idx.is_file() else ""
        fm = FRONTMATTER.match(text)
        slug = ""
        if fm:
            sm = re.search(r"^project:\s*(.+)$", fm.group(1), re.M)
            if sm:
                slug = sm.group(1).strip()
        out.append({
            "folder": folder,
            "name": re.sub(r"^\d{2} - ", "", folder),
            "slug": slug,
            "notes": len(notes),
            "hasIndex": idx.is_file(),
            "summary": first_prose_line(text),
        })
    return out


def parse_daily(vault: Path, limit: int = 6) -> dict:
    d = vault / "01 - Daily Notes"
    if not d.is_dir():
        return {"recent": [], "streak": 0}
    files = sorted((p for p in d.rglob("*.md")
                    if re.match(r"^\d{4}-\d{2}-\d{2}$", p.stem)),
                   key=lambda p: p.stem, reverse=True)
    recent = []
    for p in files[:limit]:
        text = strip_frontmatter(read(p))
        idx = re.search(r"##\s*Index\s*\n(.*?)(?=\n##\s)", text, re.S)
        bullets = []
        if idx:
            for line in idx.group(1).splitlines():
                s = line.strip()
                if not s.startswith("-"):
                    continue
                s = re.sub(r"^-\s*", "", s)
                # markdown links too: [text](url) -> text
                s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)
                bullets.append(_plain(s))
        sessions = len(re.findall(r"^##\s+Session", text, re.M))
        recent.append({"date": p.stem, "index": bullets,
                       "sessions": max(sessions, 1),
                       "words": len(text.split())})
    return {"recent": recent, "total": len(files)}


def build_graph(vault: Path) -> dict:
    """The vault's link graph: notes as nodes, resolved wikilinks as edges.

    This is the memory itself, so the HUD draws it rather than illustrating it.
    Only resolved links become edges; an unresolved link is a dead end and
    drawing it would claim a connection that does not exist.
    """
    notes = [p for p in vault.rglob("*.md") if ".obsidian" not in p.parts]
    by_name: dict[str, Path] = {}
    for p in notes:
        by_name.setdefault(p.stem, p)

    def group_of(p: Path) -> str:
        rel = p.relative_to(vault).parts
        return rel[0] if len(rel) > 1 else "root"

    edges, degree = [], {n: 0 for n in by_name}
    for p in notes:
        src = p.stem
        seen = set()
        for raw in WIKILINK.findall(read(p)):
            dst = raw.strip()
            if dst == src or dst not in by_name or (src, dst) in seen:
                continue
            seen.add((src, dst))
            edges.append([src, dst])
            degree[src] += 1
            degree[dst] += 1

    jobs = {p.stem for p in notes
            if p.parent.name == "Jobs" and p.stem != "Jobs"
            and not p.stem.startswith("_")}
    core = {"VAULT-INDEX", "Active Priorities"}

    nodes = [{
        "id": name,
        "group": group_of(p),
        "deg": degree[name],
        "kind": ("core" if name in core else
                 "job" if name in jobs else
                 "index" if name == group_of(p) else "note"),
    } for name, p in by_name.items()]

    return {"nodes": nodes, "edges": edges}


def run_validator(vault: Path) -> dict:
    """Reuse validate.py rather than reimplementing its checks here."""
    try:
        r = subprocess.run(
            [sys.executable, str(REPO / "scripts" / "validate.py"),
             str(vault), "--json"],
            capture_output=True, text=True, timeout=60,
        )
        return json.loads(r.stdout)
    except Exception as e:  # the HUD must render even if the validator dies
        return {"ok": False, "checks": 0, "links": 0,
                "failures": [f"validator could not run: {e}"], "warnings": []}


def build_state(vault: Path) -> dict:
    if not vault.is_dir():
        return {"ok": False, "vault": str(vault), "agent": agent_name(),
                "error": f"Vault not found at {vault}"}

    folders, zk = [], []
    for p in sorted(vault.iterdir()):
        if not p.is_dir() or p.name.startswith("."):
            continue
        if SYSTEM_FOLDER.match(p.name):
            folders.append(p.name)
        elif ZK_FOLDER.match(p.name):
            zk.append(p.name)

    all_md = [p for p in vault.rglob("*.md") if ".obsidian" not in p.parts]
    words = 0
    links = 0
    for p in all_md:
        t = read(p)
        words += len(t.split())
        links += len(WIKILINK.findall(t))

    v = run_validator(vault)
    return {
        "ok": True,
        "agent": agent_name(),
        "vault": str(vault),
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "stats": {
            "notes": len(all_md),
            "words": words,
            "links": links,
            "systemFolders": len(folders),
            "zettel": sum(1 for f in zk for _ in (vault / f).rglob("*.md")),
        },
        "priorities": parse_priorities(vault),
        "projects": parse_projects(vault, folders),
        "jobs": parse_jobs(vault, folders),
        "daily": parse_daily(vault),
        "graph": build_graph(vault),
        "validation": {
            "ok": v.get("ok", False),
            "checks": v.get("checks", 0),
            "links": v.get("links", 0),
            "failures": v.get("failures", []),
            "warnings": v.get("warnings", []),
        },
    }


# --- server ----------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    vault: Path = Path(".")

    def log_message(self, fmt, *args):  # quiet; this is a desktop tool
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]

        if path == "/api/state":
            try:
                body = json.dumps(build_state(self.vault)).encode("utf-8")
            except Exception as e:
                body = json.dumps({"ok": False, "error": str(e)}).encode("utf-8")
            self._send(200, body, "application/json; charset=utf-8")
            return

        if path in STATIC:
            name, ctype = STATIC[path]
            f = HUD_DIR / name
            if not f.is_file():
                self._send(404, b"missing hud asset", "text/plain; charset=utf-8")
                return
            self._send(200, f.read_bytes(), ctype)
            return

        self._send(404, b"not found", "text/plain; charset=utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=7842)
    ap.add_argument("--vault", help="vault path (default: read from AGENTS.md)")
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    vault = Path(args.vault) if args.vault else vault_from_agents_md()
    if vault is None:
        print("Could not determine the vault path. Pass --vault.", file=sys.stderr)
        return 1
    if not vault.is_dir():
        print(f"Vault not found: {vault}", file=sys.stderr)
        print("The HUD will still start and show the error on screen.",
              file=sys.stderr)

    Handler.vault = vault
    url = f"http://127.0.0.1:{args.port}/"

    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as e:
        print(f"Could not bind {url} ({e}). Try --port with another number.",
              file=sys.stderr)
        return 1

    print()
    print(f"  {agent_name()} HUD is live")
    print(f"  {url}")
    print(f"  vault: {vault}")
    print()
    print("  Ctrl+C to stop.")
    print()

    if not args.no_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  HUD stopped.\n")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
