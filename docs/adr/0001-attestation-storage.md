# ADR 0001 — Where attestations live

Status: **proposed** (a human records the decision)
Issue: #80 (P2-16). Origin: finding 2 of the PR #63 review.

## Context

Every released package has a tarball, an SPDX SBOM, a detached signature and a signed in-toto/SLSA
provenance statement (P2-02, P2-03, P2-15). The issue for P2-02 asked for these to sit in the
registry storage. Verdaccio only serves npm metadata and tarballs, so today they are written to a
filesystem store: `FACTORY_ATTESTATION_STORE`, default `dist/attestations/@factory/<pkg>/<version>/`.

Consumers of that store:

- `factory verify` reads tarball + `.sig` from the store (`tools/factory/src/cli.ts`).
- `factory scan all` / the nightly job walks `*.sbom.spdx.json` (`scan.ts: storedSboms`); it fails on an empty store.
- the graph ingests provenance (`POST /ingest/provenance`) from the store at release time.
- `release` refuses a version that is in the registry but missing from the store (P2-15).

The problem: the store is a local directory. CI runners, the nightly job and other machines cannot
see it unless someone restores it. A fresh checkout cannot verify anything it did not release itself.

## Options

| | A. Filesystem store (today) | B. Companion npm package per release | C. OCI artifacts in Harbor/zot via `oras` | D. Small sidecar service |
|---|---|---|---|---|
| What | Directory tree beside the registry | `@factory/<pkg>-attestations@<ver>` holding sbom, sig, provenance(+sig), published to the same registry | Attestations pushed as OCI referrers (artifact type per file) to a subject digest; cosign/oras native | HTTP service (`PUT/GET /attestations/<pkg>/<ver>/<file>`) backed by disk or S3 |
| `factory verify` finds them | Path from env; works only where the dir exists | `npm view`/tarball fetch from the registry it already talks to; no extra config | `oras discover`/`oras pull` by digest; cosign verifies natively | GET by URL; needs service address |
| Nightly scan finds them | Needs the store restored as a CI artifact/cache | Lists packages from the registry, fetches the companion; no state to restore | Lists referrers per package digest | List endpoint on the service |
| Graph finds them | Reads files at release time only | Same registry fetch; can re-ingest any time | Registry API; can re-ingest any time | Service API; can re-ingest any time |
| Effort | None (done) | Low-medium: pack/publish step, naming rule, a "companion exists" check in release | Medium-high: run Harbor or zot, `oras` in release/verify/scan, auth, retention | Highest: new service to build, secure, run and back up |
| Offline / air-gapped | Good locally, but nothing is shared | Good: Verdaccio alone, mirrorable like any npm package | Good with zot (single binary, local disk); Harbor is heavy | Good, if deployed in the enclave; one more thing to operate |
| Weaknesses | Not reachable from CI or peers; easy to lose; trust depends on the host | Doubles package count; companion can drift from its subject unless release enforces both; npm is not an attestation format | Adds a second registry beside npm; tarball must be mirrored too for digest linkage | New attack surface and ops burden for a CRUD store |

## Recommendation

**Option B (companion npm package per release) now; revisit C when product images are signed in an OCI registry.**

Reasons: it keeps one registry and one auth path, needs no new service, works offline with Verdaccio,
and makes `verify`, the nightly scan and the graph stateless (they read the registry, not a directory).
The release flow already packs once and signs those bytes (P2-15), so publishing the companion is the
same step with different files. Images (P2-09) are already signed with cosign by digest, which fits C
naturally; unifying on OCI can happen when packages move to an OCI registry, which is not planned.

Keep the filesystem store as the release-time staging area (source of the companion), not as the
source of truth.

## Follow-up tasks this implies

1. Define the companion package layout and naming (`@factory/<pkg>-attestations`, same version), with a schema for its manifest listing the subject tarball's sha512.
2. `release`: publish the companion after the main package; treat "main published, companion missing" as an error (extends the P2-15 rule).
3. `factory verify <pkg>@<ver>`: fetch tarball and companion from the registry, check the subject digest and signature; no store needed.
4. `factory scan all`: enumerate versions from the registry and fetch SBOMs from companions; drop the "restore the store" requirement in `tools/factory/ci/nightly-scan.yml`.
5. Graph: re-ingest provenance from companions (back-fill existing versions).
6. Migration: publish companions for already-released versions from the existing store.
7. Decide retention and who may publish `-attestations` packages (registry ACL), so a companion cannot be replaced by a non-releaser.

## Decision

_To be recorded by a human (accept B, choose another option, or request changes)._
