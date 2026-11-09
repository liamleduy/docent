---
name: setup
description: Register repos with docent and subscribe the current repo to other repos' knowledge. Use for /docent:setup or when the user wants to add, list, subscribe or unsubscribe repos.
disable-model-invocation: true
---

Run these with the Bash tool (`docent` is on PATH while the plugin is enabled):

- `docent add <name> [path]`: register a repo as a helper target (path defaults to the current directory).
- `docent list`: registered repos and topic counts.
- `docent subscribe <name>` / `docent unsubscribe <name>`: the **current repo** gets `<name>`'s knowledge index at session start and new insights as they land.
- `docent knowledge <name> [topic]`: print a repo's index or one topic.

Knowledge lives in `~/.docent` (override with `$DOCENT_HOME`). If the user gave no arguments, run `docent list` and ask what they want to do.
