# docent — spec

## 1. Purpose
An agent working in repo A often needs to understand repo B: a concept, a convention, how two services connect. Grepping blind is slow and every session starts from zero.

docent gives each registered repo a **helper**: a read-only subagent that researches the real repo and answers with citations. Every helper conversation is distilled into a **durable knowledge base** for that repo, so the next question starts further ahead, and agents in other repos can subscribe to what was learned.

It is a Claude Code plugin. There is no server and no chat UI. Agents use the native Agent tool and SendMessage. Humans use Claude Code's own subagent UI the same way.

## 2. Principles
1. **The repo is the source of truth.** A helper always works against the actual repo path. Knowledge is a head start, never a substitute: where code and knowledge disagree, the code wins and the knowledge gets corrected.
2. **Conversations are disposable, knowledge is durable.** Helpers are lazy and stateless between asks; what persists is what the distiller keeps.
3. **Single writer.** Helpers never write. One distiller per repo writes its knowledge.
4. **Every claim is cited.** A fact without `path:line` is dropped by the distiller.
5. **Fail loud, lose nothing.** A failed or denied distill keeps the queued conversation and logs why.

## 3. Actors
| Actor | What | Lifetime |
|---|---|---|
| **Asker** | Any Claude Code session (main agent, subagent, or human) that needs another repo's knowledge | the session |
| **Helper** | Subagent `docent:helper`, tools `Read, Grep, Glob` only. One instance per repo per ask; the repo is named in its prompt | from spawn until it stops. Follow-ups via SendMessage keep its context |
| **Distiller** | Headless `claude -p` run per repo; the only writer of that repo's knowledge | one run drains the repo's queue, then exits |
| **Hooks** | Glue: inject context, approve helper reads, queue conversations, start the distiller | per event |

The helper is one agent definition, not one process per repo. Repo identity comes from the first prompt lines (`repo:`, `path:`, `knowledge:`), which the asker copies from the context injected at session start.

## 4. Flows

### 4.1 Ask
```
asker ── spawn helper "repo: B / path: … / knowledge: … / <question>"
helper ── read knowledge/B/index.md + relevant topics        (head start)
helper ── Read/Grep/Glob in the actual repo path of B        (verify and extend; code wins)
helper ── answer with path:line citations, or "not found"
asker ── SendMessage to the same helper for follow-ups       (context kept)
```

### 4.2 Learn
```
helper stops ── SubagentStop hook (async)
  parse transcript → user/assistant text only
  repo = "repo:" line of the first user message; skip if unregistered or no answer
  write queue/B/<agent_id>.json        (same agent again: latest wins)
  start detached `docent distill B`
distiller ── take lock for B (if held, the holder drains the queue; exit)
distiller ── claude -p in knowledge/B: merge conversations into topics, fix stale facts,
             keep citations, update index.md, append log.md for genuinely new insights
distiller ── delete a queue file only if the run succeeded with no denials and no newer
             conversation re-queued it; otherwise keep it and write distill.log
```

### 4.3 Subscribe
```
docent subscribe B   (run in repo A)  →  subscriptions[A's git root] += B
SessionStart     →  inject every registered repo (name, path, knowledge dir)
                    + index.md of each repo A subscribes to; set the session's cursor to the end of each log.md
UserPromptSubmit →  inject log.md lines newer than the cursor; advance it; inject nothing if none
```

## 5. Multiple repos
- A repo can subscribe to **any number** of repos (`subscriptions.json` maps repo root → list). Each subscribed repo's index is injected at session start and its new log lines on later prompts.
- The asker can ask **any number of helpers in parallel**, one per repo (Claude Code allows 20 concurrent subagents). Each helper sees only its own repo and its own knowledge.
- Each helper conversation is queued under **its own repo** and distilled into **that repo's** knowledge. Different repos distill in parallel; one repo never has two writers.
- Linking concepts across repos currently happens in the **asker**, which receives each helper's cited answer. A helper that reasons across several repos, and cross-links between knowledge bases, is future work (section 10).

