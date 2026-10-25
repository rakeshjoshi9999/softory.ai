import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { classify, impact, realDeps, renderMarkdown, type ImpactDeps } from './impact.js';

let root: string;
const PRODUCTS = ['orders-admin-ui', 'orders-service', 'orders-ui'];

const put = (rel: string, content: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'impact-'));
  put('materials/orders-api/material.yaml', 'metadata:\n  name: orders-api\n  version: 1.0.1\n');
  put('materials/orders-api/released/openapi.yaml', 'a');
  put('materials/orders-api/generated/openapi.yaml', 'b');
  for (const p of PRODUCTS) {
    put(`products/${p}/product.yaml`, `apiVersion: factory/v1\nkind: Product\nmetadata:\n  name: ${p}\n  owner: t\nspec:\n  recipe: nestjs-service@1\n  consumes:\n    api: orders-api@^1\n`);
    put(`products/${p}/product.lock.json`, JSON.stringify({ packages: { '@factory/orders-api-nest': '1.0.1' } }));
  }
});

const deps = (breaking: unknown[], changelog: unknown[], graph: string[] | null = PRODUCTS): ImpactDeps => ({
  oasdiff: (args) => JSON.stringify(args[0] === 'breaking' ? breaking : changelog),
  graphConsumers: async () => graph,
  registryReachable: async () => true,
  dryAssemble: async () => ({ status: 'ok', detail: 'would write 0 file(s)' }),
  runTests: () => ({ ok: true, detail: 'contract tests passed' }),
});

afterEach(() => vi.unstubAllGlobals());

describe('classify', () => {
  it('no differences is a patch', () => expect(classify(deps([], []), 'a', 'b')).toEqual({ change: 'patch', findings: [] }));
  it('a non-breaking change is minor', () => expect(classify(deps([], [{ level: 1, text: 'added field' }]), 'a', 'b').change).toBe('minor'));
  it('an error-level change is breaking', () => expect(classify(deps([{ level: 3, text: 'removed currency' }], []), 'a', 'b').change).toBe('breaking'));
});

