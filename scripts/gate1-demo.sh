#!/usr/bin/env bash
# Gate 1 demo: one product rebuilt entirely from its spec.
#
#   1. additive change : add a field to orders.tsp -> emit -> oasdiff passes -> release -> re-assemble
#                        both products -> contract test passes with the new version installed
#   2. breaking change : remove a field -> oasdiff stops the run before anything is released
#
# Needs a registry at $FACTORY_REGISTRY (default http://localhost:4873/). If none answers it starts
# `docker compose up registry`, or Verdaccio through npx when Docker is unavailable.
# The working tree is restored on exit; run it from a clean checkout.
set -euo pipefail

cd "$(dirname "$0")/.."
REGISTRY="${FACTORY_REGISTRY:-http://localhost:4873/}"
export FACTORY_REGISTRY="$REGISTRY"
TSP=materials/orders-api/orders.tsp
STATE=(materials products .changeset)
registry_pid=""
tmp="$(mktemp -d)"

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'gate1-demo: %s\n' "$*" >&2; exit 1; }
nx() { pnpm --silent nx "$@"; }
emit() { nx run-many -t emit-openapi emit-nest-server emit-angular-client -p orders-api --output-style=static >/dev/null; }
published_versions() { npm view @factory/orders-api-nest versions --json --registry "$REGISTRY" 2>/dev/null || echo '[]'; }

restore() {
  [[ -n "$registry_pid" ]] && kill "$registry_pid" 2>/dev/null || true
  git checkout -q -- "${STATE[@]}" 2>/dev/null || true
  git clean -fdq -- .changeset materials/orders-api/generated 2>/dev/null || true
  rm -rf "$tmp"
}
trap restore EXIT

[[ -z "$(git status --porcelain -- "${STATE[@]}")" ]] || die "uncommitted changes in ${STATE[*]}: commit or stash them first"

ensure_registry() {
  local ping="${REGISTRY%/}/-/ping"
  curl -fsS "$ping" >/dev/null 2>&1 && return 0
  say "starting a local registry"
  if docker info >/dev/null 2>&1; then
    docker compose up -d registry >/dev/null
  else
    local port="${REGISTRY##*:}"; port="${port%/}"
    sed -e "s#^storage:.*#storage: $tmp/storage#" -e "s#^listen:.*#listen: 127.0.0.1:$port#" tools/registry/config.yaml > "$tmp/verdaccio.yaml"
    npx --yes verdaccio@6 --config "$tmp/verdaccio.yaml" >"$tmp/verdaccio.log" 2>&1 &
    registry_pid=$!
  fi
  for _ in $(seq 60); do curl -fsS "$ping" >/dev/null 2>&1 && return 0; sleep 1; done
  die "registry at $REGISTRY did not start"
}

assemble_both() {
  pnpm --silent factory assemble products/orders-service/product.yaml
  pnpm --silent factory assemble products/orders-ui/product.yaml
}

installed_has_note() {
  grep -rq "note" "products/orders-ui/node_modules/@factory/orders-api-angular/src/models/order.ts" \
    && grep -rq "note" "products/orders-service/node_modules/@factory/orders-api-nest/src/dto/order.dto.ts"
}

ensure_registry
if [ -z "${FACTORY_SIGNING_KEY:-}" ]; then # throwaway demo key, never written to the repo
  FACTORY_SIGNING_KEY="$(openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt)"
  export FACTORY_SIGNING_KEY
fi
say "baseline: emit and release the current spec"
emit
pnpm --silent factory release orders-api
assemble_both

say "1/2 additive change: add an optional 'note' field to Order"
# Insert after the createdAt property of the Order model.
node -e '
const fs = require("fs"); const f = process.argv[1];
const s = fs.readFileSync(f, "utf8");
const marker = "  createdAt: utcDateTime;\n";
if (!s.includes(marker)) { console.error("marker not found in " + f); process.exit(1); }
fs.writeFileSync(f, s.replace(marker, marker + "\n  /** Free-text note from the customer. */\n  note?: string;\n"));
' "$TSP"
emit
say "oasdiff: additive change must pass"
nx run orders-api:breaking --output-style=static >/dev/null || die "additive change was flagged as breaking"
nx run orders-api:lint-openapi --output-style=static >/dev/null || die "spectral rejected the additive change"

cat > .changeset/gate1-note-field.md <<'CS'
---
"@factory/orders-api-angular": minor
"@factory/orders-api-nest": minor
---

Add optional `note` to Order.
CS
pnpm --silent factory release orders-api
cp materials/orders-api/generated/openapi.yaml materials/orders-api/released/openapi.yaml
assemble_both
installed_has_note || die "re-assembled products do not carry the new field"
grep -h '"@factory' products/orders-ui/product.lock.json products/orders-service/product.lock.json
say "contract test with the new field"
pnpm --silent vitest run --root . materials/orders-api/test/contract >/dev/null || die "contract test failed after the additive change"
echo "additive change: released, both products re-assembled, contract test green"

say "2/2 breaking change: remove 'currency' from Order"
git checkout -q -- "${STATE[@]}"
git clean -fdq -- .changeset
before="$(published_versions)"
node -e '
const fs = require("fs"); const f = process.argv[1];
const s = fs.readFileSync(f, "utf8");
const re = /\n  \/\*\* ISO 4217 currency code\. \*\/\n  @pattern\("\^\[A-Z\]\{3\}\$"\)\n  currency: string;\n/;
if (!re.test(s)) { console.error("currency property not found"); process.exit(1); }
fs.writeFileSync(f, s.replace(re, ""));
' "$TSP"
emit
if nx run orders-api:breaking --output-style=static >"$tmp/breaking.log" 2>&1; then
  die "oasdiff did not flag the breaking change"
fi
grep -iE "error|removed" "$tmp/breaking.log" | head -5 || true
[[ "$(published_versions)" == "$before" ]] || die "registry changed although the breaking change was stopped"
echo "breaking change: stopped by oasdiff before release; registry unchanged"

say "Gate 1 demo passed"
