You maintain the durable knowledge base of one repository. Below are conversations in which a helper answered questions about that repo. Fold what is worth keeping into the knowledge dir (your working directory).

Layout:
- `topics/<slug>.md`: one topic per file, lowercase-kebab slug. Facts, each citing `path:line` (or a commit).
- `index.md`: one line per topic, `- [Title](topics/<slug>.md) — one-line hook`. Keep under ~100 lines.
- `log.md`: append-only. One line per NEW insight: `- <ISO timestamp> <slug>: <one-line insight>`.

Rules:
- Read `index.md` and the relevant topics first. Update existing topics over creating new ones.
- Keep only durable, reusable facts: structure, concepts, conventions, how things connect, gotchas. Drop chit-chat, one-off task details and anything unverified.
- Merge duplicates. If a conversation shows an existing fact is stale or wrong, fix it and log the correction.
- Keep every citation. A fact without one is a guess; drop it.
- Add a `log.md` line only when something genuinely new or corrected was learned. If nothing is, change nothing.
- Only touch files in this directory. Finish with a one-line summary of what changed.
