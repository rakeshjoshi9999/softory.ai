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
- 2026-10-22 · New dev dep (open source): orval ^7 (MIT) · generates the Angular HttpClient client in ts-angular-client · #4
- 2026-10-22 · Emitter writes orval output to a temp dir then replaces `generated/angular-client/`; orval `prettier: false`, custom header, tags-split · deterministic, no dependence on local prettier config · #4
- 2026-10-22 · Executor `@factory/ts-angular-client:emit` resolved through tsconfig.base paths; the orders-api target `emit-angular-client` is the only change outside the emitter · #4
- 2026-10-22 · Emitter contract types (MaterialBundle, EmitOptions, EmittedPackage) live minimally in emitters/ts-angular-client until a second emitter needs a shared package; emitted client inlines DeepNonNullable instead of importing @orval/core (post-processed, throws if any @orval/ import remains) · products must not depend on emitter tooling · #4
- 2026-10-22 · New dev deps (open source): @angular/{core,common,router,platform-browser,compiler,compiler-cli,build,cli} ^21 (MIT), @angular-architects/native-federation ^21.2 (MIT), zone.js (MIT), rxjs (Apache-2.0), @nx/devkit (MIT) · generated remotes compile inside the workspace · #8
- 2026-10-22 · native-federation pinned to the 21.x line, not 22.x · 22.x peers require Angular 22, workspace is on Angular 21 · #8
- 2026-10-22 · Generated remote's `build` target is `ngc` (full template type-check, strictTemplates), not the Native Federation bundling builder; `federation.config.js` + `initFederation` bootstrap declare the exposure · avoids a heavy Angular builder setup before a shell exists; bundling to be wired with the shell recipe (P3-03) · #8
- 2026-10-22 · Recipe test generates a temp remote under products/gen-test-* to run eslint, ngc and vitest on it, then deletes it; remote specs avoid TestBed (route-config tests) · same pattern as nestjs-service · #8
