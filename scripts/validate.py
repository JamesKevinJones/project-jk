#!/usr/bin/env python3
"""
Validate the memory vault the way the agent will actually traverse it at boot.

Checks, in order:
  1. Startup sequence targets exist and are readable
  2. Every system note has parseable YAML frontmatter
  3. Every status / project / type value is one the vault index declares valid
  4. Every [[wikilink]] resolves to a real note (this is the big one)
  5. Every system folder has its index note
  6. Every Job has the required sections and is registered in Jobs.md
  7. The pre-existing Zettelkasten layer, if any, is reported (and optionally pinned)

Exit 0 = the agent can boot and follow any link without hitting a dead end.
Exit 1 = something is broken; every failure is printed with its file and line.

Nothing here is hardcoded to one person's vault. System folders are discovered
from the vault, and the valid field values are parsed out of VAULT-INDEX.md, so
the vault index stays the single source of truth rather than being duplicated
here and drifting.

Usage:
    python scripts/validate.py                        # vault path from AGENTS.md
    python scripts/validate.py "G:\\My Drive\\Vault"   # explicit
    python scripts/validate.py --json                 # machine-readable
    python scripts/validate.py --zk-expect 71         # pin the Zettelkasten count
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# A system folder is numbered with a TWO digit prefix ("01 - Daily Notes").
# A single-digit prefix ("1 - Rough Notes") marks the pre-existing Zettelkasten
# layer, which this system deliberately does not own or touch.
SYSTEM_FOLDER = re.compile(r"^\d{2} - .+")
ZK_FOLDER = re.compile(r"^\d - .+")

STARTUP_TARGETS = [
    "VAULT-INDEX.md",
    "Active Priorities.md",
    "01 - Daily Notes/Daily Note Template.md",
]

# Used only if VAULT-INDEX.md does not declare its own. Kept in sync with the
# build spec's five-value type set.
FALLBACK_STATUS = {"active", "completed", "parked", "idea", "archived"}
FALLBACK_TYPE = {"index", "reference", "guide", "plan", "log"}

JOB_SECTIONS = ["**The job:**", "## Boot chain", "## The procedure",
                "## Quality bar", "## Lessons"]

FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.S)
WIKILINK = re.compile(r"\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]")
# Markdown never parses a link inside code, so neither do we. A fenced block or
# an inline `code span` containing [[foo]] is prose ABOUT wikilink syntax, not a
# link Obsidian will try to resolve. Missing this produces a validator that
# screams about "broken links" that render perfectly and cannot be fixed.
FENCE = re.compile(r"```.*?```", re.S)
CODE_SPAN = re.compile(r"`[^`\n]*`")


# --- locating the vault ----------------------------------------------------

def vault_from_agents_md() -> Path | None:
    """Pull the path out of the fenced block under 'Where your memory lives'."""
    agents = REPO / "AGENTS.md"
    if not agents.exists():
        return None
    text = agents.read_text(encoding="utf-8")
    m = re.search(r"## Where your memory lives.*?```\s*\n(.+?)\n\s*```", text, re.S)
    return Path(m.group(1).strip()) if m else None


# --- reading the vault's own declarations ----------------------------------

def declared_values(vault: Path) -> tuple[set[str], set[str], set[str], list[str]]:
    """Parse status / project / type vocabularies out of VAULT-INDEX.md.

    The vault index is the source of truth. Duplicating these lists in the
    validator is how the two drift apart and the tool starts lying.
    """
    notes: list[str] = []
    idx = vault / "VAULT-INDEX.md"
    if not idx.is_file():
        return FALLBACK_STATUS, set(), FALLBACK_TYPE, [
            "VAULT-INDEX.md missing, using fallback field vocabularies"
        ]

    text = idx.read_text(encoding="utf-8", errors="replace")
    block = re.search(r"###?\s*Valid Field Values\s*\n(.*?)(?=\n#{2,3} |\Z)",
                      text, re.S)
    if not block:
        return FALLBACK_STATUS, set(), FALLBACK_TYPE, [
            "VAULT-INDEX.md has no 'Valid Field Values' section, using fallbacks"
        ]

    def pull(field: str) -> set[str]:
        m = re.search(rf"\*\*{field}:\*\*(.+)", block.group(1))
        if not m:
            return set()
        return {v.strip().strip("`") for v in m.group(1).split("|") if v.strip()}

    status = pull("status") or FALLBACK_STATUS
    type_ = pull("type") or FALLBACK_TYPE
    project = pull("project")
    if not project:
        notes.append("no project slugs declared in VAULT-INDEX.md; "
                     "project values will not be checked")
    return status, project, type_, notes


def parse_frontmatter(text: str) -> dict[str, str] | None:
    m = FRONTMATTER.match(text)
    if not m:
        return None
    out: dict[str, str] = {}
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        k, _, v = line.partition(":")
        out[k.strip()] = v.strip().strip("'\"")
    return out


def discover_folders(vault: Path) -> tuple[list[str], list[str]]:
    """Return (system folders, zettelkasten folders), both sorted."""
    system, zk = [], []
    for d in sorted(p for p in vault.iterdir() if p.is_dir()):
        if d.name.startswith("."):
            continue
        if SYSTEM_FOLDER.match(d.name):
            system.append(d.name)
        elif ZK_FOLDER.match(d.name):
            zk.append(d.name)
    return system, zk


def system_notes(vault: Path, folders: list[str]) -> list[Path]:
    notes = [vault / n for n in ("VAULT-INDEX.md", "Active Priorities.md")
             if (vault / n).exists()]
    for folder in folders:
        notes.extend(sorted((vault / folder).rglob("*.md")))
    return notes


# --- the run ---------------------------------------------------------------

class Report:
    def __init__(self, as_json: bool):
        self.as_json = as_json
        self.failures: list[str] = []
        self.warnings: list[str] = []
        self.checks = 0
        self.links = 0

    def say(self, line: str = "") -> None:
        if not self.as_json:
            print(line)

    def check(self, label: str, ok: bool, detail: str = "") -> bool:
        self.checks += 1
        if ok:
            self.say(f"  [pass] {label}")
        else:
            self.say(f"  [FAIL] {label}{(' - ' + detail) if detail else ''}")
            self.failures.append(f"{label}{(': ' + detail) if detail else ''}")
        return ok

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("vault", nargs="?", help="vault path (default: read AGENTS.md)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--zk-expect", type=int, metavar="N",
                    help="fail if the Zettelkasten layer is not exactly N notes")
    args = ap.parse_args()

    r = Report(args.json)
    vault = Path(args.vault) if args.vault else vault_from_agents_md()

    r.say()
    r.say("Project J.K. vault validation")
    r.say("=" * 60)

    if vault is None:
        msg = "could not read the vault path out of AGENTS.md"
        r.say(f"  [FAIL] {msg}")
        r.failures.append(msg)
        return finish(r, None)
    if not vault.is_dir():
        msg = f"vault does not exist: {vault}"
        r.say(f"  [FAIL] {msg}")
        r.failures.append(msg)
        return finish(r, str(vault))

    r.say(f"  vault: {vault}")
    r.say()

    VALID_STATUS, VALID_PROJECT, VALID_TYPE, notes = declared_values(vault)
    for n in notes:
        r.warn(n)

    sys_folders, zk_folders = discover_folders(vault)

    # 1 -------------------------------------------------------------------
    r.say("1. Startup sequence targets")
    for rel in STARTUP_TARGETS:
        p = vault / rel
        r.check(rel, p.is_file() and p.stat().st_size > 0, "missing or empty")
    r.say()

    all_notes = system_notes(vault, sys_folders)
    # Obsidian resolves a wikilink by basename across the WHOLE vault, so the
    # candidate set has to include the Zettelkasten layer even though this
    # system does not own it.
    all_names = {p.stem for p in vault.rglob("*.md") if ".obsidian" not in p.parts}

    # 2 -------------------------------------------------------------------
    r.say(f"2. Frontmatter and field values ({len(all_notes)} system notes)")
    bad = 0
    for p in all_notes:
        rel = p.relative_to(vault).as_posix()
        fm = parse_frontmatter(p.read_text(encoding="utf-8", errors="replace"))
        if fm is None:
            r.failures.append(f"{rel}: no YAML frontmatter")
            bad += 1
            continue
        # "_" prefixed files are templates living in the vault on purpose. They
        # need frontmatter, but their values may be [FILL IN: ...] until copied.
        if p.stem.startswith("_"):
            continue
        for field, valid in (("status", VALID_STATUS),
                             ("type", VALID_TYPE),
                             ("project", VALID_PROJECT)):
            if not valid:
                continue
            val = fm.get(field)
            if val is None:
                r.failures.append(f"{rel}: frontmatter missing '{field}'")
                bad += 1
            elif val not in valid:
                r.failures.append(
                    f"{rel}: {field}='{val}' not in {sorted(valid)}")
                bad += 1
    r.check(f"all {len(all_notes)} notes have valid frontmatter", bad == 0,
            f"{bad} problem(s)")
    r.say()

    # 3 -------------------------------------------------------------------
    r.say("3. Wikilink resolution")
    broken: list[tuple[str, int, str]] = []
    for p in all_notes:
        text = p.read_text(encoding="utf-8", errors="replace")
        stripped = FENCE.sub(lambda m: "\n" * m.group(0).count("\n"), text)
        for i, line in enumerate(stripped.splitlines(), 1):
            if line.lstrip().startswith("<!--"):
                continue
            for target in WIKILINK.findall(CODE_SPAN.sub("", line)):
                target = target.strip()
                r.links += 1
                if target.startswith("FILL IN") or target not in all_names:
                    if not target.startswith("FILL IN"):
                        broken.append((p.relative_to(vault).as_posix(), i, target))
    for f, ln, t in broken:
        r.say(f"    {f}:{ln} -> [[{t}]]")
    r.check(f"all {r.links} wikilinks resolve", not broken, f"{len(broken)} broken")
    r.say()

    # 4 -------------------------------------------------------------------
    r.say(f"4. Folder indexes ({len(sys_folders)} system folders)")
    missing = [f"{f}/{f}.md" for f in sys_folders
               if not (vault / f / f"{f}.md").is_file()]
    for m in missing:
        r.say(f"    missing: {m}")
    r.check("every system folder has its index note", not missing,
            f"{len(missing)} missing")
    r.say()

    # 5 -------------------------------------------------------------------
    r.say("5. Jobs")
    jobs_dirs = [d for d in (vault / f for f in sys_folders)
                 if (d / "Jobs").is_dir()]
    jobs_dir = jobs_dirs[0] / "Jobs" if jobs_dirs else None
    if jobs_dir is None:
        r.warn("no Jobs/ folder found; Jobs are optional but are what make "
               "this an operating system rather than a notes folder")
        r.say("  [warn] no Jobs folder yet")
    else:
        job_files = [p for p in sorted(jobs_dir.glob("*.md"))
                     if p.stem != "Jobs" and not p.stem.startswith("_")]
        if not job_files:
            # A fresh install legitimately has none. Jobs accrue as the person
            # notices they have explained the same task twice, so an empty
            # folder is a starting state, not a broken one.
            r.warn("no Jobs written yet; add one the first time you explain "
                   "the same task twice")
            r.say("  [warn] no Jobs written yet")
        for jp in job_files:
            text = jp.read_text(encoding="utf-8", errors="replace")
            absent = [s for s in JOB_SECTIONS if s not in text]
            r.check(f"{jp.stem}: has all required sections", not absent,
                    f"missing {absent}")
            chain = re.search(r"## Boot chain.*?\n(.*?)(?=\n## )", text, re.S)
            n = len(re.findall(r"^\s*\d+\.", chain.group(1), re.M)) if chain else 0
            if n == 0:
                r.check(f"{jp.stem}: boot chain has steps", False, "none found")
            elif n > 6:
                r.warn(f"{jp.stem}: boot chain has {n} steps; the point is a "
                       "tight chain, not the whole vault")
        index = jobs_dir / "Jobs.md"
        if index.is_file():
            idx_text = index.read_text(encoding="utf-8", errors="replace")
            unreg = [j.stem for j in job_files if f"[[{j.stem}]]" not in idx_text]
            r.check("every Job is registered in Jobs.md", not unreg,
                    f"unregistered: {unreg}")
        else:
            r.check("Jobs.md index exists", False, "missing")
    r.say()

    # 6 -------------------------------------------------------------------
    r.say("6. Pre-existing Zettelkasten layer")
    zk_count = sum(1 for f in zk_folders for _ in (vault / f).rglob("*.md"))
    if not zk_folders:
        r.say("  [ ok ] none present, nothing to preserve")
    elif args.zk_expect is not None:
        r.check(f"Zettelkasten pinned at {args.zk_expect} notes",
                zk_count == args.zk_expect, f"found {zk_count}")
    else:
        r.say(f"  [ ok ] {len(zk_folders)} folders, {zk_count} notes, "
              "left alone by this system")
        r.say("         pin it with --zk-expect N to fail on any change")
    r.say()

    return finish(r, str(vault), zk_count, sys_folders)


def finish(r: Report, vault: str | None, zk: int = 0,
           folders: list[str] | None = None) -> int:
    if r.as_json:
        print(json.dumps({
            "vault": vault,
            "ok": not r.failures,
            "checks": r.checks,
            "links": r.links,
            "zettelkasten_notes": zk,
            "system_folders": folders or [],
            "failures": r.failures,
            "warnings": r.warnings,
        }, indent=2))
        return 1 if r.failures else 0

    print("=" * 60)
    if r.warnings:
        print(f"{len(r.warnings)} warning(s):")
        for w in r.warnings:
            print(f"  [warn] {w}")
        print()
    if r.failures:
        print(f"FAILED - {len(r.failures)} problem(s) across {r.checks} checks")
        print()
        for f in r.failures:
            print(f"  [FAIL] {f}")
        print()
        print("The agent would hit a dead end at boot. Fix these before")
        print("trusting anything it tells you about the vault.")
        return 1
    print(f"PASSED - {r.checks} checks, {r.links} wikilinks resolved")
    print()
    print("The agent can boot and follow any link without hitting a dead end.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
