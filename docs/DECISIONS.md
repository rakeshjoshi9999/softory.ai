# Decisions log

One line per decision: date · decision · reason · issue/PR.

- 2026-10-22 · Nx + pnpm monorepo for materials, emitters, recipes and products · one graph for affected builds and module boundaries · seed
- 2026-10-22 · TypeSpec as the root spec format, emitting OpenAPI and JSON Schema · one definition feeds frontend, backend and Python · seed
- 2026-10-22 · Generated code lives in `generated/` folders and is never hand-edited · makes regeneration and recalls safe · seed
- 2026-10-22 · TypeScript pinned to ~5.9 (not 7) · Nx 24 / typescript-eslint peers require <6.1 · #1
- 2026-10-22 · New dev deps (all open source, MIT/Apache): nx, @nx/{js,eslint,angular,nest,plugin,vite,eslint-plugin}, typescript, eslint, @eslint/js, typescript-eslint, vitest, @angular-devkit/{core,schematics} · P1-01 workspace · #1
- 2026-10-22 · `sample-emitter`/`sample-product` placeholder projects exist only so the boundary lint test has tagged projects; remove once real ones exist · #1
- 2026-10-22 · Builder run used the session-designated branch `claude/gifted-mendel-s8l5ww` rather than `claude/1-<slug>` · harness restricts pushes to that branch · #1
- 2026-10-22 · No `packageManager` field in package.json; pnpm version is pinned by the CI workflow · the field conflicts with pnpm/action-setup and workflows are off-limits · #1
- 2026-10-22 · New deps (open source): ajv (MIT), yaml (ISC), tsx (MIT), @types/node (MIT) · schema validation and running the TS CLI via `pnpm factory` · #2
- 2026-10-22 · Root package.json gets a `factory` script (only change outside tools/) · `pnpm factory validate` must run from the repo root · #2
- 2026-10-22 · Issue #2 closed: shipped by #50; #51 (this session's duplicate) closed unmerged · two builder sessions picked the same issue · #2
- 2026-10-22 · New dev deps (open source): @typespec/{compiler,http,openapi,openapi3} ~1.17 (MIT), @stoplight/spectral-cli ~6.17 (Apache-2.0) · TypeSpec → OpenAPI and lint for api-contract materials · #3
- 2026-10-22 · Spectral pulls in @scarf/scarf install telemetry; disabled via `scarfSettings.enabled: false` in root package.json · no phoning home from installs · #3
- 2026-10-22 · oasdiff v1.32.1 (Apache-2.0) runs via `go run` from `tools/oasdiff/oasdiff.sh` (small step outside the issue's stated scope) · it has no official npm package; avoids committing binaries or trusting third-party npm repackagings; ubuntu-latest CI has Go · #3
- 2026-10-22 · "Last released spec" is a committed snapshot at `materials/<name>/released/openapi.yaml` until the registry lands (P1-06) · oasdiff needs a base and nothing is published yet · #3
- 2026-10-22 · `generated/openapi.yaml` is committed (in a `chore(generate):` commit); the material's test regenerates it and fails if it is stale · downstream emitters and reviewers read it without running TypeSpec · #3
- 2026-10-22 · Material checks run as Vitest in the `test` target so CI's `nx affected -t lint test build` covers them; `emit-openapi`, `lint-openapi`, `breaking`, `validate` also exist as standalone targets · #3
- 2026-10-22 · New dev deps (open source): @nestjs/{common,core} ^11 (MIT), class-validator, class-transformer (MIT), reflect-metadata (Apache-2.0), rxjs (Apache-2.0) · generated DTOs/controllers target them; compile-checked in the emitter test · #5
- 2026-10-22 · Abstract controller has concrete `<op>Route` methods carrying the Nest route/param decorators that delegate to `abstract <op>` methods · decorators on an overridden method are not inherited, so implementers only override the abstract ones and keep routing intact · #5
- 2026-10-22 · Emitter contract types are duplicated in nest-server (as in ts-angular-client, PR #53) until a shared package is justified · avoids cross-emitter dependency before the contract is settled · #5
- 2026-10-22 · readOnly OpenAPI properties become `@IsOptional()` in DTOs · server-assigned fields (id, status) must not be required on input · #5
- 2026-10-22 · Sample-service compile test runs the TS compiler on a fixture copied next to freshly emitted code (under node_modules/.cache) · keeps the fixture out of the Nx module-boundary graph · #5
