import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

  it('the rejection test deploys an unsigned image from the in-cluster registry address', () => {
    const [doc] = parseAllDocuments(read('deploy/platform/test/unsigned-pod.yaml'));
    expect(doc.toJS()).toMatchObject({ kind: 'Pod', spec: { containers: [{ image: 'factory-registry:5000/unsigned:latest' }] } });
    expect(read('scripts/platform-test.sh')).toContain('unsigned-pod.yaml');
    const up = read('scripts/platform-up.sh');
    expect(up).toContain('${REG_NAME}:5000');
    expect(up).toContain('--allowInsecureRegistry=true');
  });

  it('the positive control pod is a placeholder for a signed image, signed by digest', () => {
    const [doc] = parseAllDocuments(read('deploy/platform/test/signed-pod.yaml'));
    expect(doc.toJS().spec.containers[0].image).toBe('@@IMAGE@@');
    const test = read('scripts/platform-test.sh');
    expect(test).toMatch(/cosign sign .*--key "\$KEY"/);
    expect(test).toContain('signed@$signed_digest');
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

  describe('classifyDenial', () => {
    const load = () => import(join(root, 'deploy/platform/test/admission.mjs')) as Promise<{ classifyDenial(t: string): string }>;
    it('accepts only Kyverno\'s missing-signature denial', async () => {
      const { classifyDenial } = await load();
      const denial = 'admission webhook "mutate.kyverno.svc-fail" denied the request: policy Pod/policy-test/unsigned for resource violation: require-signed-images: verify-cosign-signature: failed to verify image factory-registry:5000/unsigned:latest: .attestors[0].entries[0].keys: no signatures found';
      expect(classifyDenial(denial)).toBe('policy-denial');
    });
    it('reports registry and network errors as infra, not as a policy denial', async () => {
      const { classifyDenial } = await load();
      const failure = (m: string) => `denied the request: require-signed-images: failed to verify image: ${m}`;
      expect(classifyDenial(failure('GET https://x/v2/: dial tcp 127.0.0.1:5000: connect: connection refused'))).toBe('infra-error');
      expect(classifyDenial(failure('MANIFEST_UNKNOWN: manifest unknown'))).toBe('infra-error');
      expect(classifyDenial('Error from server (Forbidden): something else')).toBe('other');
    });
  });

  describe('platform-test.sh with fake tools', () => {
    const run = (applyOutput: string, applyStatus: number) => {
      const bin = mkdtempSync(join(tmpdir(), 'platform-test-'));
      const fake = (name: string, body: string) => {
        writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
      };
      fake('docker', '[ "$1" = build ] && cat >/dev/null; case "$1" in inspect) echo factory-registry@sha256:abc;; esac');
      fake('cosign', 'exit 0');
      // the unsigned pod gets the scripted result; everything else (namespace, signed pod) is accepted
      // drain stdin so the script's `... | docker build -` and `kubectl create | kubectl apply -f -` pipes never dies of SIGPIPE
      fake('kubectl', `[[ "$*" == *' -f -'* ]] && cat >/dev/null; if [[ "$*" == *unsigned-pod.yaml* && "$1" == apply ]]; then echo '${applyOutput}'; exit ${applyStatus}; fi; exit 0`);
      const key = join(bin, 'cosign.key');
      writeFileSync(key, 'k');
      return spawnSync('bash', [join(root, 'scripts/platform-test.sh')], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FACTORY_COSIGN_KEY: key, PLATFORM_TEST_ATTEMPTS: '2', PLATFORM_TEST_RETRY_SLEEP: '0' },
      });
    };
    it('passes on the Kyverno denial and then admits the signed image', () => {
      const r = run('denied: require-signed-images: no signatures found', 1);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain('signed image admitted');
    });
    it('fails when the refusal is a registry error', () => {
      const r = run('denied: require-signed-images: dial tcp: connection refused', 1);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('not by the signature policy');
    });
    it('fails when the policy is removed (unsigned image admitted)', () => {
      const r = run('pod/unsigned created', 0);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('admitted on all 2 attempts');
    });
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
