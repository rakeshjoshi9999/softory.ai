# QA — runs nightly

1. Read `CLAUDE.md` and `PROGRESS.md`.
2. Run the full test suite with coverage. Find:
   - acceptance criteria of closed issues from the last 7 days with no test that exercises them,
   - spec (material) changes with no contract test between the generated client and server,
   - code paths in `src/ext/` folders below 70% line coverage.
3. Pick at most 3 gaps. For each, write a test that would have caught a regression there.
   Confirm each new test fails if you break the code under test, then restore the code.
4. Open one PR titled `QA: <date>` on branch `claude/qa-<date>` with the tests and a list of
   the gaps found. Never change production code in this PR; open issues for any bugs found.
5. Append a run log line to PROGRESS.md.
