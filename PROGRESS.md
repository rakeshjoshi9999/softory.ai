# Progress

Current phase: **Phase 1 — Foundations** (goal: Gate 1, one product rebuilt entirely from its spec)

## Done
- P1-01 scaffold: pnpm + Nx 24 workspace, five folders with READMEs, module-boundary lint rule + test (merged, PR #49)
- P1-02 schemas + `pnpm factory validate` (merged, PR #50; issue closed)
- P1-03 orders-api material: `orders.tsp` → `generated/openapi.yaml`, Spectral, oasdiff gate (merged, PR #52)
- P1-04 ts-angular-client emitter + `orders-api:emit-angular-client` (PR open, needs review)
- P1-08 angular-remote recipe (merged, PR #56)

## In progress
- (none)

## Next up
- #5 P1-05 nest-server emitter (same pattern as `emitters/ts-angular-client`).

## Resume notes
<!-- The builder keeps one entry per in-progress issue: done so far, next step, open problems.
     A run cut off by the usage limit resumes from here after the reset. Remove the entry when the PR opens. -->

## Open questions for a human
- Two builder sessions both did #2 (PRs #50 and #51). Run one builder at a time, or have it claim an issue (label/assignee) before starting.
- oasdiff needs Go on the CI runner (present on ubuntu-latest). OK, or prefer a pinned Docker image?

## Run log
<!-- Each run appends one line: date · issue · result · PR link -->
- 2026-10-22 · #1 P1-01 · implemented on branch claude/gifted-mendel-s8l5ww (session-designated branch instead of claude/1-*) · PR opened
- 2026-10-22 · #1 · builder fixed PR #49 review: removed `packageManager` from package.json (CI pnpm conflict) · https://github.com/rakeshjoshi9999/softory.ai/pull/49
- 2026-10-22 · #2 P1-02 · implemented on claude/gifted-mendel-a7vzpd · PR opened
- 2026-10-22 · #3 P1-03 · orders-api material + spectral + oasdiff gate, 7 tests, `nx run-many -t lint test build` green · branch ccr-1e792cec-47hkd8
- 2026-10-22 · #4 P1-04 · ts-angular-client emitter, 3 tests, `nx affected -t lint test build` green (14 tasks) · branch claude/gifted-mendel-7ez63z
- 2026-10-22 · #4 P1-04 · builder fixed PR #53 review (two-arg Emitter contract, no @orval import in output); pushed to session branch claude/gifted-mendel-tc2z2n, not PR head claude/gifted-mendel-7ez63z · https://github.com/rakeshjoshi9999/softory.ai/pull/53
- 2026-10-22 · #8 P1-08 · angular-remote recipe: generator + file-tree snapshot; generated remote passes eslint, ngc, vitest; `nx affected -t lint test build` green (14 tasks) · branch claude/gifted-mendel-x7cms9
