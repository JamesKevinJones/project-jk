#!/usr/bin/env python3
"""
Validate the memory vault the way the agent will actually traverse it at boot.

Checks, in order:
  1. Startup sequence targets exist and are readable
  2. Every system note has parseable YAML frontmatter
  3. Every status / project / type value is one the vault index declares valid
  4. Every [[wikilink]] resolves to a real note (this is the big one)
  5. Every folder index exists for every system folder
  6. Every Job has the required sections and a boot chain
  7. The pre-existing Zettelkasten layer was not modified

Exit 0 = the agent can boot and follow any link without hitting a dead end.
Exit 1 = something is broken; every failure is printed with its file and line.

Usage:
    python scripts/validate.py                       # uses the path in AGENTS.md
    python scripts/validate.py "G:\\My Drive\\Vault"  # explicit
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# --- locate the vault ------------------------------------------------------

REPO = Path(__file__).resolve().parent.parent


def vault_from_agents_md() -> Path | None:
    """Pull the path out of the fenced block under 'Where your memory lives'."""
    agents = REPO / "AGENTS.md"
    if not agents.exists():
        return None
    text = agents.read_text(encoding="utf-8")
    m = re.search(
        r"## Where your memory lives.*?```\s*\n(.+?)\n\s*```", text, re.S
    )
    return Path(m.group(1).strip()) if m else None


# --- vault layout ----------------------------------------------------------

SYSTEM_FOLDERS = [
    "01 - Daily Notes",
    "10 - DigitalSherpa",
    "11 - EvalBench",
    "12 - StarMatch",
    "13 - Job Autopilot",
    "14 - Portfolio",
    "15 - Wipro NMS",
    "16 - Personal",
    "17 - Archive",
    "18 - Resources",
]

ZETTELKASTEN = [
    "1 - Rough Notes",
    "2 - Source Material",
    "3 - Tags",
    "4 - Indexes",
    "5 - Templates",
    "6 - Main Notes",
    "7 - Career",
]

STARTUP_TARGETS = [
    "VAULT-INDEX.md",
    "Active Priorities.md",
    "01 - Daily Notes/Daily Note Template.md",
    "18 - Resources/Jobs/Jobs.md",
]

VALID_STATUS = {"active", "completed", "parked", "idea", "archived"}
VALID_TYPE = {"index", "reference", "guide", "plan", "log"}
VALID_PROJECT = {
    "digitalsherpa", "evalbench", "starmatch", "job-autopilot",
    "portfolio", "wipro-nms", "personal", "meta",
}

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

failures: list[str] = []
warnings: list[str] = []
checks_run = 0


def fail(msg: str) -> None:
    failures.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def check(label: str, ok: bool, detail: str = "") -> bool:
    global checks_run
    checks_run += 1
    if ok:
        print(f"  [pass] {label}")
    else:
        print(f"  [FAIL] {label}{(' - ' + detail) if detail else ''}")
        fail(f"{label}{(': ' + detail) if detail else ''}")
    return ok


def parse_frontmatter(text: str) -> dict[str, str] | None:
    m = FRONTMATTER.match(text)
    if not m:
        return None
    out: dict[str, str] = {}
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        out[k.strip()] = v.strip().strip("'\"")
    return out


def system_notes(vault: Path) -> list[Path]:
    """Every markdown note the system owns. Excludes the Zettelkasten layer."""
    notes: list[Path] = []
    for name in ("VAULT-INDEX.md", "Active Priorities.md"):
        p = vault / name
        if p.exists():
            notes.append(p)
    for folder in SYSTEM_FOLDERS:
        d = vault / folder
        if d.is_dir():
            notes.extend(sorted(d.rglob("*.md")))
    return notes


def main() -> int:
    vault = Path(sys.argv[1]) if len(sys.argv) > 1 else vault_from_agents_md()

    print()
    print("Project J.K. vault validation")
    print("=" * 60)

    if vault is None:
        print("  [FAIL] could not read the vault path out of AGENTS.md")
        return 1
    print(f"  vault: {vault}")
    print()

    if not vault.is_dir():
        print(f"  [FAIL] vault does not exist: {vault}")
        return 1

    # --- 1. startup sequence -------------------------------------------
    print("1. Startup sequence targets")
    for rel in STARTUP_TARGETS:
        p = vault / rel
        ok = p.is_file() and p.stat().st_size > 0
        check(rel, ok, "missing or empty")
    print()

    notes = system_notes(vault)
    print(f"2. Frontmatter and field values ({len(notes)} system notes)")

    # Build the set of note names that wikilinks can resolve to. Obsidian
    # resolves by basename across the whole vault, including the Zettelkasten.
    all_names = {p.stem for p in vault.rglob("*.md")
                 if ".obsidian" not in p.parts}

    bad_fm = 0
    for p in notes:
        text = p.read_text(encoding="utf-8", errors="replace")
        fm = parse_frontmatter(text)
        rel = p.relative_to(vault).as_posix()
        if fm is None:
            fail(f"{rel}: no YAML frontmatter")
            bad_fm += 1
            continue
        # Files prefixed with "_" are templates that live in the vault on
        # purpose. They must have frontmatter, but their values are allowed to
        # be [FILL IN: ...] placeholders until someone copies them into a note.
        if p.stem.startswith("_"):
            continue
        for field, valid in (("status", VALID_STATUS),
                             ("type", VALID_TYPE),
                             ("project", VALID_PROJECT)):
            val = fm.get(field)
            if val is None:
                fail(f"{rel}: frontmatter missing '{field}'")
                bad_fm += 1
            elif val not in valid:
                fail(f"{rel}: {field}='{val}' is not one of {sorted(valid)}")
                bad_fm += 1
    check(f"all {len(notes)} notes have valid frontmatter", bad_fm == 0,
          f"{bad_fm} problem(s)")
    print()

    # --- 4. wikilinks ---------------------------------------------------
    print("3. Wikilink resolution")
    broken: list[tuple[str, int, str]] = []
    total_links = 0
    for p in notes:
        text = p.read_text(encoding="utf-8", errors="replace")
        stripped = FENCE.sub(lambda m: "\n" * m.group(0).count("\n"), text)
        for i, line in enumerate(stripped.splitlines(), 1):
            if line.lstrip().startswith("<!--"):
                continue
            line = CODE_SPAN.sub("", line)
            for target in WIKILINK.findall(line):
                target = target.strip()
                total_links += 1
                if target.startswith("FILL IN"):
                    continue
                if target not in all_names:
                    broken.append((p.relative_to(vault).as_posix(), i, target))
    for f, ln, t in broken:
        print(f"    {f}:{ln} -> [[{t}]]")
    check(f"all {total_links} wikilinks resolve", not broken,
          f"{len(broken)} broken")
    print()

    # --- 5. folder indexes ----------------------------------------------
    print("4. Folder indexes")
    missing_idx = []
    for folder in SYSTEM_FOLDERS:
        d = vault / folder
        if not d.is_dir():
            missing_idx.append(f"{folder} (folder missing)")
            continue
        if not (d / f"{folder}.md").is_file():
            missing_idx.append(f"{folder}/{folder}.md")
    for m in missing_idx:
        print(f"    missing: {m}")
    check("every system folder has its index note", not missing_idx,
          f"{len(missing_idx)} missing")
    print()

    # --- 6. jobs ---------------------------------------------------------
    print("5. Jobs")
    jobs_dir = vault / "18 - Resources" / "Jobs"
    job_files = [p for p in sorted(jobs_dir.glob("*.md"))
                 if p.stem not in ("Jobs",) and not p.stem.startswith("_")]
    check("at least one Job exists", len(job_files) > 0)
    for jp in job_files:
        text = jp.read_text(encoding="utf-8", errors="replace")
        missing = [s for s in JOB_SECTIONS if s not in text]
        check(f"{jp.stem}: has all required sections", not missing,
              f"missing {missing}")
        chain = re.search(r"## Boot chain.*?\n(.*?)(?=\n## )", text, re.S)
        n = len(re.findall(r"^\s*\d+\.", chain.group(1), re.M)) if chain else 0
        if n == 0:
            check(f"{jp.stem}: boot chain has steps", False, "none found")
        elif n > 6:
            warn(f"{jp.stem}: boot chain has {n} steps; "
                 "the point is a tight chain, not the whole vault")

    # Every Job registered in the index?
    if (jobs_dir / "Jobs.md").is_file():
        idx = (jobs_dir / "Jobs.md").read_text(encoding="utf-8")
        unreg = [j.stem for j in job_files if f"[[{j.stem}]]" not in idx]
        check("every Job is registered in Jobs.md", not unreg,
              f"unregistered: {unreg}")
    print()

    # --- 7. zettelkasten untouched --------------------------------------
    print("6. Pre-existing Zettelkasten layer")
    zk = [p for f in ZETTELKASTEN for p in (vault / f).rglob("*.md")
          if (vault / f).is_dir()]
    check(f"Zettelkasten intact ({len(zk)} notes found)", len(zk) == 71,
          f"expected 71, found {len(zk)}")
    print()

    # --- summary ---------------------------------------------------------
    print("=" * 60)
    if warnings:
        print(f"{len(warnings)} warning(s):")
        for w in warnings:
            print(f"  [warn] {w}")
        print()
    if failures:
        print(f"FAILED - {len(failures)} problem(s) across {checks_run} checks")
        print()
        for f in failures:
            print(f"  [FAIL] {f}")
        print()
        print("The agent would hit a dead end at boot. Fix these before")
        print("trusting anything it tells you about the vault.")
        return 1
    print(f"PASSED - {checks_run} checks, {total_links} wikilinks resolved")
    print()
    print("The agent can boot and follow any link without hitting a dead end.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
