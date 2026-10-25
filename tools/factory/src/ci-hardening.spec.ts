import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('proposed CI workflows (tools/factory/ci)', () => {
  const ci = read('tools/factory/ci/ci.yml');

  it('verifies downloads against pinned SHA-256 checksums', () => {
    expect(ci).toMatch(/KUBECONFORM_SHA256=[0-9a-f]{64}/);
    expect(ci).toMatch(/DAGGER_SHA256=[0-9a-f]{64}/);
    expect(ci.match(/sha256sum -c -/g)).toHaveLength(2);
  });

  it('does not pipe a download into a shell or tar', () => {
    expect(ci).not.toMatch(/curl[^\n]*\|\s*(sudo\s+)?(-E\s+)?(sh|bash|tar)\b/);
    expect(ci).not.toContain('install.sh');
  });

  it('impact.yml passes base_ref through env, never inline in a script', () => {
    const impact = read('tools/factory/ci/impact.yml');
    const runLines = impact.split('\n').filter((l) => /^\s+(run:|git |for )/.test(l));
    expect(runLines.join('\n')).not.toContain('github.base_ref');
    expect(impact).toContain('BASE_REF: ${{ github.base_ref }}');
  });
});
