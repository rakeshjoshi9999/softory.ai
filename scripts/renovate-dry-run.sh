#!/usr/bin/env bash
# Dry run of Renovate against the repo's product lockfiles and a mock registry that has
# @factory/* 1.0.1 and 1.1.0. Prints the branches Renovate would create.
# Needs node 22; Renovate is fetched with npx unless RENOVATE_BIN is set.
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/renovate/mock-registry.mjs & REG=$!
trap 'kill $REG 2>/dev/null || true' EXIT
sleep 1
RENOVATE="${RENOVATE_BIN:-npx --yes renovate@41}"
LOG=${RENOVATE_LOG:-/tmp/renovate-dry-run.log}
LOG_LEVEL=debug RENOVATE_CONFIG_FILE=renovate.json \
  $RENOVATE --platform=local --dry-run=full > "$LOG" 2>&1 || true
# platform=local cannot push branches, so Renovate ends with a harmless "Cannot sync git" error
# after lookup; the upgrades it computed are in the log. Summarise them.
node -e '
const t = require("fs").readFileSync(process.argv[1], "utf8");
const rows = []; let pending = [];
const lines = t.split("\n");
for (const l of lines) {
  let x;
  if ((x = l.match(/"depName": "(@factory\/[^"]+)"/))) pending.push({ dep: x[1] });
  else if ((x = l.match(/"newVersion": "([^"]+)"/)) && pending.length) pending[pending.length - 1].to = x[1];
  else if ((x = l.match(/"currentVersion": "([^"]+)"/)) && pending.length) pending[pending.length - 1].from = x[1];
  else if ((x = l.match(/"updateType": "([^"]+)"/)) && pending.length) pending[pending.length - 1].type = x[1];
  else if ((x = l.match(/"packageFile": "(products\/[^"]+)"/))) { for (const p of pending) rows.push({ file: x[1], ...p }); pending = []; }
}
for (const r of rows) console.log(`renovate/factory-packages: ${r.file}  ${r.dep} ${r.from ?? "?"} -> ${r.to} (${r.type})`);
if (!rows.length) { console.error("no upgrades found"); process.exit(1); }
' "$LOG"
