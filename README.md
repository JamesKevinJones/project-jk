# Project J.K.

**A personal AI chief of staff with a real, persistent memory. No vector database, no ceiling, just markdown.**

J.K. is an agent that boots up already knowing my work. It does not start every session as a stranger asking what I am building. Its memory lives outside the model as plain markdown in an Obsidian vault, so there is no context-window ceiling on how much it can hold, and structure (indexes, wikilinks, and one master note per recurring job) means it loads exactly the slice a task needs instead of drowning in the rest.

This repo is the **boot layer**: the config that gives the agent its identity, points it at its memory, and holds the rules that cannot lapse. The memory itself is a private Obsidian vault and is deliberately not in this repo.

Built on [ai-memory-vault](https://github.com/jaredrhod/ai-memory-vault) by [Jared Rhodenizer](https://github.com/jaredrhod). See [Credit](#credit).

## The idea in three parts

A chatbot's memory lives inside its own head and hits a ceiling. This one does not.

1. **The vault is the memory.** External, structured, effectively unlimited. The agent does not have to remember everything. It only has to know a thing exists and be able to reach it in one step.
2. **Memory on demand.** The agent never loads the whole vault. For any task it loads only the slice that task needs, and trusts everything else is one search away.
3. **Structure aims the memory.** A root index that orients every session, folder indexes that map each area, wikilinks that connect notes into a graph, and **Jobs**: one master note per recurring task that hands the agent the complete skill for that task plus links to exactly the notes it needs, and nothing else. Read one note, have the whole job.

## Architecture

```
Working folder (this repo, public)          Vault (private, Obsidian)
-------------------------------------       ----------------------------------
AGENTS.md      identity, vault path,        VAULT-INDEX.md   profile + vault map
               rules that cannot lapse      Active Priorities.md
CLAUDE.md      one line: @AGENTS.md         01 - Daily Notes/  self-writing log
docs/          STATE, DECISIONS, VERIFY     10..15 - projects/ one per project
templates/     starter files                16 - Personal, 17 - Archive
scripts/       setup and launcher           18 - Resources/Jobs/  the skills
```

Two files boot the agent, and the split matters. `AGENTS.md` is short and survives context compaction, so identity and the non-negotiable rules live there. `VAULT-INDEX.md` is the fuller operating manual and can get compressed away in a long session, so it holds the profile and the map instead.

### Why `AGENTS.md` and not `CLAUDE.md`

I work across Claude Code, Antigravity, and Codex interchangeably. Only Claude Code reads `CLAUDE.md`, so putting real content there hides it from the other two. All durable context goes in `AGENTS.md`, and `CLAUDE.md` is the single line `@AGENTS.md`. This is a change from the upstream project, which puts the boot config in `CLAUDE.md` directly.

## Jobs, the part that makes it an operating system

A Job note is one file that gives a fresh agent the entire skill for a recurring task: a boot chain (read these notes, in this order, and you have it), the procedure, the quality bar, and a Lessons section that absorbs every correction so the job gets sharper each run.

The Jobs currently wired up:

| Job | What it does |
|---|---|
| Ship a Change to a Kevin Codes Project | Checkpoint discipline so a handoff never goes cold across three different AI tools |
| Log a Wipro NMS Session | Turns a training session into its `days/` note the same day |
| Triage the Job Autopilot Queue | Reviews the nightly scored role queue and hands back a short list with real opinions |
| Start a New Project | Scaffolds a repo with agent context wired up, and registers it in the vault |
| Write the DigitalSherpa Review Packet | Assembles review evidence from daily notes, every claim traceable |

The boot chain is the whole trick. The agent reads one note and walks straight to the three or four notes that job actually needs. It never loads the rest of the vault.

## Setup

Requirements: [Obsidian](https://obsidian.md), [Claude Code](https://claude.com/claude-code), and a vault you already use or a new empty one.

```bash
git clone https://github.com/JamesKevinJones/project-jk
cd project-jk
pwsh scripts/setup.ps1
```

The script asks for your vault path and agent name, writes them into `AGENTS.md`, copies the starter notes into the vault, and offers to drop a desktop launcher so you never have to remember a command. Then start a session from this folder:

```bash
claude
```

The agent reads `AGENTS.md` automatically, follows the startup sequence into the vault, and comes up already oriented.

To build the memory layer from scratch instead, run the upstream builder. It interviews you and creates the whole structure:

```
I'd like to set this up, please: https://github.com/jaredrhod/ai-memory-vault.git
```

## What is not in this repo

The vault. It holds a personal profile, notes on people, priorities, and internship material, and none of that belongs in a public repository. This repo is the system, not the contents. `templates/` has the same files with the personal parts stripped back to `[FILL IN: ...]` markers so anyone can run it.

## Credit

Built on **[ai-memory-vault](https://github.com/jaredrhod/ai-memory-vault)** by **Jared Rhodenizer** ([@jaredrhod](https://github.com/jaredrhod)), which is where the architecture, the rule set, and the Jobs pattern come from. His walkthrough videos are at [youtube.com/@jaredrhod](https://youtube.com/@jaredrhod).

What is mine here: the cross-tool `AGENTS.md` split, the Jobs written for my actual workflow, and the two-layer vault approach that adds a memory system to an existing Zettelkasten vault without renaming or moving a single existing note.

## License

Copyright (c) 2026 Kevin Jones. Portions copyright (c) 2026 Jared Rhodenizer.

Licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), the same license as the upstream project. Use it commercially, adapt it, build on it. Two rules: credit the authors, and license your adaptation the same way so the next person gets what you got.
