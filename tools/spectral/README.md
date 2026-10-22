# tools/spectral

Spectral ruleset applied to every OpenAPI document emitted from an `api-contract` material.

```sh
pnpm exec spectral lint materials/<name>/generated/openapi.yaml --ruleset tools/spectral/.spectral.yaml --fail-severity warn
```

Extends `spectral:oas` (recommended) and adds factory rules: operationIds and tags are required
(emitters derive names from them), paths are kebab-case, every component schema has a
description, and error responses share the `Problem` schema.
