# Builder (Ticket to Code) — runs hourly

Work on exactly ONE thing per run, in this priority order: fix a reviewed PR, resume an
interrupted issue, start a new issue.

**Conflicts first.** After opening a PR, and at the start of every run, check each open
`claude/` PR for merge conflicts with `main`. Resolve any before doing the steps below: merge
`origin/main` into the PR branch (no rebase or force-push), regenerate lockfiles and
`generated/` output with the repo tooling rather than by hand, run
`pnpm nx affected -t lint test build --base=origin/main`, and push.

1. Read `CLAUDE.md`, `PROGRESS.md` and `docs/DECISIONS.md`.

2. **Fix reviewed PRs first.** If an open PR on a `claude/` branch has the label
   `changes-requested`, take the oldest one:
   - check out its branch, read every reviewer comment since the last commit,
   - fix each blocking problem (same definition of done as below),
   - push, remove `changes-requested`, add `needs-review`, and reply to each comment with
     what you changed,
   - append a run log line to PROGRESS.md and stop.

3. **Resume before you start anything new.** If an issue is labelled `in-progress` and has a
   `claude/<number>-*` branch with no open PR, an earlier run was cut off (usually by the usage
   limit). Check out that branch, read its WIP commits and the "Resume notes" in PROGRESS.md,
   and continue that issue from step 6.

4. **Pick a new issue.** List open issues labelled `ready` that have no open PR and no
   `in-progress` label. Each issue title starts with a task ID like `[P1-03]`. Its "Blocked by"
   section lists task IDs: skip the issue if any open issue's title starts with one of those IDs.
   Skip issues labelled `planned` (later phases wait for a human to close the gate review).
   Pick the lowest task ID. If none, append "no ready issues" to the run log in PROGRESS.md
   and stop.

5. Add the `in-progress` label to the issue. Create branch `claude/<number>-<slug>` from `main`.

6. Set a goal and work until it is met:
   /goal Every acceptance criterion in issue #<number> is demonstrated with command output,
   `pnpm nx affected -t lint test build --base=origin/main` exits 0, and no files outside the
   issue's scope or inside `generated/` folders were hand-edited — or stop after 40 turns.
   While working, checkpoint so a cut-off run loses at most a few minutes:
   - after each acceptance criterion you complete, commit `wip(#<number>): <what>` and push,
   - keep a short "Resume notes" entry for this issue in PROGRESS.md (done, next step, open
     problems) and push it with each checkpoint.

7. If you stop without meeting the goal: push what you have, open a DRAFT PR (no
   `needs-review` label), add the `blocked` label to the issue, and write the blocker under
   "Open questions for a human" in PROGRESS.md.

8. Otherwise open a PR titled `<issue title>` (keeping the `[ID]` prefix), body starting with
   `Closes #<number>`, followed by: summary, verification commands and their output, and links
   to any follow-up issues you created. Then add the label `needs-review` to the PR: that label
   is what starts the reviewer. If the issue is labelled `needs-human`, say so in the PR body and
   add `needs-human` to the PR as well.

9. Update PROGRESS.md (In progress / Next up / remove this issue's Resume notes / run log
   line) and DECISIONS.md, commit, push.
