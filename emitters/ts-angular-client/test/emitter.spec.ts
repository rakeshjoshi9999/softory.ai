import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { emit, emitter } from '../src/index.js';

const input = resolve(__dirname, '../../../materials/orders-api/generated/openapi.yaml');
const dirs: string[] = [];
const outDir = async () => {
  const d = await mkdtemp(join(tmpdir(), 'emit-test-'));
  dirs.push(d);
  return d;
};
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

const bundle = { name: 'orders-api', type: 'api-contract' as const, specPath: input };
const committed = resolve(__dirname, '../../../materials/orders-api/generated/angular-client');

describe('ts-angular-client emitter', () => {
  it('declares the Emitter contract', () => {
    expect(emitter).toMatchObject({ id: 'ts-angular-client', accepts: ['api-contract'], target: 'angular' });
    expect(emitter.emit).toHaveLength(2);
  });

  it('emits an HttpClient client with typed models for orders-api', async () => {
    const out = await outDir();
    const { files } = await emit(bundle, { outputDir: out });
    expect(files.length).toBeGreaterThan(1);
    const service = files.find((f) => f.endsWith('.service.ts'));
    expect(service).toBeDefined();
    const code = await readFile(join(out, service!), 'utf8');
    expect(code).toContain('HttpClient');
    expect(files.some((f) => f.startsWith('models/'))).toBe(true);
  }, 60_000);

  it('emits no @orval/* imports (products must not depend on emitter tooling)', async () => {
    const out = await outDir();
    const { files } = await emit(bundle, { outputDir: out });
    for (const f of files) expect(await readFile(join(out, f), 'utf8'), f).not.toMatch(/@orval\//);
  }, 60_000);

  it('is byte-identical across runs', async () => {
    const a = await outDir();
    const b = await outDir();
    const ra = await emit(bundle, { outputDir: a });
    const rb = await emit(bundle, { outputDir: b });
    expect(ra.files).toEqual(rb.files);
    for (const f of ra.files) {
      expect(await readFile(join(a, f), 'utf8')).toBe(await readFile(join(b, f), 'utf8'));
    }
  }, 60_000);

  it('matches the committed orders-api client', async () => {
    const out = await outDir();
    const { files } = await emit(bundle, { outputDir: out });
    for (const f of files) {
      expect(await readFile(join(out, f), 'utf8'), f).toBe(await readFile(join(committed, f), 'utf8'));
    }
  }, 60_000);
});
