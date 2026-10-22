# tools

The factory CLI (`factory assemble`, `factory validate`) and shared tooling.

## `factory validate`
```sh
pnpm factory validate materials/orders-api/material.yaml products/orders-ui/product.yaml
```
Picks the schema from `kind` (`Material` or `Product`) and checks the file against
`tools/schemas/{material,product}.schema.json`. Exits 0 when every file is valid, 1 with one
readable line per problem otherwise, 2 on bad usage.
