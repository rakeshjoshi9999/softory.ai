# Progress

Current phase: **Phase 1 — Foundations** (goal: Gate 1, one product rebuilt entirely from its spec)

## Done
- P1-01 scaffold: pnpm + Nx 24 workspace, five folders with READMEs, module-boundary lint rule + test (merged, PR #49)
- P1-02 schemas + `pnpm factory validate` (merged, PR #50; issue closed)
- P1-03 orders-api material: `orders.tsp` → `generated/openapi.yaml`, Spectral, oasdiff gate (merged, PR #52)
- P1-04 ts-angular-client emitter + `orders-api:emit-angular-client` (PR open, needs review)
- P1-08 angular-remote recipe (merged, PR #56)
- P1-06 Verdaccio + Changesets + `factory release` (merged, PR #59)
- P2-01 Dagger pipeline module (merged, PR #62)
- P2-02 SBOM + signing (merged, PR #63)
- P1-09 assembly CLI `factory assemble` + products orders-ui, orders-service (merged, PR #60)

- P2-03 provenance statements (merged, PR #64)

## In progress
- #15 P2-05 two more products + `factory graph sync`: merged (PR #68)
- #13 P2-03 provenance statements: merged (PR #64)
- #14 P2-04 material graph service: PR #65 open, awaiting review
- #19 P2-09 container images + Helm library chart: merged (PR #66)
- #20 P2-10 GitOps on kind: draft PR #67 (needs-human), blocked on cluster run and CI job

## Next up
- Gate 1 review: a human closes the gate after P1-10 merges; then Phase 2 issues (`planned`) become `ready`.

## Gate 1 evidence (P1-10)
- Contract test `materials/orders-api/test/contract.spec.ts` (runs in `nx test orders-api`, so in CI): generated Angular client over real HTTP against a Nest app on the generated controller base; every body is checked against `generated/openapi.yaml`.
- `scripts/gate1-demo.sh` (46 s, local Verdaccio): additive `note` field -> emit -> oasdiff passes -> release 1.0.1 -> 1.1.0 -> both products re-assembled with 1.1.0 and the field present -> contract test green. Breaking change (remove `currency`) -> oasdiff reports 3 errors, nothing released, registry unchanged.
- The planner should open the `Gate 1 review` issue once this PR is merged.

## Resume notes
<!-- The builder keeps one entry per in-progress issue: done so far, next step, open problems.
     A run cut off by the usage limit resumes from here after the reset. Remove the entry when the PR opens. -->

## Open questions for a human
- #15 P2-05: the contract tests compare lockfile pins with orders-service (products cannot import emitter output or the registry in CI), not live HTTP. Also graph-service's built output cannot find `migrations/` (`../../migrations` from `dist/products/graph-service/ext`), so it only runs from a symlinked layout: follow-up issue wanted? `factory release` also crashed on a fresh checkout creating `dist/attestations/@factory/<pkg>/<ver>` (npm pack ENOENT, after publishing).
- #14 P2-04: no Docker here, so tests start a throwaway local PostgreSQL via initdb (or use `TEST_DATABASE_URL`, e.g. the new `postgres` compose service). CI (workflow off-limits) needs a postgres service + `TEST_DATABASE_URL`, or the runner's preinstalled PostgreSQL works as-is. Also the graph API is hand-written in `src/ext/`, not yet a TypeSpec material: follow-up issue wanted?
- #20 P2-10: (1) CI job for the kind end-to-end run is not added (`.github/workflows/` off-limits): run `scripts/platform-up.sh && scripts/platform-test.sh` on a runner with docker, kind, kubectl and cosign. (2) No Docker daemon here, so the scripts were only syntax-checked (`bash -n`) and the manifests structurally tested; never run on a real cluster. (3) The ApplicationSet watches `products/*/chart` (what the recipes emit), not `products/*/deploy` as the issue words it, and no product has a committed `chart/` yet.
- #19 P2-09: `helm lint` / `kubeconform` are not in CI: add a step running `scripts/chart-check.sh` (needs helm + kubeconform installed; `.github/workflows/` is off-limits). Neither helm nor a Docker daemon exist here, so charts are only structurally tested (YAML parse + required probes/resources/securityContext) and the Dagger `image`/`signedImage` functions are untested against the engine.
- #12 P2-02: Verdaccio cannot serve extra files, so `.sig` / `.sbom.spdx.json` go to a filesystem attestation store (`FACTORY_ATTESTATION_STORE`, default `dist/attestations/<pkg>/<version>/`), not literally into the registry. OK for now, or add a small sidecar/registry plugin later? Also `release` now requires `FACTORY_SIGNING_KEY`; `sbom`/`sign` Dagger functions are untested against the engine (no Docker daemon); release itself uses an in-process SPDX generator and Node signing (cosign-verify-blob compatible).
- #11 P2-01: the sandbox denied editing `.github/workflows/ci.yml`. Replace the pnpm/node/Nx steps with `dagger call -m pipelines/dagger ci --src=. --base=origin/main` (install Dagger 0.21.11 first). Also `dagger call` itself was never run: no Docker daemon here, so `src/index.ts` is untested against the engine.
- Two builder sessions both did #2 (PRs #50 and #51). Run one builder at a time, or have it claim an issue (label/assignee) before starting.
- oasdiff needs Go on the CI runner (present on ubuntu-latest). OK, or prefer a pinned Docker image?

## Run log
<!-- Each run appends one line: date · issue · result · PR link -->
- 2026-10-23 · #15 P2-05 · products orders-admin-ui + orders-report-worker assembled from product.yaml (orders-api@^1 -> 1.0.1), contract tests vs orders-service, `factory graph sync` (3 tests); ran it against a real graph-service + PostgreSQL: 4 products ingested; `nx affected -t lint test build` green · branch claude/15-two-more-products
- 2026-10-23 · #14 P2-04 · products/graph-service assembled with nestjs-service recipe; migrations 001, GraphStore, ingest/provenance + ingest/lockfile + consumers endpoint; 5 integration tests on real PostgreSQL (throwaway local cluster, or TEST_DATABASE_URL); `nx affected -t lint test build` green · branch claude/gifted-mendel-q9urx7
- 2026-10-23 · #13 P2-03 · provenance.ts (in-toto v1 + SLSA v1 statement, signed with package key, schema + 3 tests), `release` writes it, `factory provenance <pkg>@<ver>`; `nx affected -t lint test build` green · branch claude/gifted-mendel-9ehw2q
- 2026-10-23 · #12 P2-02 · attest.ts (SPDX SBOM, ECDSA P-256 sign/verify), `factory release` writes .sbom/.sig, `factory verify`, Dagger sbom/sign + argv tests, tamper test; `nx affected -t lint test build` green · branch claude/gifted-mendel-9l0s2i
- 2026-10-23 · #11 P2-01 · pipelines/dagger module (lint/test/build/ci), SDK-free plan.ts with 4 tests against a fixture workspace; CI workflow edit and engine run blocked · draft PR · branch claude/gifted-mendel-bahxu1
- 2026-10-23 · #10 P1-10 · contract test + scripts/gate1-demo.sh (additive passes, breaking stopped by oasdiff); fixed stale Nx cache in orders-api emit targets; `nx affected -t lint test build` green · branch claude/gifted-mendel-um3iyh
- 2026-10-23 · #9 P1-09 · `factory assemble` (resolve from Verdaccio, run recipe, install packages, idempotent), products orders-ui + orders-service, 5 tests, lint/test/build green · branch claude/9-assembly-cli
- 2026-10-22 · #1 P1-01 · implemented on branch claude/gifted-mendel-s8l5ww (session-designated branch instead of claude/1-*) · PR opened
- 2026-10-22 · #1 · builder fixed PR #49 review: removed `packageManager` from package.json (CI pnpm conflict) · https://github.com/rakeshjoshi9999/softory.ai/pull/49
- 2026-10-22 · #2 P1-02 · implemented on claude/gifted-mendel-a7vzpd · PR opened
- 2026-10-22 · #3 P1-03 · orders-api material + spectral + oasdiff gate, 7 tests, `nx run-many -t lint test build` green · branch ccr-1e792cec-47hkd8
- 2026-10-22 · #4 P1-04 · ts-angular-client emitter, 3 tests, `nx affected -t lint test build` green (14 tasks) · branch claude/gifted-mendel-7ez63z
- 2026-10-22 · #4 P1-04 · builder fixed PR #53 review (two-arg Emitter contract, no @orval import in output); pushed to session branch claude/gifted-mendel-tc2z2n, not PR head claude/gifted-mendel-7ez63z · https://github.com/rakeshjoshi9999/softory.ai/pull/53
- 2026-10-22 · #8 P1-08 · angular-remote recipe: generator + file-tree snapshot; generated remote passes eslint, ngc, vitest; `nx affected -t lint test build` green (14 tasks) · branch claude/gifted-mendel-x7cms9
- 2026-10-22 · #5 P1-05 · nest-server emitter (DTOs + abstract controller per tag), 6 tests, `nx affected -t lint test build` green · branch claude/gifted-mendel-ar9dmc · PR opened
- 2026-10-22 · PR #54 (#5 P1-05) · builder fixed review: emitter escapes docs/strings, validates identifiers, numeric constraints and patterns at emit time; hostile-spec tests added · https://github.com/rakeshjoshi9999/softory.ai/pull/54
- 2026-10-22 · #7 P1-07 · nestjs-service recipe generator (health, config validation, OTel, src/ext/), file-tree snapshot + lint/tsc/test of a generated service, `nx affected -t lint test build` green · branch claude/gifted-mendel-3vbpuj
- 2026-10-23 · no ready issues · #6 blocked by P1-04/P1-05, #9 by P1-06, #10 by P1-09; waiting on PRs #53/#54/#55
- 2026-10-23 · PR #65 (#14 P2-04) · builder fixed review: consumers() exact package match + prefix-collision test; `nx affected -t lint test build` green (35 tasks) · branch claude/gifted-mendel-q9urx7
- 2026-10-23 · #19 P2-09 · Dagger `image`/`signedImage` (nginx-unprivileged / distroless Node, cosign by digest), deploy/charts/{factory-lib,nestjs-service,angular-remote}, recipes emit `chart/`, scripts/chart-check.sh; `nx affected -t lint test build` green; helm/kubeconform not run (not installed) · branch claude/gifted-mendel-ktn2pj
- 2026-10-23 · PR #65 (#14 P2-04) · builder synced branch with main (merge, PROGRESS/DECISIONS conflicts kept both sides); `nx affected -t lint test build` green (35 tasks); sync used the run · branch claude/gifted-mendel-q9urx7
- 2026-10-23 · #20 P2-10 · deploy/platform (kind config, Argo CD ApplicationSet, Kyverno require-signed-images), scripts/platform-up.sh + platform-test.sh, 5 structural tests; cluster run and CI job blocked · branch claude/20-gitops-kind
