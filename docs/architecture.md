# Software Factory — architecture (working copy for the build loops)

The full design, diagrams and business context live in the "Software Factory Architecture"
doc on claude.ai. This file is the part the build loops need. When they disagree, the human
updates both; the docs loop keeps this file in sync with the code.

## What we are building
A factory that turns one `product.yaml` into a running, governed product by assembling
versioned raw materials through pluggable emitters, gates and pipelines.

Levels: **materials plants** (spec → signed packages) → **supply chain** (registry, signing,
material graph, recalls) → **assembly lines** (recipe + manifest → product) → **platform
runtime** (deploy, observe, roll back). A **control plane** (Angular + NestJS + Temporal)
orchestrates all of them. Everything is open source.

## Material model
```yaml
apiVersion: factory/v1
kind: Material
metadata:
  name: orders-api
  type: api-contract      # model | api-contract | event | tokens | component | policy | pipeline-block | chart
  owner: team-orders
  version: 1.0.0          # set by Changesets
spec:
  source: orders.tsp
  format: typespec
  validators: [spectral, oasdiff-breaking]
  emitters: [ts-angular-client@1, nest-server@1]
  dependsOn: []
  compatibility: backward # backward | forward | full | none
```
A released material is immutable: source + every emitted package (+ SBOM and provenance from Phase 2).

## Product model
```yaml
apiVersion: factory/v1
kind: Product
metadata:
  name: orders-ui
  owner: team-orders
spec:
  recipe: angular-remote@1
  consumes:
    api: orders-api@^1
  delivery:
    pipeline: frontend@1
    envs: [preview]
```

## Plugin contracts
```ts
interface Emitter {
  id: string; version: string;
  accepts: MaterialType[];            // e.g. ['api-contract']
  target: 'angular' | 'nestjs' | 'python' | 'any';
  emit(input: MaterialBundle, opts: EmitOptions): Promise<EmittedPackage>;
}
interface Gate {
  id: string;
  appliesTo: { materials?: MaterialType[]; productKinds?: ProductKind[] };
  stage: 'material' | 'pr' | 'release' | 'runtime';
  run(ctx: GateContext): Promise<GateResult>;   // pass | warn | fail + evidence
}
interface Recipe {
  kind: ProductKind;                  // 'angular-remote' | 'nestjs-service' | ...
  skeleton: GeneratorRef;
  requiredMaterials: MaterialType[];
  defaultEmitters: Record<MaterialType, EmitterRef>;
  pipeline: PipelineRef; gates: GateRef[]; deploy?: ChartRef;
}
```
Rules: emitters are pure and deterministic; gates return evidence; recipes reference plugins by
version range; generated code lands in `generated/` and is never hand-edited.

## Build roadmap and gates
| Phase | Delivers | Gate (a human closes the `Gate n review` issue to advance) |
| --- | --- | --- |
| 1 Foundations | Nx workspace, TypeSpec → OpenAPI material, Angular + NestJS emitters, Verdaccio, two recipes, assembly CLI | One product rebuilt entirely from its spec |
| 2 Supply chain | Dagger pipeline blocks, Cosign + Syft, Kyverno, material graph v1, Renovate propagation | A spec change reaches 3 products with no manual steps |
| 3 Control plane MVP | Catalog, product and material studios, Temporal run engine, gate center | A design partner runs "new product" end to end without us |
| 4 AI and legacy | Legacy discovery, spec extraction, Factory Readiness score, agent context packs, recalls | First paid transformation |

## Autonomous loops (see `prompts/`)
Builder (hourly), reviewer (every PR), QA (nightly), docs (on merge + weekly), planner (nightly),
retro (weekly); fixer from Phase 2; triage from Phase 3. Humans approve phase gates and any PR
labelled `needs-human`.
