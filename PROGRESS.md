# Progress

Current phase: **Phase 2 — Supply chain** (goal: Gate 2, a spec change reaches 3 products with no manual steps)

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
- P2-14 assembly security (merged, PR #95; #78 closed)

## In progress
- #91 P2-27 builder claims an issue before working on it: PR open, needs-human + needs-review
- #98 P2-28 Dagger index.ts type-checked: PR #124 open, needs-review (affected lint/test/build green)
- #84 P2-20 graph-service API as a TypeSpec material: PR #114 open, needs-review
- #86 P2-22 `factory propagate`: PR #116 open, needs-review
- #87 P2-23 impact dry-run assembly in CI: PR #117 open, needs-human + needs-review
- #88 P2-24 live HTTP contract tests: PR #118 open, needs-review
- #82 P2-18 Dagger module actually runs: draft PR #112 (blocked)
- #85 P2-21 charts for every product + kind e2e: draft PR #115 (blocked)
- #83 P2-19 graph-service runs from built output: merged (PR #113)
- #81 P2-17 retro-review: done, PR open awaiting review; filed #98-#110 (P2-28..P2-40) and added them to #22's Blocked by
- #80 P2-16 attestation storage ADR: PR open, awaiting a human decision (needs-human)
- #79 P2-15: merged (PR #96)
- #21 P2-11 vulnerability scan -> recall: PR open, awaiting review
- #18 P2-08 lifecycle states + `factory recall`: PR open, awaiting review
- #17 P2-07 Renovate propagation: merged (PR #70)
- #15 P2-05 two more products + `factory graph sync`: merged (PR #68)
- #13 P2-03 provenance statements: merged (PR #64)
- #14 P2-04 material graph service: PR #65 open, awaiting review
- #19 P2-09 container images + Helm library chart: merged (PR #66)
- #20 P2-10 GitOps on kind: draft PR #67 (needs-human), blocked on cluster run and CI job

- #16 P2-06 impact analysis: draft PR (needs-human: CI workflow)

- #74 P2-13 scan review fixes: PR open, awaiting review

- #82 P2-18: draft PR open, pnpm pin fix pushed; needs a CI `dagger` job run to confirm
- #99 P2-29 Dagger exclude patterns match nested dirs: PR open, needs-review (criterion 3, Dagger run, not runnable here)

- #90 P2-26 CI hardening: PR open, needs-human + needs-review (proposed `tools/factory/ci/ci.yml`)

## Next up
- #76 P1-11: merged (PR #93); all phase-1 issues are closed.
- #75 Gate 1 review: closed as completed by a human (2026-10-25); phase set to 2.
- #22 P2-12 Gate 2 demo once its Blocked-by tasks are done.

## Gate 1 evidence (P1-10)
- Contract test `materials/orders-api/test/contract.spec.ts` (runs in `nx test orders-api`, so in CI): generated Angular client over real HTTP against a Nest app on the generated controller base; every body is checked against `generated/openapi.yaml`.
- `scripts/gate1-demo.sh` (46 s, local Verdaccio): additive `note` field -> emit -> oasdiff passes -> release 1.0.1 -> 1.1.0 -> both products re-assembled with 1.1.0 and the field present -> contract test green. Breaking change (remove `currency`) -> oasdiff reports 3 errors, nothing released, registry unchanged.
- Gate 1 review opened as #75 (2026-10-24). A re-run of the demo on main a32c061 failed in the baseline release (attestation path ENOENT, see #76).

## Resume notes
<!-- The builder keeps one entry per in-progress issue: done so far, next step, open problems.
     A run cut off by the usage limit resumes from here after the reset. Remove the entry when the PR opens. -->

## Open questions for a human
- #85 P2-21: criterion 3 (`platform-e2e` workflow run) is not done: no such workflow exists and `.github/workflows/` is off-limits. Please add one running `scripts/platform-up.sh && scripts/platform-test.sh`, trigger it and link the result. The `charts` CI job should call `scripts/chart-check.sh`.
- #87 P2-23: `impact.yml` (Verdaccio service, base-branch release, `--seed-registry`) was never run in Actions or against Verdaccio here; a human copies it to `.github/workflows/impact.yml` and checks the first PR comment says "Dry-run assembly: run". It also folds in the safe `BASE_REF` env from #90.
- #88 P2-24: shared test support is `products/orders-service/test-support/live-service.ts` (outside `src/`, so not built); it and the consumer specs load emitted material code by computed path because module boundaries forbid static imports. Tests use the generated client/Nest base from `materials/orders-api/generated`, not the registry-installed packages (CI has no registry).
- #82 P2-18: root cause of the failing `dagger` job was unpinned corepack pnpm 12 (ERR_PNPM_IGNORED_BUILDS on install). Pinned pnpm 9.15.9 in the container; the CI `dagger` job on PR #112 then passed (lint/test/build in the engine). The `verify` job switch stays a needs-human workflow change.
- PR #114 (#84 P2-20) is behind main and conflicts in `tools/factory/src/recall.ts`: #89 (now on main) added the already-recalled check on raw `fetch`, while #84 moved the CLI to the generated typed graph client. Both changed the same logic, so I did not guess. Needs the #84 author to merge main and re-apply the idempotency check (graph state `recalled` skips deprecate + PUT) through the typed client; `PROGRESS.md`/`DECISIONS.md` conflicts are keep-both.
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
- oasdiff v1.32.1 needs Go >= 1.26; with an older Go, `go run` tries to download a toolchain from golang.org (blocked in the planner sandbox, 2026-10-24). Make sure CI's Go is >= 1.26 (actions/setup-go) or pin an oasdiff release binary/image.
- PR #128 (#99 P2-29) criterion 3: needs a human with a Dagger engine to create a nested `products/<x>/node_modules/marker`, run `dagger call -m pipelines/dagger ci --src=.` (or a container listing) and post the output showing the marker is absent; then re-label `needs-review`. Builder cannot run Dagger here.

## Run log
<!-- Each run appends one line: date · issue · result · PR link -->
- 2026-10-25 · planner (2nd run) · phase 2; no `Gate 2 review` issue and phase-2 work still open (#22, #90, #91, #98-#110, #122), so no gate opened and nothing relabelled; queue healthy (12 ready + unblocked: #99-#102, #104-#109, #122, plus needs-human #90/#91/#110; #103 waits on P2-32), no new tasks; no blocked/in-progress issue idle for 24 h (#98 pushed 02:09Z, draft PR #124). Note: the "In progress" list above is stale (#82-#89 are closed) · branch claude/planner-2026-10-25
- 2026-10-25 · planner · #75 Gate 1 review closed as completed by rakeshjoshi9999 (2026-10-25T01:58Z), so phase set to 2 (Supply chain); no open or closed phase-2 issue was labelled `planned`, so nothing relabelled; resolved "Phase record" question removed; stopped per planner step 2 · branch claude/planner-2026-10-25
- 2026-10-24 · #84 P2-20 · materials/graph-api (TypeSpec, Spectral, oasdiff, emitters), graph-service extends generated Ingest/Versions controllers (synced into gitignored src/generated), factory CLI uses one typed graph client checked against the spec; `nx affected -t lint test build` green (44 tasks) · branch claude/gifted-mendel-iqp4uc
- 2026-10-24 · builder · PR #112 (#82) already current with main · no action
- 2026-10-25 · #85 P2-21 · second platform-e2e run: policy apply refused by Kyverno's webhook (connection refused) right after the admission controller rolled out; platform-up now retries the apply up to 24×5 s before the Ready wait · needs another platform-e2e run · branch claude/85-product-charts
- 2026-10-25 · #85 P2-21 · first platform-e2e run (human-triggered): platform up OK, unsigned image admitted 2 s after the policy was applied. platform-up now waits for `clusterpolicy/require-signed-images` Ready; platform-test retries an admitted pod up to 12×5 s before failing; spec test fails without it · needs another platform-e2e run · branch claude/85-product-charts
- 2026-10-24 · #85 P2-21 · graph-service chart from recipe templates, chart-check.sh covers products/*/chart, test that every product has a chart (fails without), architecture doc names `products/*/chart`; kind e2e not run (needs human + workflow); `nx affected -t lint test build` green · branch claude/85-product-charts
- 2026-10-24 · #86 P2-22 · `factory propagate <material>@<version> [--dry-run]` (assemble, test, one PR per consumer, patch-only `claude-approved`, idempotent), 8 tests; `nx affected -t lint test build` see PR · branch claude/86-propagate
- 2026-10-24 · #88 P2-24 · live HTTP contract specs for orders-ui, orders-admin-ui, orders-report-worker against a real orders-service (generated Nest base) via emitted client; breaking fixture spec (getOrder removed) makes ui/admin fail; 6 new tests; lint/test/build green for the 4 products · branch claude/88-live-contract-tests
- 2026-10-24 · builder · synced draft PR #112 (#82) with main (merge, PROGRESS/DECISIONS kept both sides, affected green); closed stale #83 (merged via #113), unblocks #84 P2-20 for the next run · branch claude/82-dagger-run
- 2026-10-24 · builder · no open PRs; closed stale #81 (merged via #111); #82 P2-18 · dagger job failed on corepack's default pnpm 12 (ignored build scripts); pinned pnpm 9.15.9 + test; engine not runnable here; `nx affected -t lint test build` green · branch claude/82-dagger-run · draft PR
- 2026-10-24 · #89 P2-25 · recall skips registry/graph writes when graph state is recalled and dedupes open `recall` issues by title (re-run opens only missing ones); 3 new tests; `nx affected -t lint test build` green · branch claude/89-recall-idempotent
- 2026-10-24 · planner (2nd run) · #75 Gate 1 review still open (P1-11 merged via #93, all phase-1 issues closed), so phase left at 1 and nothing relabelled; phase-2 queue healthy (#89, #98-#109 ready), no new tasks; no blocked/in-progress issue idle for 24 h (#82/#85/#84/#86/#87/#88 all pushed today); re-run of gate1-demo.sh on main b1c0331 could not complete here: oasdiff v1.32.1 could not be fetched (Go module proxy blocked in this sandbox, and it needs Go >= 1.26), not a code failure · branch claude/planner-2026-10-24
- 2026-10-24 · #83 P2-19 · built graph-service resolves `migrations/` next to `ext/` (build target copies them into dist); test runs the real nx build output from a temp dir outside the repo via node main.js: migrates + /health ok, fails without fix; Dagger image untouched (#102/#103 cover its outDir/node_modules); `nx affected -t lint test build` green · branch claude/83-graph-service-built
- 2026-10-24 · builder · synced PRs #93 and #92 with main (merge, no conflicts, affected lint/test/build green); then #74 P2-13 · parseTrivy tolerates missing Results, scan all skips recalled/collects failures/fails on empty store/scans images, recall order registry then graph, nightly-scan.yml permissions+auth; 5 new tests; `nx affected -t lint test build` green · branch claude/74-scan-review-fixes
- 2026-10-24 · #76 P1-11 · attest/release resolve the attestation store to an absolute path, relative-store test (fails without fix), recipe `chart/` for orders-ui/orders-service committed so the demo leaves `git status` empty; fresh-checkout `gate1-demo.sh` exits 0; `nx affected -t lint test build` green · branch claude/gifted-mendel-31nljy
- 2026-10-24 · PR #73 · synced claude/ci-wiring with main (clean merge, nx affected green)
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
- 2026-10-24 · #79 P2-15 · release validates key first, packs once, attests the tarball (SBOM/sig/provenance) for all packages, then `npm publish <tarball>`; published-but-unattested versions throw; 5 new tests; gate1-demo passes; `nx affected -t lint test build` green · branch claude/gifted-mendel-v4gnbs
- 2026-10-24 · builder · synced PR #94 (#74) with main (PROGRESS/DECISIONS kept both sides, affected green); then #78 P2-14 · assemble fails closed on missing integrity (sha512, else shasum), foreign-origin tarball URL, unsafe tarballs (links/abs/`..`) + `--no-same-owner`; 3 new tests (fail without fix); `nx affected -t lint test build` green · branch claude/78-assembly-security
- 2026-10-24 · #80 P2-16 · docs/adr/0001-attestation-storage.md compares 4 options, recommends companion npm package; closed stale #79 (PR #96 merged); docs only · branch claude/80-attestation-adr
- 2026-10-24 · #81 P2-17 · reviewer subagent reviewed merged PRs #62, #66, #67, #69: 13 blocking problems filed as #98-#110 (P2-28..P2-40, #110 needs-human), summary comment on each PR, #22 Blocked by extended; backlog/phase-2.json not updated (follow-up for planner) · docs only · branch claude/gifted-mendel-c9z1n0
- 2026-10-24 · PR #114 (#84 P2-20) · builder fixed review: refreshed pnpm-lock.yaml for materials/graph-api packages (frozen install now passes); `nx affected -t lint test build` 44 tasks green · branch claude/gifted-mendel-iqp4uc
- 2026-10-24 · #87 P2-23 · impact reports `dryRun: run|skipped` (registry ping), `--seed-registry` publishes the proposed version before the dry-run, impact.yml starts Verdaccio and releases base versions; 3 new tests; `nx affected -t lint test build` green · branch claude/87-impact-ci-dryrun
- 2026-10-24 · PR #117 (#87 P2-23) · builder fixed review: impact.yml starts Verdaccio with the repo config (docker run + ping wait) instead of a service container, base-release and per-material failures now appear in the PR comment instead of being swallowed; workflow still never run · branch claude/87-impact-ci-dryrun
- 2026-10-24 · PR #116 (#86 P2-22) · builder fixed review: branches start from origin/base and the checkout/product tree is restored; assembled pin must equal the requested version else `failed` (no PR, no label); per-product try/catch around assemble/tests/push; 3 new tests incl. a real temp git repo; `nx affected -t lint test build` green · branch claude/86-propagate
- 2026-10-24 · builder · PR #118 (#88 P2-24) review fix: consumer products get implicitDependencies on orders-api/orders-service and test inputs covering generated/, fixtures and test-support, so an orders-api change makes `nx affected -t test` run them (verified via `nx show projects --affected --files=materials/orders-api/generated/openapi.yaml`); `nx affected -t lint test build` green · branch claude/88-live-contract-tests
- 2026-10-25 · builder · sync check: PRs #112,#115,#116,#117,#118 current with main; #114 conflicts in recall.ts (logic, left alone, already `blocked`, question logged); no changes-requested PRs; no resumable issue; no new work started (sync used the run) · branch claude/gifted-mendel-w77bkq
- 2026-10-25 · builder · #98 (P2-28): criterion 1 done, criteria 2-3 blocked (no Dagger CLI in sandbox); draft PR; closed stale #89 (merged in #120) · branch claude/98-dagger-typecheck
- 2026-10-25 · human (Codespace) · #98 (P2-28): `dagger call -m pipelines/dagger ci --src=. --base=origin/main` exit 0; with a deliberately failing test it exits 1 · branch claude/98-dagger-typecheck
- 2026-10-25 · builder · #98 (P2-28): merged main into PR #124, `nx affected -t lint test build` green, marked ready + needs-review · branch claude/98-dagger-typecheck
- 2026-10-25 · #99 P2-29 · `SOURCE_EXCLUDES` (`**/node_modules`, `**/.nx`, `**/dist`) in plan.ts used by workspace(), 2 tests; criterion 3 (Dagger run with nested node_modules) not run, no Dagger/Docker here; `nx affected -t lint test build` green · branch claude/99-dagger-excludes
- 2026-10-25 · #91 P2-27 · prompts/builder.md step 5: claim comment + back-off + 3 h stale takeover; docs only; `nx affected` run below · branch claude/91-builder-claim
- 2026-10-25 · #90 P2-26 · proposed ci.yml at tools/factory/ci/ci.yml (kubeconform + Dagger from pinned release archives, SHA-256 verified; checksums confirmed against upstream files); impact.yml already used `env: BASE_REF` (criterion 2 met on main); 3 new tests (fail without file); `nx affected -t lint test build` green · branch claude/90-ci-hardening
- 2026-10-25 · builder · synced PR #128 (#99) with main (merge, PROGRESS/DECISIONS kept both sides, affected green); #127 current; #128 changes-requested needs Dagger-engine evidence from a human, so no code fix possible · branch claude/99-dagger-excludes
