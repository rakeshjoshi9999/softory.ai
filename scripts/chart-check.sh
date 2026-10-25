#!/usr/bin/env bash
# helm lint + kubeconform for every thin chart. Needs helm and kubeconform on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
for chart in deploy/charts/nestjs-service deploy/charts/angular-remote products/*/chart; do
  helm dependency build "$chart" >/dev/null
  helm lint "$chart"
  helm template check "$chart" | kubeconform -strict -summary
done
