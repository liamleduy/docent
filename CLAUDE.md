# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code **plugin** (not a server, not an MCP tool): per-repo read-only helper subagents whose knowledge is distilled from their conversations. `SPEC.md` is the authoritative design; read it before changing behavior.

## Commands

Needs Node >= 24 (TypeScript runs directly via type stripping; there is no build step, and only erasable syntax is allowed: no enums, no parameter properties).

```sh
npm install
npm run typecheck                                   # tsc --noEmit
npm test                                            # node --test "src/**/*.test.ts"
node --test --test-name-pattern="lock" src/knowledge.test.ts   # single test
claude plugin validate .                            # plugin manifest/layout check
claude --plugin-dir "$PWD"                          # try the plugin in a session
```

Zero runtime dependencies. `bin/kgc` is the CLI entry and is on PATH while the plugin is enabled.

## Architecture

The pieces only make sense together:

- **Helper** (`agents/helper.md`): subagent with `Read, Grep, Glob` only. One agent definition; the repo it serves comes from the first prompt lines (`repo:`, `path:`, `knowledge:`), which the asker copies from the SessionStart context. It reads knowledge as a head start but must verify against the actual repo; code wins.
- **Hooks** (`hooks/hooks.json` → `bin/kgc hook <event>` → `src/hooks.ts`, one handler per event):
  - `SessionStart` / `UserPromptSubmit`: inject repo list, subscribed repos' indexes, and new `log.md` lines (per-session cursor in `seen/`).
  - `PreToolUse`: auto-approves helper reads. A plugin cannot ship permission rules, so this hook is what lets the helper read repos outside the asker's working dirs. Allows only `agent_type == knowledge-gc:helper` and only paths (symlinks resolved, including not-yet-existing files) inside a registered repo or `$KGC_HOME`.
  - `SubagentStop` (async): parses the helper transcript (`src/transcript.ts`), takes the repo from the `repo:` line of the first user message, writes `queue/<repo>/<agent_id>.json`, starts a detached `kgc distill`.
- **Distiller** (`src/distill.ts`, prompt in `prompts/distill.md`): per-repo lock, loops `claude -p` over the queue, the only writer of `knowledge/<repo>/`. Exit code 0 is not success: it parses the JSON result and keeps the queue on `is_error` or any `permission_denials`, logging to `$KGC_HOME/distill.log` (it runs detached, so there is no terminal). A queue file is deleted only if its `ts` is unchanged, so a follow-up that re-queued mid-run survives.
- **Storage** (`src/knowledge.ts`): all state under `$KGC_HOME` (default `~/.knowledge-gc`). Every file access goes through this module; layout is in SPEC.md section 6.

## Gotchas

- `KGC_DISTILLING=1` is set for the distiller's own `claude -p`; every hook must no-op then (done once in `src/cli.ts`) or it recurses.
- `KGC_HOME` must not be under `~/.claude`: Claude Code write-protects it and the distiller's edits are silently denied (exit 0). Use a `mktemp -d` dir for manual end-to-end tests.
- `KGC_CLAUDE_BIN` swaps the `claude` binary the distiller runs; tests use a fake shell script.
- Plugin-agent frontmatter silently drops `permissionMode`, `hooks`, `mcpServers`; the plugin's `settings.json` drops `permissions`. Don't try to configure permissions there.
- On macOS `/var` is a symlink to `/private/var`: compare real paths, not raw ones (`real()` in `src/hooks.ts`).
- Repo/topic/session names are validated by `checkName` before being used in paths; keep new path inputs going through it.
- End-to-end check of the real flow: register a repo with `kgc add`, run `claude -p ... --plugin-dir "$PWD" --model haiku` from another directory with `--allowedTools Agent SendMessage`, spawn `knowledge-gc:helper` with the three prompt lines, then watch `$KGC_HOME/queue` drain into `knowledge/`.
