# Software Factory — rules for Claude

You are building the Software Factory: an open-source platform that turns specs (materials) into
signed packages, assembles products from a `product.yaml` + recipe, and ships them through gated
pipelines. The full design is in `docs/architecture.md`; progress is tracked in GitHub issues and PRs.

## How runs work (factory loop)
The factory loop (`.github/workflows/factory-*.yml`, code in `tools/loop`) picks the task, checks
out the branch, pushes, opens the PR, sets labels and records progress on GitHub. In a loop run:
1. Do only the task in your prompt, on the branch already checked out. Do not push, open or edit
   PRs, change labels or issues, or edit `PROGRESS.md`.
2. Commit as you go: `feat(#n): ...`, `wip(#n): ...` checkpoints after each acceptance criterion,
   `chore(generate): ...` for emitter output. The workflow pushes your commits even if the run is
   cut off, and the next run resumes from them.
3. Read other docs only when the task needs them. Search `docs/DECISIONS.md` and
   `docs/architecture.md` with Grep instead of reading them whole. Add one line to
   `docs/DECISIONS.md` for each design decision you make.
4. Before stopping, write `.loop/result.md` as the prompt describes.

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
- `.loop/result.md`: summary, how each criterion was verified, follow-ups.

## Never
- Push to `main`, force-push, or merge your own PR.
- Touch `.github/workflows/`, `.claude/`, `CODEOWNERS`, secrets or auth code unless the issue
  explicitly says so (these need human review).
- Start work outside the task's scope. List anything else you find under follow-ups in `.loop/result.md`.
