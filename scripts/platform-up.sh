#!/usr/bin/env bash
# Local platform: kind cluster + local registry (localhost:5001) + Argo CD + Kyverno,
# the ApplicationSet that syncs products/*/chart, and the signature-enforcement policy.
# Needs docker, kind, kubectl. Versions are pinned below.
set -euo pipefail
cd "$(dirname "$0")/.."

ARGOCD_VERSION=v2.13.3        # Apache-2.0
KYVERNO_VERSION=v1.13.4       # Apache-2.0
REG_NAME=factory-registry
REG_PORT=5001
PUBKEY_FILE="${FACTORY_COSIGN_PUBLIC_KEY:-}"

for tool in docker kind kubectl; do
  command -v "$tool" >/dev/null || { echo "platform-up: $tool is required" >&2; exit 1; }
done

if [ "$(docker inspect -f '{{.State.Running}}' "$REG_NAME" 2>/dev/null || true)" != "true" ]; then
  docker rm -f "$REG_NAME" >/dev/null 2>&1 || true
  docker run -d --restart=always -p "127.0.0.1:${REG_PORT}:5000" --network bridge --name "$REG_NAME" registry:2 >/dev/null
fi

kind get clusters | grep -qx factory || kind create cluster --config deploy/platform/kind-config.yaml

# Point every node's containerd at the registry, and join it to the kind network.
for node in $(kind get nodes --name factory); do
  docker exec "$node" mkdir -p "/etc/containerd/certs.d/localhost:${REG_PORT}"
  printf '[host."http://%s:5000"]\n' "$REG_NAME" |
    docker exec -i "$node" tee "/etc/containerd/certs.d/localhost:${REG_PORT}/hosts.toml" >/dev/null
done
docker network connect kind "$REG_NAME" 2>/dev/null || true

kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argocd --server-side -f "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/install.yaml"
kubectl apply --server-side -f "https://github.com/kyverno/kyverno/releases/download/${KYVERNO_VERSION}/install.yaml"
kubectl -n argocd rollout status deploy/argocd-applicationset-controller --timeout=300s
kubectl -n kyverno rollout status deploy/kyverno-admission-controller --timeout=300s

kubectl apply -f deploy/platform/argocd/applicationset.yaml

if [ -z "$PUBKEY_FILE" ]; then
  keydir="$(mktemp -d)"
  (cd "$keydir" && COSIGN_PASSWORD= cosign generate-key-pair >/dev/null)
  PUBKEY_FILE="$keydir/cosign.pub"
  echo "platform-up: generated throwaway cosign key in $keydir"
fi
# Indent the PEM to sit under the `publicKeys: |-` block in the policy.
pemfile="$(mktemp)"
sed 's/^/                      /' "$PUBKEY_FILE" >"$pemfile"
sed -e "/@@COSIGN_PUBLIC_KEY@@/{r $pemfile" -e 'd}' deploy/platform/kyverno/require-signed-images.yaml | kubectl apply -f -
# Applying the policy returns before Kyverno has wired it into its admission webhooks; until it is
# Ready, pods are admitted unchecked. Wait so "Kyverno enforcing" below is true.
kubectl wait --for=condition=Ready clusterpolicy/require-signed-images --timeout=180s
echo "platform-up: ready (registry localhost:${REG_PORT}, Argo CD in ns argocd, Kyverno enforcing)"
