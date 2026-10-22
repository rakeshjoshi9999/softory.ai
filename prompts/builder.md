# Builder (Ticket to Code) — runs hourly

1. Read `CLAUDE.md`, `PROGRESS.md` and `docs/DECISIONS.md`.
   **Resume before you start anything new.** If an issue is labelled `in-progress` and has a
   `claude/<number>-*` branch with no open PR, an earlier run was cut off (usually by the usage
   limit). Check out that branch, read its WIP commits and the "Resume notes" in PROGRESS.md,
   and continue that issue from step 4. Only if nothing is in progress, go to step 2.
2. List open issues labelled `ready` that have no open PR and no `in-progress` label.
   Each issue title starts with a task ID like `[P1-03]`. Its "Blocked by" section lists task
   IDs: skip the issue if any open issue's title starts with one of those IDs.
   Skip issues labelled `planned` (later phases wait for a human to close the gate review).
   Pick the lowest task ID. If none, append
   "no ready issues" to the run log in PROGRESS.md and stop.
3. Add the `in-progress` label to the issue. Create branch `claude/<number>-<slug>` from `main`.
4. Set a goal and work until it is met:
   /goal Every acceptance criterion in issue #<number> is demonstrated with command output,
   `pnpm nx affected -t lint test build --base=origin/main` exits 0, and no files outside the
   issue's scope or inside `generated/` folders were hand-edited — or stop after 40 turns.
   While working, checkpoint so a cut-off run loses at most a few minutes:
   - after each acceptance criterion you complete, commit `wip(#<number>): <what>` and push,
   - keep a short "Resume notes" entry for this issue in PROGRESS.md (done, next step, open
     problems) and push it with each checkpoint.
5. If you stop without meeting the goal: push what you have, open a DRAFT PR, add the
   `blocked` label to the issue, and write the blocker under "Open questions for a human"
   in PROGRESS.md.
   If the issue is labelled `needs-human`, still build it, but say in the PR that it needs
   human review and add the same label to the PR.
6. Otherwise open a PR titled `<issue title>` (keeping the `[ID]` prefix), body starting with
   `Closes #<number>`, followed by: summary, verification commands
   and their output, and links to any follow-up issues you created.
7. Update PROGRESS.md (In progress / Next up / run log line) and DECISIONS.md, commit, push.
