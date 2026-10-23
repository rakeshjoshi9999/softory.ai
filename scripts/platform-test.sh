#!/usr/bin/env bash
# Deploys an unsigned image into the platform cluster and expects Kyverno to reject it.
# Run after scripts/platform-up.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
kubectl create namespace policy-test --dry-run=client -o yaml | kubectl apply -f -
if out="$(kubectl apply -f deploy/platform/test/unsigned-pod.yaml 2>&1)"; then
  echo "platform-test: FAIL - unsigned image was admitted" >&2
  kubectl delete -f deploy/platform/test/unsigned-pod.yaml --ignore-not-found >/dev/null
  exit 1
fi
if grep -qiE 'verify|signature|require-signed-images|no signatures' <<<"$out"; then
  echo "platform-test: PASS - unsigned image rejected"
else
  echo "platform-test: FAIL - rejected for another reason:" >&2; echo "$out" >&2; exit 1
fi
