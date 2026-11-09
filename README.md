# docent

Claude Code plugin: **per-repo helper subagents whose knowledge builds up** from every conversation. Made for multi-repo work, where an agent in repo A needs to understand repo B.

```
agent in repo A ── ask ──▶ helper for repo B (read-only subagent, spawned on demand)
                              │ reads knowledge, verifies against code, answers with path:line
                              ▼ on stop
                         distiller folds the conversation into repo B's knowledge (durable)
                              │
agents subscribed to B ◀──────┘ index at session start, new insights on the next prompt
```

Conversations are disposable and live in the asker's session. Knowledge is durable, so the next ask starts smarter. There is no server and no separate chat UI. Humans talk to a helper the same way agents do, through Claude Code's own subagent UI (e.g. `@agent-docent:helper`).

## Install

```sh
claude --plugin-dir /path/to/docent    # needs Node >= 24
```

## Use

In a Claude Code session (`docent` is on PATH while the plugin is enabled; or run `/docent:setup`):

```sh
docent add api ~/code/api            # register a repo as a helper target
docent subscribe api                 # run inside repo A: A gets api's knowledge
docent knowledge api [topic]         # read what api's helper has learned
```

Then ask naturally, e.g. "ask the api helper how auth tokens are issued". Follow-ups go to the same helper, which keeps its context.

Knowledge lives in `~/.docent` (override `DOCENT_HOME`; keep it outside `~/.claude`, which Claude Code write-protects). Distiller failures are logged to `$DOCENT_HOME/distill.log`.

| Env | |
|---|---|
| `DOCENT_HOME` | state dir, default `~/.docent` |
| `DOCENT_DISTILL_MODEL` | model for the distiller, default your Claude Code default |

## Develop

```sh
npm install && npm run typecheck && npm test && claude plugin validate .
```

## License

MIT
