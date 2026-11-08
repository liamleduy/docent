---
name: setup
description: Register repos with knowledge-gc and subscribe the current repo to other repos' knowledge. Use for /knowledge-gc:setup or when the user wants to add, list, subscribe or unsubscribe repos.
disable-model-invocation: true
---

Run these with the Bash tool (`kgc` is on PATH while the plugin is enabled):

- `kgc add <name> [path]`: register a repo as a helper target (path defaults to the current directory).
- `kgc list`: registered repos and topic counts.
- `kgc subscribe <name>` / `kgc unsubscribe <name>`: the **current repo** gets `<name>`'s knowledge index at session start and new insights as they land.
- `kgc knowledge <name> [topic]`: print a repo's index or one topic.

Knowledge lives in `~/.knowledge-gc` (override with `$KGC_HOME`). If the user gave no arguments, run `kgc list` and ask what they want to do.
