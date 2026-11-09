# docent

**A Claude Code plugin that gives every repo its own expert helper, one that learns from each question it answers.**

Working across several repos, an agent in repo A keeps needing to understand repo B: how auth works there, which service owns an ID, what a term means. Grepping blind is slow, and every new session starts from zero.

docent gives each repo you register a read-only **helper** subagent. Ask it a question and it researches the real code and answers with `path:line` citations. When it finishes, the conversation is distilled into a durable **knowledge base** for that repo, so the next question starts further ahead, and agents in other repos can subscribe to what was learned.

```
agent in repo A ── ask ──▶ helper for repo B   (read-only subagent, spawned on demand)
                              │ reads knowledge as a head start, verifies against the real code,
                              │ answers with path:line citations
                              ▼ when it stops
                         distiller folds the conversation into repo B's knowledge   (durable)
                              │
agents subscribed to B ◀──────┘ get the index at session start, new insights on their next prompt
```

## How it works

- **The code is the source of truth.** The helper always works against the actual repo. Knowledge only gives it a head start; where the two disagree, the code wins and the knowledge gets corrected.
- **Conversations are disposable, knowledge is durable.** Helpers start only when asked and keep no state between asks. What survives is what the distiller keeps.
- **One writer.** Helpers can only read (`Read`, `Grep`, `Glob`). A single distiller per repo writes that repo's knowledge, so parallel helpers never conflict.
- **Many repos at once.** An agent can subscribe to any number of repos and ask one helper per repo in parallel. Each helper's conversation improves its own repo's knowledge.
- **No server, no separate UI.** It uses Claude Code's own subagents. You can talk to a helper yourself the same way an agent does, for example `@agent-docent:helper`.

Details and trade-offs are in [SPEC.md](SPEC.md).

## Install

Requires [Claude Code](https://claude.com/claude-code) and Node 24 or newer.

```sh
/plugin install docent --marketplace liamleduy/docent
```

Or in two steps, from a terminal:

```sh
claude plugin marketplace add liamleduy/docent
claude plugin install docent@docent
```

This repo is its own marketplace, so there is nothing else to set up. The `docent` CLI is on PATH inside Claude Code sessions while the plugin is enabled.

## Quick start

In a Claude Code session (or run `/docent:setup`):

```sh
docent add api ~/code/api           # register a repo, so it gets a helper
docent subscribe api                # run inside repo A: A receives api's knowledge
docent list                         # registered repos and how many topics each has learned
docent knowledge api [topic]        # read what api's helper has learned so far
```

Then just ask:

> Ask the api helper how auth tokens are issued and where they're validated.

The helper answers with citations. Follow-up questions go to the same helper, which keeps its context. A moment after it finishes, the exchange is distilled into `~/.docent/knowledge/api/`.

### What gets stored

```
~/.docent/knowledge/api/
  index.md            one line per topic; injected into subscribed sessions
  topics/auth.md      durable facts, each citing path:line
  log.md              append-only list of new insights; drives update notifications
```

Everything lives in `~/.docent`. Set `DOCENT_HOME` to move it, but keep it **outside `~/.claude`**, which Claude Code write-protects. If a distill ever fails, the conversation stays queued and the reason is logged to `$DOCENT_HOME/distill.log`.

| Env | Meaning |
|---|---|
| `DOCENT_HOME` | state directory, default `~/.docent` |
| `DOCENT_DISTILL_MODEL` | model used by the distiller, default is your Claude Code default |

## Cost

Every ask is a Claude run, and every finished ask triggers one more run to distill it. A cheaper model for distilling (`DOCENT_DISTILL_MODEL`) keeps this low.

## Status and limitations

An early version, usable but not battle-tested:

- One repo per helper. A helper that reasons across several repos and links their knowledge is future work.
- Whether distilled knowledge stays accurate over many conversations has not been measured yet.
- Knowledge is not refreshed when a repo changes; the helper verifies against current code and corrects stale facts as it goes.
- Repos are registered by local path only, and knowledge is local to your machine.

## Development

```sh
git clone https://github.com/liamleduy/docent && cd docent && npm install
npm run typecheck
npm test                      # unit tests; no network or LLM calls
claude plugin validate .
claude --plugin-dir "$PWD"    # run your working copy in a session, without installing
```

Zero runtime dependencies. TypeScript runs directly on Node 24, with no build step. See [CLAUDE.md](CLAUDE.md) for the architecture notes.

## License

MIT
