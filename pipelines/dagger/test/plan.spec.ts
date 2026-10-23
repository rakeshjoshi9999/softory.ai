import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { assertWorkspace, blockCommand, ciCommands, sbomCommand, signCommand } from '../src/plan.js';

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
