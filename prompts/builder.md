# Builder (Ticket to Code) — runs hourly

Work on exactly ONE thing per run, in this priority order: fix a reviewed PR, resume an
interrupted issue, start a new issue.

**Keep every open PR mergeable (runs before everything else, and again as the last thing
before you stop).** The owner only approves and merges; a PR must never reach them behind
`main` or conflicted. For each open `claude/` PR, oldest first:
- fetch `origin/main` and the PR branch; if the PR is conflicted or behind `main`, check out its
  branch and merge `origin/main` into it (never rebase, amend or force-push),
- resolve conflicts like this: `package.json` / `PROGRESS.md` run log / `docs/DECISIONS.md` ->
  keep both sides' lines (log lines in date order); `PROGRESS.md` status sections -> reflect what
  is actually merged, open and next; `pnpm-lock.yaml` -> take `main`'s then run
  `pnpm install --no-frozen-lockfile`; `generated/` -> regenerate with the repo tooling, never by
  hand; any other file where both sides changed the same logic -> do not guess: leave the PR
  alone, add the `blocked` label and write the question under "Open questions for a human",
- run `pnpm install --frozen-lockfile` and `pnpm nx affected -t lint test build --base=origin/main`;
  push only if it exits 0,
- do not merge PRs and do not remove `needs-review` / `claude-approved` labels because of a sync.
After opening your own PR this run, repeat the check once so it is current with `main`.
If the sync took the whole run, stop there and log it in PROGRESS.md.

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

5. **Claim the issue, then branch.** Two runs once built the same issue (PRs #50 and #51), so the
   claim must be visible and checked before any work:
   - add the `in-progress` label and post the comment `claimed by run <UTC timestamp>` (ISO 8601,
     e.g. `claimed by run 2026-10-25T04:30:12Z`),
   - re-read the issue's comments. If another `claimed by run` comment is older than yours (and
     not stale, see below), back off: remove nothing, post nothing more, pick the next issue in
     step 4 (or stop if none). Ties on the timestamp go to the lower comment id,
   - a claim is **stale** when the issue has no commit on its `claude/<number>-*` branch (or no
     comment) newer than 3 hours since the claim. A stale claim is ignored for the back-off check
     and may be taken over: post your own claim comment saying `taking over stale claim <timestamp>`
     and continue from any WIP commits on the existing branch,
   - only then create branch `claude/<number>-<slug>` from `main` (or reuse the existing one when
     taking over).

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
