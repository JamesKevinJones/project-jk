# Verification

Exact commands to prove a change works. Any agent, any tool, no guessing.

Rule: **don't report work as done without running these.** "It should work" is
not a result.

There is no build and no test suite here. This project is config, and the way
you prove config works is to boot the agent and check what it knows.

## 1. The boot layer resolves

```bash
test -f AGENTS.md && test "$(cat CLAUDE.md | tr -d '[:space:]')" = "@AGENTS.md" && echo OK
```

`CLAUDE.md` must be exactly the one-line import. Anything else means content is hiding from Codex and Antigravity.

## 2. The vault path in AGENTS.md is real

```bash
grep -o 'G:\\\\My Drive\\\\[A-Za-z ]*' AGENTS.md
ls "/g/My Drive/Kevin Jones/VAULT-INDEX.md"
```

Both must succeed. A boot config pointing at a vault that is not there fails silently, and the agent just behaves like a normal chatbot.

## 3. The memory layer is intact

```bash
ls "/g/My Drive/Kevin Jones/VAULT-INDEX.md" "/g/My Drive/Kevin Jones/Active Priorities.md"
ls "/g/My Drive/Kevin Jones/01 - Daily Notes/Daily Note Template.md"
ls "/g/My Drive/Kevin Jones/18 - Resources/Jobs/"
```

The Jobs folder must list five notes plus `Jobs.md`.

## 4. Every note has frontmatter

```bash
cd "/g/My Drive/Kevin Jones" && for f in VAULT-INDEX.md "Active Priorities.md" 1?\ -\ */*.md "18 - Resources/Jobs/"*.md; do head -1 "$f" | grep -q '^---$' || echo "MISSING FRONTMATTER: $f"; done; echo "frontmatter check done"
```

Silence between the command and "done" means every note passed.

## 5. The existing Zettelkasten was not disturbed

```bash
find "/g/My Drive/Kevin Jones/1 - Rough Notes" "/g/My Drive/Kevin Jones/2 - Source Material" "/g/My Drive/Kevin Jones/3 - Tags" "/g/My Drive/Kevin Jones/4 - Indexes" "/g/My Drive/Kevin Jones/5 - Templates" "/g/My Drive/Kevin Jones/6 - Main Notes" "/g/My Drive/Kevin Jones/7 - Career" -name '*.md' | wc -l
```

Must still report **71**. A different number means something moved and links may be broken.

(71 is the seven Zettelkasten folders only. The whole vault was 87 markdown files before the build: 71 here, plus 15 in `copilot/` and 1 in `TaskNotes/`. Don't confuse the two numbers.)

Stronger check, since a count can stay the same while content changes:

```bash
cd "/g/My Drive/Kevin Jones" && find "1 - Rough Notes" "2 - Source Material" "3 - Tags" "4 - Indexes" "5 - Templates" "6 - Main Notes" "7 - Career" -name '*.md' -newermt "2026-08-18 00:00" | wc -l
```

Must report `0`. Anything else means the build, or a later session, wrote into the Zettelkasten layer it was supposed to leave alone.

## 6. The HUD serves and reads the vault

```bash
python scripts/hud.py --no-browser --port 7842
```

In another shell:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7842/
curl -s http://127.0.0.1:7842/api/state | python -c "import json,sys; d=json.load(sys.stdin); print(d['agent'], d['stats'], d['validation']['ok'])"
```

Index must return `200` and the state must report real counts, not zeros. If `notes` is 0 the server found the folder but not the notes, which usually means a cloud-sync placeholder problem rather than a code problem.

Only `/`, `/index.html`, `/hud.css`, `/hud.js`, and `/api/state` are served. Anything else must 404, including path traversal:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:7842/../AGENTS.md"
```

## 7. The real test: boot the agent

Open a new terminal in this folder:

```bash
claude
```

Then check three things in the first exchange:

1. It opens with the welcome line, `All systems online, sir. What are we working on today?`
2. Ask `what is open right now?` The answer must match `Active Priorities.md`, not be invented.
3. Ask `what job would you use to log today's NMS session?` It must name `Log a Wipro NMS Session` and be able to state its boot chain.

If it answers 2 or 3 without reading the vault, the startup sequence is not firing. That is the only failure mode that matters here, and it is invisible unless you check.
