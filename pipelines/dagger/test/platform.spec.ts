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
});
