#!/usr/bin/env bash
# helm lint + kubeconform for every thin chart. Needs helm and kubeconform on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
for chart in deploy/charts/nestjs-service deploy/charts/angular-remote products/*/chart; do
  helm dependency build "$chart" >/dev/null
  helm lint "$chart"
  rendered=$(helm template check "$chart")
  echo "$rendered" | kubeconform -strict -summary
  # kubelet rejects runAsNonRoot without a numeric uid
  echo "$rendered" | grep -Eq 'runAsUser: [0-9]+' || { echo "$chart: no numeric runAsUser" >&2; exit 1; }
done
