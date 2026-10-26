#!/usr/bin/env bash
# Proves the signature policy: an unsigned image is denied by require-signed-images (not by a
# registry or network error) and an image signed with the factory key is admitted.
# Run after scripts/platform-up.sh. FACTORY_COSIGN_KEY is the private key matching the policy
# (platform-up writes it to .platform/cosign.key when it generates the pair).
set -euo pipefail
cd "$(dirname "$0")/.."
REG_HOST=localhost:5001            # where the host pushes
REG_CLUSTER=factory-registry:5000  # where Kyverno and the nodes pull
KEY="${FACTORY_COSIGN_KEY:-.platform/cosign.key}"
attempts="${PLATFORM_TEST_ATTEMPTS:-12}"
delay="${PLATFORM_TEST_RETRY_SLEEP:-5}"

for tool in docker kubectl cosign node; do
  command -v "$tool" >/dev/null || { echo "platform-test: $tool is required" >&2; exit 1; }
done
[ -f "$KEY" ] || { echo "platform-test: cosign private key $KEY not found (set FACTORY_COSIGN_KEY)" >&2; exit 1; }

build_push() { # name -> pushes a distinct image so each has its own digest
  printf 'FROM busybox:1.36\nLABEL factory.platform-test=%s\n' "$1" | docker build -q -t "$REG_HOST/$1:latest" - >/dev/null
  docker push -q "$REG_HOST/$1:latest" >/dev/null
}
build_push unsigned
build_push signed
signed_digest="$(docker inspect --format '{{index .RepoDigests 0}}' "$REG_HOST/signed:latest" | sed 's/.*@//')"
COSIGN_PASSWORD="${COSIGN_PASSWORD:-}" cosign sign --yes --key "$KEY" --tlog-upload=false \
  --allow-insecure-registry "$REG_HOST/signed@$signed_digest" >/dev/null

kubectl create namespace policy-test --dry-run=client -o yaml | kubectl apply -f -
kubectl delete pod unsigned signed -n policy-test --ignore-not-found --timeout=60s >/dev/null

# Kyverno can report the policy Ready a few seconds before its webhook enforces it, so an admitted
# pod is retried for a bounded time; admission on every attempt is still a failure.
denied=0
for i in $(seq 1 "$attempts"); do
  if out="$(kubectl apply -f deploy/platform/test/unsigned-pod.yaml 2>&1)"; then
    kubectl delete -f deploy/platform/test/unsigned-pod.yaml --ignore-not-found --timeout=60s >/dev/null
    echo "platform-test: attempt $i/$attempts: unsigned image was admitted, retrying in ${delay}s" >&2
    sleep "$delay"
    continue
  fi
  if kind="$(node deploy/platform/test/admission.mjs <<<"$out")"; then
    echo "platform-test: unsigned image denied by require-signed-images"; denied=1; break
  fi
  echo "platform-test: FAIL - unsigned pod refused, but not by the signature policy ($kind):" >&2
  echo "$out" >&2; exit 1
done
[ "$denied" -eq 1 ] || { echo "platform-test: FAIL - unsigned image was admitted on all $attempts attempts" >&2; exit 1; }

# Positive control: the same cluster admits an image signed with the factory key.
signed_manifest="$(mktemp)"
sed "s|@@IMAGE@@|$REG_CLUSTER/signed@$signed_digest|" deploy/platform/test/signed-pod.yaml >"$signed_manifest"
if ! out="$(kubectl apply -f "$signed_manifest" 2>&1)"; then
  echo "platform-test: FAIL - signed image was not admitted:" >&2; echo "$out" >&2; exit 1
fi
kubectl delete -f "$signed_manifest" --ignore-not-found --timeout=60s >/dev/null
echo "platform-test: PASS - unsigned image rejected by policy, signed image admitted"
