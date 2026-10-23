# Local registry

`docker compose up registry` starts Verdaccio on http://localhost:4873 (anonymous, local dev only).

- Add a changeset (`pnpm changeset`) naming `@factory/<material>-angular` / `-nest`.
- `pnpm factory release orders-api` applies pending changesets, stages the emitted code and publishes both packages (already-published versions are skipped).
- `pnpm exec tsx tools/registry/verify-install.ts @factory/orders-api-angular @factory/orders-api-nest` installs them into a temp project to prove they resolve.
