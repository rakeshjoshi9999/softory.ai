Fix pull request #{{pr}} {{title}} on branch `{{branch}}`, which is already checked out.

After you stop, the workflow pushes your commits, runs the checks, replies on the PR and asks for
a new review. So do NOT: push, comment, change labels, or edit `PROGRESS.md`.

{{conflict}}

## What to fix
{{findings}}

## The task this PR implements
{{body}}

## How to work
- Fix every blocking problem above, and only those. Add or update tests that prove each fix.
- Follow `CLAUDE.md`. Search other docs with Grep instead of reading whole files.
- Commit each fix with `fix(#{{issueRef}}): ...`. Do not push.
- You are done when `pnpm nx affected -t lint test build --base=origin/main` exits 0. The Stop
  hook enforces this.

## Before you stop
Write `.loop/result.md` (it is not committed): one bullet per problem above saying what you
changed (file and how), then a last line, exactly `STATUS: done` or
`STATUS: blocked - <one-line reason>`.
