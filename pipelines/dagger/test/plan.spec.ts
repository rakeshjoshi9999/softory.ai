import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { assertWorkspace, assertWorkspaceEntries, blockCommand, ciCommands, sbomCommand, signCommand } from '../src/plan.js';

const fixture = join(fileURLToPath(new URL('.', import.meta.url)), 'fixture-workspace');

describe('pipeline plan', () => {
  it('accepts the fixture workspace and rejects an empty directory', () => {
    expect(() => assertWorkspace(fixture)).not.toThrow();
    expect(() => assertWorkspace(mkdtempSync(join(tmpdir(), 'empty-')))).toThrow(/not a factory workspace/);
  });

  it('runs every project without a base and only affected ones with one', () => {
    expect(blockCommand('lint')).toEqual(['pnpm', 'nx', 'run-many', '-t', 'lint']);
    expect(blockCommand('test', 'origin/main')).toEqual(['pnpm', 'nx', 'affected', '-t', 'test', '--base=origin/main']);
  });

  it('ci is lint, test, build in that order', () => {
    expect(ciCommands('origin/main').map((c) => c[c.indexOf('-t') + 1])).toEqual(['lint', 'test', 'build']);
    expect(ciCommands().every((c) => c.includes('run-many'))).toBe(true);
  });

  it('rejects unknown blocks and option-like base refs', () => {
    expect(() => blockCommand('deploy' as never)).toThrow(/unknown block/);
    expect(() => blockCommand('lint', '--help')).toThrow(/invalid base/);
    expect(() => blockCommand('lint', 'a;rm -rf /')).toThrow(/invalid base/);
  });

  it('builds syft and cosign argv; the key is an env reference, never a value', () => {
    expect(sbomCommand('p.tgz')).toEqual(['syft', 'file:p.tgz', '-o', 'spdx-json']);
    expect(signCommand('p.tgz')).toContain('env://COSIGN_KEY');
    expect(() => sbomCommand('--oops')).toThrow(/invalid file/);
    expect(() => signCommand('a b')).toThrow(/invalid file/);
  });
});

import { scanCommand } from '../src/plan.js';
describe('scanCommand', () => {
  it('builds Trivy argv and rejects option-looking targets', () => {
    expect(scanCommand('sbom', 'sbom.spdx.json')).toEqual(['trivy', 'sbom', '--format', 'json', '--quiet', 'sbom.spdx.json']);
    expect(scanCommand('image', 'registry:5000/orders@sha256:abc')[1]).toBe('image');
    expect(() => scanCommand('image', '--oops')).toThrow(/invalid scan target/);
  });
});

import { PNPM_VERSION, pnpmSetupCommands } from '../src/plan.js';
import { readFileSync } from 'node:fs';
describe('pnpmSetupCommands', () => {
  it('pins pnpm to the major the lockfile was written by', () => {
    expect(pnpmSetupCommands()).toEqual([['corepack', 'enable'], ['corepack', 'prepare', `pnpm@${PNPM_VERSION}`, '--activate']]);
    const lock = readFileSync(join(fileURLToPath(new URL('../../..', import.meta.url)), 'pnpm-lock.yaml'), 'utf8');
    expect(lock).toMatch(/^lockfileVersion: '9\./m);
    expect(PNPM_VERSION.split('.')[0]).toBe('9');
  });
});

import { SOURCE_EXCLUDES } from '../src/plan.js';
describe('SOURCE_EXCLUDES', () => {
  it('matches node_modules, .nx and dist at any depth', () => {
    expect([...SOURCE_EXCLUDES]).toEqual(['**/node_modules', '**/.nx', '**/dist']);
  });
  it('is what index.ts passes to withDirectory', () => {
    const src = readFileSync(join(fileURLToPath(new URL('../src/index.ts', import.meta.url))), 'utf8');
    expect(src).toContain('exclude: [...SOURCE_EXCLUDES]');
  });
});

describe('Dagger workspace guard', () => {
  it('rejects a directory listing without the workspace files', () => {
    expect(() => assertWorkspaceEntries(['package.json', 'nx.json'], 'src')).toThrow(/not a factory workspace: pnpm-lock.yaml missing/);
    expect(() => assertWorkspaceEntries(['package.json', 'nx.json', 'pnpm-lock.yaml'], 'src')).not.toThrow();
  });
  it('runs before the container is built in index.ts', () => {
    const src = readFileSync(join(fileURLToPath(new URL('../src/index.ts', import.meta.url))), 'utf8');
    expect(src.indexOf('assertWorkspaceEntries(await src.entries()')).toBeGreaterThan(0);
    expect(src.indexOf('assertWorkspaceEntries(await src.entries()')).toBeLessThan(src.indexOf('pnpmSetupCommands().reduce'));
  });
});
