# Project State

> Updated at the end of every session, by whichever agent was driving.
> Keep it under a page. This is a baton, not a diary.

**Last updated:** 2026-08-19 by claude-code

## Where things stand

Project J.K. is live and usable right now. Running `claude` from this folder boots an agent named J.K. that reads `AGENTS.md`, follows the startup sequence into the vault at `G:\My Drive\Kevin Jones`, reads `VAULT-INDEX.md` and `Active Priorities.md`, and comes up already knowing the projects, the rules, and what is open. The memory layer in the vault is fully built: root index, priorities queue, daily-note template and folder index, seven folder indexes (`10 - DigitalSherpa` through `17 - Archive`), a Resources folder, and five Job notes under `18 - Resources/Jobs/`.

The pre-existing Zettelkasten layer in that vault was left completely untouched: 71 notes across `1 - Rough Notes` through `7 - Career`, none of them modified during the build (verified by mtime, not by assumption). The vault holds 87 markdown files in total counting `copilot/` (15) and `TaskNotes/` (1). Nothing was renamed or moved, so no `[[wikilinks]]` broke.

A validator (`scripts/validate.py`) now walks the vault the way the agent does at boot and currently reports `PASSED - 15 checks, 63 wikilinks resolved`. A clean-room test (fresh clone from GitHub into an empty vault) confirms `setup.ps1` works for someone who is not Kevin.

## In progress

- [ ] Nothing half-done in this repo. The build completed and validates clean.

## The exact next step

**Boot the agent and confirm the startup sequence fires. This is the one thing not yet verified.**

Double-click `Chat with J.K..bat` on the Desktop, or open a terminal here and run `claude`. Then check three things:

1. The first reply is the welcome line: "All systems online, sir. What are we working on today?"
2. Ask `what is open right now?` The answer must match `Active Priorities.md` in the vault, not be invented.
3. Ask `what job would you use to log today's NMS session?` It must name `Log a Wipro NMS Session` and be able to state that Job's boot chain.

If 2 or 3 come back plausible but wrong, the startup sequence is not firing and the agent is behaving like a normal chatbot. That is the only failure mode that matters here and it is invisible unless you check.

A headless verification (`claude -p ...`) was attempted during the build and failed with `Failed to authenticate: OAuth session expired and could not be refreshed`. That is an auth limitation of the non-interactive build session, not a defect in the config. Everything else in `docs/VERIFY.md` passed.

## Open questions

Things needing a human decision. Flag them here rather than letting an agent guess.

- The five Jobs were written from inferred workflow, not from an interview. They are correct in shape but the procedures are best guesses at how Kevin actually does these tasks. Each one needs a real run, with corrections folded into its Lessons section.
- `VAULT-INDEX.md` has no Key People, Background, How I Think, Health, Interests, Beliefs, Daily Routine, or What I Want sections, because those were never answered. The Living Profile rules let J.K. create them as it learns. Kevin can also fill them in directly, which is faster.
- Whether the single-digit Zettelkasten folders eventually fold into the numbered system layer, stay parallel, or get archived. Tracked in `Active Priorities.md`.

## Known traps

Things that will waste an hour if you don't know them.

- **The vault is on Google Drive** (`G:\My Drive\Kevin Jones`). Files can be placeholder-only until Drive hydrates them. If a read returns empty for a file that should exist, check Drive sync before assuming the file is broken.
- **`CLAUDE.md` here is one line and must stay one line.** `@AGENTS.md`. Content added to it becomes invisible to Antigravity and Codex.
- **Heredocs through the Bash tool on this machine mangle long multi-line content.** Write files with the Write tool instead. This cost time during the initial build.
- **`.gitignore` deliberately excludes vault-shaped paths** (`VAULT-INDEX.md`, `Active Priorities.md`, `01 - Daily Notes/`). That is to stop a copy of the private vault ever landing in this public repo. If a legitimate file gets ignored, do not loosen those rules without thinking about what else they let through.
- The upstream project is CC BY-SA 4.0. Attribution to Jared Rhodenizer stays in the README and LICENSE, and derivative work stays under the same license.
