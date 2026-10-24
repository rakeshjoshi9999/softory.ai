import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const material = 'materials/graph-api';
const bin = (name: string) => join(root, 'node_modules/.bin', name);

const sh = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
  return { code: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const spectral = (file: string) =>
  sh(bin('spectral'), ['lint', file, '--ruleset', 'tools/spectral/.spectral.yaml', '--fail-severity', 'warn']);

// --fail-on ERR: exit 1 when oasdiff finds an error-level (breaking) change.
const breaking = (base: string, revision: string) =>
  sh('tools/oasdiff/oasdiff.sh', ['breaking', base, revision, '--fail-on', 'ERR']);

describe('graph-api material', () => {
  it('material.yaml is valid', () => {
    const r = sh(bin('tsx'), ['tools/factory/src/cli.ts', 'validate', `${material}/material.yaml`]);
    expect(r.output).toContain('valid Material');
    expect(r.code).toBe(0);
  });

  describe('emit-openapi', () => {
    const out = mkdtempSync(join(tmpdir(), 'graph-api-'));
    afterAll(() => rmSync(out, { recursive: true, force: true }));

    it('compiles graph.tsp and matches the committed generated/openapi.yaml', () => {
      const r = sh(bin('tsp'), [
        'compile', `${material}/graph.tsp`,
        '--config', `${material}/tspconfig.yaml`,
        '--option', `@typespec/openapi3.emitter-output-dir=${out}`,
      ]);
      expect(r.code, r.output).toBe(0);
      const fresh = readFileSync(join(out, 'openapi.yaml'), 'utf8');
      const committed = readFileSync(join(root, material, 'generated/openapi.yaml'), 'utf8');
      expect(fresh, 'generated/openapi.yaml is stale: run `pnpm nx run graph-api:emit-openapi`').toBe(committed);
    }, 60_000);

    it('exposes the ingest, consumers and version-state operations', () => {
      const spec = readFileSync(join(root, material, 'generated/openapi.yaml'), 'utf8');
      for (const id of ['ingestProvenance', 'ingestLockfile', 'getVersion', 'listConsumers', 'setVersionState']) expect(spec).toContain(`operationId: ${id}`);
    });
  });

  describe('spectral', () => {
    it('passes on the generated spec', () => {
      const r = spectral(`${material}/generated/openapi.yaml`);
      expect(r.code, r.output).toBe(0);
    }, 60_000);
  });

  describe('oasdiff breaking-change gate', () => {
    // First run builds oasdiff from the Go module proxy, which can take a minute.
    it('passes when the generated spec is compatible with the released one', () => {
      const r = breaking(`${material}/released/openapi.yaml`, `${material}/generated/openapi.yaml`);
      expect(r.code, r.output).toBe(0);
    }, 300_000);
  });
});
