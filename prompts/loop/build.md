Implement one task in this repository: issue #{{issue}} {{title}}.

The factory loop has already checked out branch `{{branch}}`. After you stop, the workflow pushes
your commits, runs the checks, opens the PR and sets labels. So do NOT: push, open or edit PRs,
change labels or issues, or edit `PROGRESS.md`.

{{resume}}

## The task
{{body}}

## How to work
- Follow `CLAUDE.md`. Open other docs only when the task needs them, and search them with Grep
  instead of reading whole files (`docs/DECISIONS.md` is long).
- Stay inside the task's scope. If you find other work, note it in the result file (below);
  do not do it.
- Commit as you go: after each acceptance criterion, `git commit` with `feat(#{{issue}}): ...`
  (or `wip(#{{issue}}): ...` for a checkpoint). Emitter output goes in a separate
  `chore(generate): ...` commit. Do not push.
- You are done when every acceptance criterion is met and
  `pnpm nx affected -t lint test build --base=origin/main` exits 0. The Stop hook enforces this.

## Before you stop
Write `.loop/result.md` (it is not committed):
- 3–6 bullet summary of what changed
- each acceptance criterion with the command you ran and the key output line
- follow-ups you noticed, one line each
- a last line, exactly `STATUS: done` or `STATUS: blocked - <one-line reason>`
