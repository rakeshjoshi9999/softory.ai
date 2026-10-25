import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
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

  describe('impact report step', () => {
    const script = (): string => {
      const wf = parse(read('tools/factory/ci/impact.yml')) as { jobs: { impact: { steps: { name?: string; run?: string }[] } } };
      return wf.jobs.impact.steps.find((st) => st.name === 'Impact report')!.run!;
    };

    const runStep = (materials: string[]): string => {
      const dir = mkdtempSync(join(tmpdir(), 'impact-'));
      const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
      git('init', '-q', '-b', 'main');
      git('config', 'user.email', 't@t');
      git('config', 'user.name', 't');
      git('commit', '-q', '--allow-empty', '-m', 'base');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      for (const m of materials) {
        mkdirSync(join(dir, 'materials', m), { recursive: true });
        writeFileSync(join(dir, 'materials', m, 'material.yaml'), 'x');
      }
      git('add', '-A');
      git('commit', '-q', '-m', 'change');
      // fake pnpm: `pnpm exec tsx <cli> impact materials/<m> ...`
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'pnpm'), '#!/bin/bash\ncase "$5" in\n  materials/broken) echo "broken: needs released/openapi.yaml" >&2; exit 2 ;;\n  *) echo "impact of $5: patch" ;;\nesac\n', { mode: 0o755 });
      execFileSync('bash', ['-c', script()], { cwd: dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BASE_REF: 'main' }, stdio: 'pipe' });
      return readFileSync(join(dir, 'impact.md'), 'utf8');
    };

    it('writes a failure section with the error for a material whose analysis exits non-zero, and still reports the others', () => {
      const md = runStep(['broken', 'good']);
      expect(md).toContain('**Impact analysis failed for `broken`** (exit 2)');
      expect(md).toContain('needs released/openapi.yaml');
      expect(md).toContain('impact of materials/good: patch');
    });

    it('rejects a directory name with a space explicitly instead of word-splitting it', () => {
      const md = runStep(['my material']);
      expect(md).toContain('unsupported material directory name');
      expect(md).not.toContain('impact of');
    });
  });
});
