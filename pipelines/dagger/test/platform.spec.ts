import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, parseAllDocuments } from 'yaml';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('local platform (kind + Argo CD + Kyverno)', () => {
  it('kind config names the cluster and enables registry certs.d', () => {
    const kind = parse(read('deploy/platform/kind-config.yaml'));
    expect(kind).toMatchObject({ kind: 'Cluster', name: 'factory' });
    expect(kind.containerdConfigPatches.join('\n')).toContain('/etc/containerd/certs.d');
  });

  it('ApplicationSet discovers every product chart and auto-syncs it', () => {
    const appset = parse(read('deploy/platform/argocd/applicationset.yaml'));
    expect(appset).toMatchObject({ kind: 'ApplicationSet', metadata: { namespace: 'argocd' } });
    expect(appset.spec.generators[0].git.directories[0].path).toBe('products/*/chart');
    expect(appset.spec.template.spec.source.path).toBe('{{ .path.path }}');
    expect(appset.spec.template.spec.syncPolicy.automated).toMatchObject({ prune: true, selfHeal: true });
  });

  it('Kyverno policy enforces Cosign signatures on every image', () => {
    const policy = parse(read('deploy/platform/kyverno/require-signed-images.yaml'));
    expect(policy.spec.validationFailureAction).toBe('Enforce');
    expect(policy.spec.failurePolicy).toBe('Fail');
    const v = policy.spec.rules[0].verifyImages[0];
    expect(v).toMatchObject({ imageReferences: ['*'], required: true, verifyDigest: true });
    expect(v.attestors[0].entries[0].keys.publicKeys).toContain('@@COSIGN_PUBLIC_KEY@@');
  });

  it('Kyverno policy exempts the platform namespaces', () => {
    const rule = parse(read('deploy/platform/kyverno/require-signed-images.yaml')).spec.rules[0];
    expect(rule.exclude.any[0].resources.namespaces).toEqual(expect.arrayContaining(['argocd', 'kyverno', 'kube-system']));
  });

  it('the platform test restarts Argo CD under the policy and waits for it', () => {
    expect(read('scripts/platform-test.sh')).toMatch(/-n argocd rollout restart deploy[\s\S]*rollout status/);
  });

  it('the rejection test deploys an unsigned image', () => {
    const [doc] = parseAllDocuments(read('deploy/platform/test/unsigned-pod.yaml'));
    expect(doc.toJS()).toMatchObject({ kind: 'Pod', spec: { containers: [{ image: expect.stringMatching(/^localhost:5001\/unsigned/) }] } });
    expect(read('scripts/platform-test.sh')).toContain('unsigned-pod.yaml');
  });

  it('scripts exist, are executable and pin versions', () => {
    for (const s of ['scripts/platform-up.sh', 'scripts/platform-test.sh']) {
      expect(existsSync(join(root, s))).toBe(true);
      expect(statSync(join(root, s)).mode & 0o111).not.toBe(0);
    }
    const up = read('scripts/platform-up.sh');
    expect(up).toMatch(/ARGOCD_VERSION=v\d/);
    expect(up).toMatch(/KYVERNO_VERSION=v\d/);
    expect(up).toContain('applicationset.yaml');
    expect(up).toContain('require-signed-images.yaml');
  });

  it('platform-up retries the policy apply and waits for Ready; the test retries before failing', () => {
    const up = read('scripts/platform-up.sh');
    const wait = up.indexOf('kubectl wait --for=condition=Ready clusterpolicy/require-signed-images');
    const apply = up.indexOf('kubectl apply -f "$policyfile"');
    expect(apply).toBeGreaterThan(0);
    expect(up.slice(up.lastIndexOf('for i in $(seq 1', apply), apply)).toContain('for i in');
    expect(wait).toBeGreaterThan(apply);
    expect(wait).toBeLessThan(up.indexOf('platform-up: ready'));
    const test = read('scripts/platform-test.sh');
    expect(test).toMatch(/for i in \$\(seq 1 "\$attempts"\)/);
    expect(test).toContain('admitted on all $attempts attempts');
  });

  it('platform-up checks cosign up front unless a public key is supplied', () => {
    const bin = mkdtempSync(join(tmpdir(), 'platform-up-bin-'));
    // Only docker, kind and kubectl exist; any call past the precheck would hit the fake docker.
    for (const t of ['docker', 'kind', 'kubectl']) {
      writeFileSync(join(bin, t), '#!/bin/sh\necho "$0 called past precheck" >&2\nexit 42\n');
      chmodSync(join(bin, t), 0o755);
    }
    const run = (env: Record<string, string>) =>
      spawnSync('/bin/bash', [join(root, 'scripts/platform-up.sh')], { env: { PATH: bin, ...env }, encoding: 'utf8' });
    const missing = run({});
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('cosign is required');
    const withKey = run({ FACTORY_COSIGN_PUBLIC_KEY: '/dev/null' });
    expect(withKey.stderr).not.toContain('cosign is required');
  });
});
