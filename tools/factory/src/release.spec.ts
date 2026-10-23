import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packagesFor, pendingChangesets, readVersion, stage } from './release.js';

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'release-spec-'));
  for (const p of packagesFor('demo', root)) {
    mkdirSync(p.source, { recursive: true });
    mkdirSync(p.dir, { recursive: true });
    writeFileSync(join(p.source, 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ name: p.name, version: '2.3.4' }));
  }
  return root;
}

describe('release', () => {
  it('names the angular and nest packages after the material', () => {
    expect(packagesFor('orders-api').map((p) => p.name)).toEqual(['@factory/orders-api-angular', '@factory/orders-api-nest']);
  });

  it('stages emitter output into each package src, with an index for the angular client', () => {
    const root = workspace();
    const [angular, nest] = packagesFor('demo', root);
    stage(angular);
    stage(nest);
    expect(existsSync(join(angular.dir, 'src', 'a.ts'))).toBe(true);
    expect(readFileSync(join(angular.dir, 'src', 'index.ts'), 'utf8')).toContain("export * from './models/index';");
    expect(existsSync(join(nest.dir, 'src', 'a.ts'))).toBe(true);
    expect(readVersion(nest)).toBe('2.3.4');
  });

  it('fails when the emitter has not run', () => {
    const [angular] = packagesFor('missing', mkdtempSync(join(tmpdir(), 'release-spec-')));
    expect(() => stage(angular)).toThrow(/emit targets/);
  });

  it('detects pending changesets but ignores the README', () => {
    const root = workspace();
    mkdirSync(join(root, '.changeset'));
    writeFileSync(join(root, '.changeset', 'README.md'), 'x');
    expect(pendingChangesets(root)).toBe(false);
    writeFileSync(join(root, '.changeset', 'brave-lions.md'), '---\n---\n');
    expect(pendingChangesets(root)).toBe(true);
  });
});
