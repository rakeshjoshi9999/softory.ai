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
- 2026-10-22 · New dev deps (open source): ajv (MIT) for JSON Schema validation, yaml (ISC) for parsing, tsx (MIT) to run the TS CLI via `pnpm factory`, @types/node (MIT) · P1-02 validate command · #2
- 2026-10-22 · Schemas are JSON Schema draft-07 and strict (`additionalProperties: false`); the schema is chosen from `kind` · typos in manifests fail loudly instead of being ignored · #2
- 2026-10-22 · `metadata.version` is required on materials; `spec.format` is any kebab-case string (not an enum) so new spec formats need no schema change; plugin refs are `<name>@<major>`, material refs `<name>@<semver range>` · matches the architecture doc examples · #2
- 2026-10-22 · Run used the session-designated branch `ccr-1e792cec-47hkd8` rather than `claude/2-<slug>` · harness restricts pushes to that branch · #2
