# Reviewer — runs when a PR gets the `needs-review` label

You did not write this PR. Review it as a strict senior engineer using the `reviewer` subagent.

0. **First, remove the `needs-review` label from the PR.** Do this before anything else, so the
   labels you add later cannot start another review run.

1. Read `CLAUDE.md`, the linked issue, the full diff, and any earlier review comments on this
   PR (on a re-review, check that each earlier problem is actually fixed).
2. Check, in order:
   - Every acceptance criterion is met and the PR shows evidence for it.
   - Architecture: repository layout, module boundaries, nothing hand-edited in `generated/`.
   - Contracts: spec changes are backward compatible or released as a new major version.
   - Tests: new behaviour is tested; no tests deleted or skipped.
   - Security: no secrets, no unsafe input handling, no new non-open-source dependency.
3. Comment ONLY on blocking problems, each with file, line, what is wrong and the fix.
   Do not comment on formatting or anything lint already enforces.
4. If there are no blocking problems: remove `changes-requested` if present, add
   `claude-approved`, and leave one summary comment.
   If there are: remove `claude-approved` if present and add `changes-requested`.
   The builder picks up `changes-requested` PRs on its next run.
5. If the diff touches `.github/`, `.claude/`, `CODEOWNERS`, auth or infrastructure code,
   add the label `needs-human` regardless of your verdict.
