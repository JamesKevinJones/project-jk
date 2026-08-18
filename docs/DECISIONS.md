# Decisions

Append-only. Newest at the top. Never edit an old entry — if it stops being
true, add a new one that supersedes it and say so.

The point is to stop a fresh agent from "fixing" something you chose
deliberately. If a choice would look wrong without context, it belongs here.

---

## 2026-08-19 — Correctness is proved by a validator, not by reading the files

**Context.** This project is config, so there is no build and no test suite. The failure mode that matters is a dead end the agent hits mid-task: a wikilink that resolves to nothing, a folder with no index, a Job missing its boot chain. All of it looks fine when you read it and only bites during real work.

**Decision.** `scripts/validate.py` traverses the vault the way the agent does at boot and exits non-zero on any break. It is the proof command for this repo.

**Why not the alternative.** Manual review is what produced the bugs it found: eight wikilinks pointing at `[[VAULT INDEX]]` when Obsidian resolves by filename (`VAULT-INDEX`), and a fresh install with no `Active Priorities.md` despite the startup sequence reading it at step 3. Both were invisible to inspection and obvious to a traversal.

**Consequences.** Run it after any structural change to the vault. When the vault grows a new folder or field value, the constants at the top of the script have to grow with it, or it will report false failures.

---

## 2026-08-19 — Code spans are not links, and the validator has to know that

**Context.** The first validator flagged 17 broken wikilinks. Most were false positives: prose *about* wikilink syntax, written as `` `[[wikilinks]]` `` inside inline code spans. Markdown never parses a link inside code, so Obsidian never tried to resolve them.

**Decision.** Strip fenced blocks *and* inline code spans before scanning for links.

**Why not the alternative.** Rewriting the notes to avoid the syntax was tried first and made things worse: it produced double-backticked `` ``wikilinks`` `` and damaged documentation that was correct to begin with. The tool was wrong, not the notes.

**Consequences.** Documentation can freely show wikilink syntax in code spans without tripping the validator. A genuinely broken link still fails, because it will not be inside code.

---

## 2026-08-18 — The boot config lives in `AGENTS.md`, not `CLAUDE.md`

**Context.** The upstream ai-memory-vault project puts the entire boot config in `CLAUDE.md`, because Claude Code auto-loads that file. But this workspace runs Claude Code, Antigravity, and Codex interchangeably, and the other two do not read `CLAUDE.md`.

**Decision.** All boot content goes in `AGENTS.md`. `CLAUDE.md` is the single line `@AGENTS.md`.

**Why not the alternative.** Following upstream exactly would have worked perfectly in Claude Code and handed an empty room to Codex and `agy`, which is the exact failure the agent-handoff framework exists to prevent. Duplicating the content into both files was the other option, and duplicated config drifts.

**Consequences.** Anyone porting this back to a Claude-Code-only setup can inline `AGENTS.md` into `CLAUDE.md` and lose nothing. Documentation that references the boot config must say `AGENTS.md`, including inside the vault's `VAULT-INDEX.md`.

---

## 2026-08-18 — The memory layer was added alongside the existing Zettelkasten, not migrated into it

**Context.** The target vault already held 87 notes in a Zettelkasten layout (`1 - Rough Notes` through `7 - Career`, plus TaskNotes and Copilot plugin folders). The upstream build prescribes a different scheme: `00 - Inbox`, `01 - Daily Notes`, `02 - Project`, and so on.

**Decision.** Build the system layer as folders `01`, `10` through `18`, and leave every existing folder and note exactly where it was. `1 - Rough Notes` serves as the inbox rather than creating `00 - Inbox`.

**Why not the alternative.** Renumbering into the prescribed scheme is cleaner on paper. But renaming notes outside the Obsidian app breaks every `[[wikilink]]` pointing at them, because only the app's auto-update-internal-links setting repairs them. Migrating 87 notes from the shell would have silently shredded the link graph of a vault in daily use. The two-digit and single-digit folders coexist without collision.

**Consequences.** The vault has two organizing schemes at once, which is documented in `VAULT-INDEX.md` so no future session treats it as a mistake to clean up. Any eventual migration has to happen inside Obsidian, not from a terminal.

---

## 2026-08-18 — The vault is not in this repo, and this repo is public

**Context.** The build produces two things: a system (config, templates, Jobs) and a memory (personal profile, people, priorities, internship notes). Publishing is useful for the portfolio. Publishing the second thing is not.

**Decision.** This repo holds the system only. The vault stays local and private. `.gitignore` blocks vault-shaped paths defensively, and `templates/` carries the same files with personal content stripped back to `[FILL IN: ...]` markers.

**Why not the alternative.** A single private repo containing both would back up the vault too, but then the system is invisible to anyone looking at the work, which was half the reason to build it in public. Two repos was the other option and is still available if a vault backup is wanted later.

**Consequences.** Anything genuinely personal must never be written into this folder. Job notes live in the vault, not here, even though they read like documentation.

---

## 2026-08-18 — Job Autopilot never auto-submits, and J.K. inherits that rule

**Context.** Job Autopilot already had a deliberate no-auto-submit design. Giving an agent hands over that queue makes the rule easier to erode, since submitting is the obvious next step from the agent's point of view.

**Decision.** The prohibition is written into `AGENTS.md` as a hard line and into the Triage Job's quality bar: never submit, never fill the form, never enter personal data on a job board.

**Why not the alternative.** Automating submission looks like the natural completion of the pipeline. It gets accounts restricted, trips ATS dedup filters, and means clicking irreversible controls on Kevin's behalf.

**Consequences.** Any future agent proposing auto-submit as an improvement is contradicting a Locked decision and must surface it rather than act.

---
