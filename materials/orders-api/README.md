# orders-api

API contract for orders: list, get and create. Edit `orders.tsp` only; `generated/` is emitter output.

| Command | What it does |
| --- | --- |
| `pnpm nx run orders-api:emit-openapi` | TypeSpec → `generated/openapi.yaml` |
| `pnpm nx run orders-api:lint-openapi` | Spectral with `tools/spectral/.spectral.yaml` |
| `pnpm nx run orders-api:breaking` | oasdiff against `released/openapi.yaml`; fails on breaking changes |
| `pnpm nx run orders-api:validate` | checks `material.yaml` against the factory schema |
| `pnpm nx run orders-api:test` | all of the above as Vitest checks, plus a breaking-change fixture |

`released/openapi.yaml` is the spec of the last released version (1.0.0). Until the registry
exists (P1-06) it is a committed snapshot; update it only as part of a release.
