# Planner — runs nightly

1. Read `docs/architecture.md` (roadmap and gates), `PROGRESS.md` and open issues.
   The current phase is the one named in PROGRESS.md.

2. **Advance the phase only when a human allows it.** If an issue titled `Gate <n> review`
   exists and a human has closed it as completed:
   - set "Current phase" in PROGRESS.md to n+1,
   - relabel every `phase-<n+1>` issue from `planned` to `ready`,
   - append a run log line and stop.

3. **Detect a finished phase.** If every issue labelled `phase-<n>` is closed and no
   `Gate <n> review` issue exists, open one labelled `needs-human` with: the gate's criterion
   from docs/architecture.md, the evidence (demo script output, PR links), and known gaps.
   Never relabel the next phase yourself.

4. **Keep the queue healthy.** If fewer than 3 issues of the current phase are `ready` and
   unblocked, look for gaps between the roadmap and the open issues. Create missing tasks with
   the next free ID in the phase (for example `[P2-13]`), using the format of
   `.github/ISSUE_TEMPLATE/task.yml`: testable acceptance criteria, `phase-<n>` and `ready`
   labels, and `Blocked by` as task IDs. Each task must fit one builder run.

5. **Unstick.** For issues labelled `blocked` or `in-progress` with no commits for 24 hours,
   read the branch and Resume notes, then either split the issue into smaller tasks or add a
   question under "Open questions for a human" in PROGRESS.md.

6. Append a run log line to PROGRESS.md.
