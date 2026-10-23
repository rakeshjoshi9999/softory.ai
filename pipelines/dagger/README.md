# pipelines/dagger

Dagger module (TypeScript) holding the factory's shared CI blocks: `lint`, `test`, `build` and
`ci`. Every product runs the same pipeline, locally and in GitHub Actions.

```
dagger call ci --src=. --base=origin/main
dagger call lint --src=.     # also: test, build
```

- `src/plan.ts` is the SDK-free logic (which Nx command each block runs); it is unit-tested.
- `src/index.ts` is the thin Dagger wrapper (container, mounts, exec). It needs the Dagger engine
  (Docker) and is only type-checked by Dagger itself.
