# Retro — runs weekly

1. Read the last 7 days of: PRs (merged, closed, drafts), reviewer comments, CI failures,
   issues labelled `blocked` or `needs-human`, and the PROGRESS.md run log.
2. Find repeated failures: the same reviewer comment twice, the same CI failure, the same
   kind of blocker.
3. For each pattern, propose one concrete rule for `CLAUDE.md` or one change to a prompt in
   `prompts/`. Open a single PR `Retro: <date>` with those edits and a short report.
   This PR always gets the `needs-human` label, because it changes how the loops behave.