describe('impact', () => {
  it('patch change: all consumers accept it and nothing fails', async () => {
    const r = await impact('materials/orders-api', { root, deps: deps([], []) });
    expect(r).toMatchObject({ change: 'patch', next: '1.0.2', ok: true });
    expect(r.products.map((p) => p.product)).toEqual(PRODUCTS);
    expect(r.products.every((p) => p.via === 'graph' && p.rangeAccepts)).toBe(true);
    expect(renderMarkdown(r)).toContain('no consumer breaks');
  });

  it('breaking change lists all three consumers and fails', async () => {
    const r = await impact('materials/orders-api', { root, deps: deps([{ level: 3, text: 'removed currency' }], []) });
    expect(r).toMatchObject({ change: 'breaking', next: '2.0.0', ok: false });
    expect(r.products.map((p) => p.product)).toEqual(PRODUCTS);
    expect(r.products.every((p) => !p.rangeAccepts)).toBe(true);
    const md = renderMarkdown(r);
    for (const p of PRODUCTS) expect(md).toContain(`| ${p} |`);
    expect(md).toContain('removed currency');
  });

  it('falls back to lockfiles when the graph is unreachable', async () => {
    const r = await impact('materials/orders-api', { root, deps: deps([], [], null) });
    expect(r.products.map((p) => [p.product, p.via])).toEqual(PRODUCTS.map((p) => [p, 'lockfile']));
  });

  it('runs the dry-run assembly when the registry answers', async () => {
    const r = await impact('materials/orders-api', { root, deps: deps([], []) });
    expect(r.dryRun).toBe('run');
    expect(renderMarkdown(r)).toContain('Dry-run assembly: run against the registry.');
  });

  it('seeds the proposed version before the dry-run assembly, only with seed', async () => {
    const calls: string[] = [];
    const d: ImpactDeps = {
      ...deps([], [{ level: 1, text: 'added field' }]),
      seedRegistry: (m, v) => calls.push(`seed ${m}@${v}`),
      dryAssemble: async () => (calls.push('assemble'), { status: 'ok', detail: 'ok' }),
    };
    await impact('materials/orders-api', { root, deps: d });
    expect(calls).not.toContain('seed orders-api@1.1.0');
    await impact('materials/orders-api', { root, deps: d, seed: true });
    expect(calls.slice(-4)).toEqual(['seed orders-api@1.1.0', 'assemble', 'assemble', 'assemble']);
  });

  it('reports the dry-run as skipped when no registry answers', async () => {
    const d = { ...deps([], []), registryReachable: async () => false, dryAssemble: async () => { throw new Error('must not run'); } };
    const r = await impact('materials/orders-api', { root, deps: d });
    expect(r).toMatchObject({ dryRun: 'skipped', ok: true });
    expect(renderMarkdown(r)).toContain('skipped');
  });

  it('reports an unreachable registry per consumer as skipped without failing the report', async () => {
    const d = { ...deps([], []), dryAssemble: async () => ({ status: 'skipped' as const, detail: 'registry unreachable' }) };
    const r = await impact('materials/orders-api', { root, deps: d });
    expect(r.ok).toBe(true);
    expect(r.products.every((p) => p.assemble.status === 'skipped')).toBe(true);
    const md = renderMarkdown(r);
    expect(md).toContain('skipped (registry unreachable)');
    expect(md).not.toContain('FAIL');
  });

  it('a manifest or recipe error still fails the consumer', async () => {
    const d = { ...deps([], []), dryAssemble: async () => ({ status: 'failed' as const, detail: 'unknown recipe' }) };
    const r = await impact('materials/orders-api', { root, deps: d });
    expect(r.ok).toBe(false);
    expect(renderMarkdown(r)).toContain('FAIL (unknown recipe)');
  });

  it('reports a failing consumer test', async () => {
    const d = { ...deps([], []), runTests: () => ({ ok: false, detail: 'boom' }) };
    expect((await impact('materials/orders-api', { root, deps: d })).ok).toBe(false);
  });

  it('lists lockfile consumers when the graph answers with an empty list', async () => {
    const r = await impact('materials/orders-api', { root, deps: deps([{ level: 3, text: 'removed currency' }], [], []) });
    expect(r.products.map((p) => [p.product, p.via])).toEqual(PRODUCTS.map((p) => [p, 'lockfile']));
    expect(r.ok).toBe(false);
    expect(renderMarkdown(r)).not.toContain('No consuming products found');
  });

  it('queries the graph for every pinned version and finds products on different versions', async () => {
    const other = mkdtempSync(join(tmpdir(), 'impact-pins-'));
    const w = (rel: string, content: string) => {
      mkdirSync(dirname(join(other, rel)), { recursive: true });
      writeFileSync(join(other, rel), content);
    };
    w('materials/orders-api/material.yaml', 'metadata:\n  name: orders-api\n  version: 1.0.1\n');
    w('materials/orders-api/released/openapi.yaml', 'a');
    w('materials/orders-api/generated/openapi.yaml', 'b');
    const pins: Record<string, string> = { 'old-ui': '1.0.0', 'new-ui': '1.0.1' };
    for (const [p, v] of Object.entries(pins)) w(`products/${p}/product.lock.json`, JSON.stringify({ packages: { '@factory/orders-api-nest': v } }));
    const asked: string[] = [];
    const d: ImpactDeps = { ...deps([], []), graphConsumers: async (_m, v) => (asked.push(v), v === '1.0.0' ? ['old-ui'] : []) };
    const r = await impact('materials/orders-api', { root: other, deps: d });
    expect(asked.sort()).toEqual(['1.0.0', '1.0.1']);
    expect(r.products.map((p) => [p.product, p.via])).toEqual([['new-ui', 'lockfile'], ['old-ui', 'graph']]);
  });
});

describe('realDeps graphConsumers', () => {
  const stub = (status: number, body: unknown) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status }));

  it('maps a 404 to an empty list', async () => {
    stub(404, { message: 'unknown' });
    expect(await realDeps(root).graphConsumers('orders-api', '1.0.1')).toEqual([]);
  });

  it('maps other failures to null (graph unreachable)', async () => {
    stub(500, {});
    expect(await realDeps(root).graphConsumers('orders-api', '1.0.1')).toBeNull();
  });
});

describe('realDeps dryAssemble', () => {
  const repo = join(__dirname, '../../..');
  const manifest = join(repo, 'products/orders-ui/product.yaml');

  it('returns skipped when the registry is unreachable', async () => {
    vi.stubEnv('FACTORY_REGISTRY', 'http://127.0.0.1:1/');
    expect(await realDeps(repo).dryAssemble(manifest)).toEqual({ status: 'skipped', detail: 'registry unreachable' });
    vi.unstubAllEnvs();
  });

  it('returns failed for a manifest that does not exist', async () => {
    vi.stubEnv('FACTORY_REGISTRY', 'http://127.0.0.1:1/');
    expect((await realDeps(repo).dryAssemble(join(repo, 'products/nope/product.yaml'))).status).toBe('failed');
    vi.unstubAllEnvs();
  });
});