## 6. Storage (`$DOCENT_HOME`, default `~/.docent`)
`DOCENT_HOME` must not be under `~/.claude` (Claude Code write-protects it, so the distiller's edits would be denied) and is deliberately not `${CLAUDE_PLUGIN_DATA}` (deleted on uninstall).
```
repos.json                      { "<name>": "/abs/path" }
subscriptions.json              { "/abs/asker/repo/root": ["<name>", ...] }
knowledge/<name>/
  index.md                      "- [Title](topics/<slug>.md) — hook", one line per topic, < ~100 lines
  topics/<slug>.md              durable facts, each citing path:line
  log.md                        append-only "- <iso> <slug>: <one-line insight>"; drives update notifications
queue/<name>/<agent_id>.json    { repo, ts, conversation: [{role, text}] }
locks/<name>/                   mkdir mutex; stale after 15 min
seen/<session_id>.json          { "<name>": log lines already shown to this session }
distill.log                     distiller failures (it runs detached, so there is no terminal)
```
Repo and topic names are validated (`[A-Za-z0-9._-]`, no separators). All access goes through `src/knowledge.ts`, so changing the backend touches one module.

## 7. Interfaces

### Plugin
```
.claude-plugin/plugin.json
agents/helper.md           the helper
skills/ask/SKILL.md        how agents ask (model-invoked)
skills/setup/SKILL.md      /docent:setup (add, list, subscribe, unsubscribe)
hooks/hooks.json           SessionStart, UserPromptSubmit, PreToolUse, SubagentStop
prompts/distill.md         the distiller's instructions
bin/docent                    CLI, on PATH while the plugin is enabled
```

### CLI
`docent add <name> [path]` · `docent list` · `docent subscribe|unsubscribe <name>` (current repo) · `docent knowledge <name> [topic]` · `docent distill <name>` (internal) · `docent hook <event>` (internal)

### Hooks
| Event | Matcher | Does |
|---|---|---|
| SessionStart | — | see 4.3 |
| UserPromptSubmit | — | see 4.3 |
| PreToolUse | `Read\|Grep\|Glob` | approve helper reads (section 8) |
| SubagentStop (async) | `docent:helper` | see 4.2 |

Every hook does nothing when `DOCENT_DISTILLING=1`, so the distiller's own session never recurses.

## 8. Permissions
- **Helper:** `Read, Grep, Glob` only. No Bash, no Edit, no Write, so it is read-only by construction.
- **Read approval:** a plugin cannot ship permission rules, and the repo being asked about is usually outside the asker's working directories. A `PreToolUse` hook returns `allow` only if `agent_type` is `docent:helper` and the real path (symlinks resolved, also for files that do not exist yet) lies inside a registered repo or `$DOCENT_HOME`. Anything else falls through to normal permissions. Deny rules still win.
- **Distiller:** `--tools Read,Grep,Glob,Edit,Write`, `Edit` allowed only under that repo's knowledge directory, `--permission-mode dontAsk`. No Bash.

## 9. Failure and concurrency
| Situation | Behavior |
|---|---|
| Two helpers for one repo stop together | both queued; one distiller wins the lock and drains both |
| Follow-up re-queues a conversation mid-distill | newer `ts` is kept and distilled in the next pass |
| Distiller `claude` exits non-zero, errors, or has permission denials | queue kept, reason in `distill.log`, lock released |
| Distiller dies holding the lock | lock is stolen after 15 min |
| Helper prompt lacks a `repo:` line, or repo unregistered | nothing queued |
| Repo changes after knowledge was written | helper verifies against code and the distiller corrects stale facts; no separate staleness check |

## 10. Out of scope for v1
- Multi-repo helper: one question across several repos, with cross-links between knowledge bases.
- Per-repo generated agents with routing descriptions (so Claude picks the right repo unprompted).
- Proactive refresh when a repo changes.
- Git-URL repos, team sharing or remote knowledge.
- A pi port (separate repo).
