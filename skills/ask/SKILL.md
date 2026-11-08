---
name: ask
description: Ask a per-repo helper about another repository's code or concepts. Use when a task depends on understanding a repo other than the current one.
---

Helpers are read-only subagents, one per registered repo, that answer from durable knowledge plus the code. Each ask makes the next one smarter.

1. Check the "knowledge-gc repos" line injected at session start. Subscribed repos also have their knowledge index injected: read it before asking, it may already answer you. Run `kgc knowledge <repo> [topic]` to read a topic.
2. If the repo is not registered, tell the user to run `/knowledge-gc:setup`.
3. Spawn the `knowledge-gc:helper` subagent. The prompt starts with three lines copied from the injected repo list: `repo: <name>`, `path: <path>`, `knowledge: <dir>`. Then a precise, self-contained question (what you are trying to do and what you need back).
4. Need more? Continue the **same** helper with SendMessage instead of spawning a new one; it keeps its context.
5. Several repos involved: spawn one helper per repo in parallel.
6. Treat answers as cited leads. Open the cited `path:line` before acting on anything critical.
