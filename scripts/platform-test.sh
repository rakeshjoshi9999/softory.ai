#!/usr/bin/env bash
# Deploys an unsigned image into the platform cluster and expects Kyverno to reject it.
# Run after scripts/platform-up.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
kubectl create namespace policy-test --dry-run=client -o yaml | kubectl apply -f -
# Kyverno can report the policy Ready a few seconds before its webhook enforces it, so an admitted
# pod is retried for a bounded time; admission on every attempt is still a failure.
attempts="${PLATFORM_TEST_ATTEMPTS:-12}"
for i in $(seq 1 "$attempts"); do
  if out="$(kubectl apply -f deploy/platform/test/unsigned-pod.yaml 2>&1)"; then
    kubectl delete -f deploy/platform/test/unsigned-pod.yaml --ignore-not-found --timeout=60s >/dev/null
    echo "platform-test: attempt $i/$attempts: unsigned image was admitted, retrying in 5s" >&2
    sleep 5
    continue
  fi
  if grep -qiE 'verify|signature|require-signed-images|no signatures' <<<"$out"; then
    echo "platform-test: PASS - unsigned image rejected"
    exit 0
  fi
  echo "platform-test: FAIL - rejected for another reason:" >&2; echo "$out" >&2; exit 1
done
echo "platform-test: FAIL - unsigned image was admitted on all $attempts attempts" >&2
exit 1
