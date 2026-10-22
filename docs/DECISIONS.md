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
