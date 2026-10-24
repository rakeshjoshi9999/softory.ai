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
- #21 P2-11 vulnerability scan -> recall: PR open, awaiting review
- #18 P2-08 lifecycle states + `factory recall`: PR open, awaiting review
- #17 P2-07 Renovate propagation: merged (PR #70)
- #15 P2-05 two more products + `factory graph sync`: merged (PR #68)
- #13 P2-03 provenance statements: merged (PR #64)
- #14 P2-04 material graph service: PR #65 open, awaiting review
- #19 P2-09 container images + Helm library chart: merged (PR #66)
- #20 P2-10 GitOps on kind: draft PR #67 (needs-human), blocked on cluster run and CI job

- #16 P2-06 impact analysis: draft PR (needs-human: CI workflow)

## Next up
- #76 P1-11: fix the `factory release` attestation path. `scripts/gate1-demo.sh` currently fails on a fresh checkout of main.
- #75 Gate 1 review (needs-human): close it as completed once P1-11 merges and the demo passes. The planner then sets the phase to 2.

## Gate 1 evidence (P1-10)
- Contract test `materials/orders-api/test/contract.spec.ts` (runs in `nx test orders-api`, so in CI): generated Angular client over real HTTP against a Nest app on the generated controller base; every body is checked against `generated/openapi.yaml`.
- `scripts/gate1-demo.sh` (46 s, local Verdaccio): additive `note` field -> emit -> oasdiff passes -> release 1.0.1 -> 1.1.0 -> both products re-assembled with 1.1.0 and the field present -> contract test green. Breaking change (remove `currency`) -> oasdiff reports 3 errors, nothing released, registry unchanged.
- Gate 1 review opened as #75 (2026-10-24). A re-run of the demo on main a32c061 failed in the baseline release (attestation path ENOENT, see #76).

## Resume notes
<!-- The builder keeps one entry per in-progress issue: done so far, next step, open problems.
     A run cut off by the usage limit resumes from here after the reset. Remove the entry when the PR opens. -->

## Open questions for a human
- Phase record: PROGRESS.md still says Phase 1 and no `Gate 1 review` issue existed, yet Phase 2 issues were relabelled `ready` and #11–#21 are already done. The planner did not change the phase. Closing #75 makes the record match.
- #21 P2-11: the nightly job is provided at `tools/factory/ci/nightly-scan.yml` (copy to `.github/workflows/`, off-limits for me). It scans the attestation store (`FACTORY_ATTESTATION_STORE`), which CI must restore; images are scanned only via the Dagger `scan --image`. Trivy and the Dagger `scan` function were never run (no trivy/Docker here); tests use a fixture Trivy report.
- #18 P2-08: recall opens issues via the GitHub REST API using `GITHUB_TOKEN` + `FACTORY_RECALL_REPO` (or `GITHUB_REPOSITORY`); never run against real GitHub or Verdaccio here (mocked / injected). Re-running a recall opens duplicate issues.
- #17 P2-07: Renovate needs a real platform (GitHub App/self-hosted run) with network access to the registry to open PRs; `renovate.json` points at localhost:4873 for now. The dry run uses `--platform=local`, which only computes upgrades. The Renovate workflow/app is off-limits for me (`.github/workflows/`). Also the PR auto-merge bumps the lockfile pin only; re-assembly after merge is not automated yet.
- #16 P2-06: the sandbox denied writing `.github/workflows/`. The PR-comment job is at `tools/factory/ci/impact.yml`: copy it to `.github/workflows/impact.yml`. Also: the dry-run assembly needs a registry; when it is unreachable (CI) that check is reported as skipped, only the range check and contract tests run. Consumers come from the graph service (FACTORY_GRAPH_URL), else lockfiles.
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
- 2026-10-24 · planner · all phase-1 issues closed and no gate issue existed, so opened #75 Gate 1 review (needs-human). Re-ran scripts/gate1-demo.sh on main: it fails on a fresh checkout, so filed #76 [P1-11] (phase-1, ready). No blocked or stale in-progress issues. Phase left at 1 · branch claude/planner-2026-10-24
- 2026-10-24 · #21 P2-11 · Dagger `scan` (Trivy JSON), `factory scan <pkg@ver>|all [--report|--sbom] [--dry-run]`, `recall --dryRun`, fixture critical-CVE test recalls in dry-run; `nx affected -t lint test build` green · branch claude/21-vuln-scan
- 2026-10-23 · #18 P2-08 · version state in graph-service (GET/PUT /materials/:n/versions/:v[/state]), `factory recall` (graph state, npm deprecate, one GitHub issue per product), `assemble` refuses RECALLED versions; 6 new tests; `nx affected -t lint test build` green · branch claude/18-recall
- 2026-10-23 · #17 P2-07 · renovate.json (regex manager on product lockfiles, grouped, patch automerge), scripts/renovate-dry-run.sh shows upgrades for all 4 consumers, architecture doc section, 3 tests; branch claude/17-renovate-propagation
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
- 2026-10-23 · #16 P2-06 · `factory impact <material-dir> [--json]` (oasdiff classify, graph/lockfile consumers, dry-run assemble, contract tests, Markdown+JSON), 7 tests; workflow blocked, provided at tools/factory/ci/impact.yml · branch claude/16-impact-analysis
- 2026-10-23 · PR #71 (#18 P2-08) · builder fixed review: recall keeps only consumer rows whose package equals the recalled package; mixed angular/nest test added; `nx affected -t lint test build` green · branch claude/18-recall
- 2026-10-24 · PR #92 · builder fixed review: added P1-11 (issue #76) to backlog/phase-1.json so P2-15's blockedBy resolves · branch claude/p2-backlog-extension
