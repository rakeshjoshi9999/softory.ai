# Helm charts

- `factory-lib/` — library chart: `factory-lib.service` (API, port 3000, probe `/health`) and
  `factory-lib.static-site` (nginx-unprivileged, port 8080, probe `/`). Probes, resources and a
  restricted security context (non-root, read-only root fs, no capabilities) live only here.
- `nestjs-service/`, `angular-remote/` — thin charts per product kind; each only includes a lib template.
- Recipes generate the same thin chart into `products/<name>/chart/` for new products.

Check with `scripts/chart-check.sh` (needs `helm` and `kubeconform`; runs `helm lint` + `helm template | kubeconform -strict`).
