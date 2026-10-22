# Software Factory — rules for Claude

You are building the Software Factory: an open-source platform that turns specs (materials) into
signed packages, assembles products from a `product.yaml` + recipe, and ships them through gated
pipelines. Read `docs/architecture.md` for the full design and `PROGRESS.md` for where we are.

## Every run starts and ends the same way
1. Read `PROGRESS.md`, `docs/DECISIONS.md` and the issue you are working on.
2. Work on exactly ONE issue per run, on a branch named `claude/<issue-number>-<slug>`.
3. Before finishing, update `PROGRESS.md` (what changed, what is next, open questions)
   and add a line to `docs/DECISIONS.md` for any design decision you made.

## Usage limits and interrupted runs
- A run can be cut off at any moment when the Claude usage limit is reached. Work so that
  stopping is always safe: commit and push `wip(#n):` checkpoints after each completed
  acceptance criterion, and keep "Resume notes" in PROGRESS.md current.
- Never start a second issue while one is `in-progress` with an unfinished branch: resume it.
- Never rely on anything that only exists in the session (scratch files, local state);
  if it matters for the next run, it goes in the branch or PROGRESS.md.
- Prefer small steps: one run should not need more than one acceptance criterion's worth of
  work between pushes.

## Stack (open source only)
- Monorepo: Nx + pnpm, TypeScript strict everywhere.
- Frontend: Angular (standalone, signals), Native Federation for shell + remotes.
- Backend: NestJS. Specs: TypeSpec → OpenAPI, AsyncAPI for events.
- Codegen: orval (Angular clients), custom Nx generators/executors for emitters and recipes.
- Validation: Spectral (lint), oasdiff (breaking changes).
- Registry: Verdaccio (local, via docker compose). Versioning: Changesets.
- Tests: Vitest (unit), Playwright (e2e), contract tests generated from specs.
- Never add a dependency that is not open source. Note every new dependency in DECISIONS.md.

## Repository layout
- `materials/<name>/` — `material.yaml` + spec source. The ONLY place specs are edited.
- `emitters/<name>/` — Nx plugin implementing the Emitter contract (see architecture doc).
- `recipes/<kind>/` — Nx generators for product skeletons (`angular-remote`, `nestjs-service`).
- `products/<name>/` — `product.yaml` + generated project. Hand-written code ONLY in `src/ext/`.
- `tools/` — factory CLI (`factory assemble`, `factory validate`).
- Any folder named `generated/` is emitter output: never edit it by hand, regenerate instead.

## Module boundaries (enforced by @nx/enforce-module-boundaries)
- Tags: `type:material|emitter|recipe|product|tool`, `scope:<name>`.
- Products may depend on emitted packages, never on emitter or recipe source.

## Definition of done
- Every acceptance criterion in the issue is demonstrably met (show the command + output).
- `pnpm nx affected -t lint test build --base=origin/main` exits 0.
- New behaviour has tests; tests fail without the change and pass with it.
- No edits to `generated/` folders; no skipped or deleted tests.
- PR description: summary, how it was verified, follow-up issues created.

## Never
- Push to `main`, force-push, or merge your own PR.
- Touch `.github/workflows/`, `.claude/`, `CODEOWNERS`, secrets or auth code unless the issue
  explicitly says so (these need human review).
- Start work outside the issue's scope. Create a new issue for anything else you find.
