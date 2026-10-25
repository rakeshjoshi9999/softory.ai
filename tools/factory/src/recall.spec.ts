import { describe, expect, it } from 'vitest';
import { issuePayload, parsePackageRef, recall } from './recall.js';

function fakeFetch(consumers: { product: string; package: string }[], opts: { graphStatus?: number; state?: string; openIssues?: string[] } = {}) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
    if (url.endsWith('/state')) return new Response('{}', { status: opts.graphStatus ?? 200 });
    if (url.endsWith('/consumers')) return new Response(JSON.stringify(consumers));
    if (url.includes('/versions/') && !init?.method) return new Response(JSON.stringify({ state: opts.state ?? 'released' }));
    if (url.includes('api.github.com') && !init?.method) return new Response(JSON.stringify((opts.openIssues ?? []).map((title) => ({ title }))));
    return new Response('{}', { status: 201 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ang = '@factory/orders-api-angular@1.0.1';
const consumers = [{ product: 'orders-ui', package: ang }, { product: 'orders-ui', package: ang }, { product: 'orders-admin-ui', package: ang }];

describe('recall', () => {
  it('parses package refs', () => {
    expect(parsePackageRef('@factory/orders-api-angular@1.0.1')).toEqual({ pkg: '@factory/orders-api-angular', material: 'orders-api', version: '1.0.1' });
    expect(() => parsePackageRef('left-pad@1.0.0')).toThrow(/not @factory/);
  });

  it('sets the state, deprecates on the registry and opens one issue per affected product', async () => {
    const { impl, calls } = fakeFetch(consumers);
    const deprecated: string[][] = [];
    const r = await recall('@factory/orders-api-angular@1.0.1', {
      reason: 'wrong totals',
      graphUrl: 'http://graph',
      registry: 'http://reg',
      repo: 'o/r',
      token: 't',
      fetchImpl: impl,
      deprecate: (...a) => void deprecated.push(a),
    });
    expect(calls.find((c) => c.method === 'PUT')).toEqual({ url: 'http://graph/materials/orders-api/versions/1.0.1/state', method: 'PUT', body: { state: 'recalled', reason: 'wrong totals' } });
    expect(deprecated).toEqual([['@factory/orders-api-angular@1.0.1', 'RECALLED: wrong totals', 'http://reg']]);
    expect(r.products).toEqual(['orders-admin-ui', 'orders-ui']);
    const posts = calls.filter((c) => c.url === 'https://api.github.com/repos/o/r/issues');
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => p.body)).toEqual(r.issues.map((i) => i.payload));
    expect(posts[0]!.body).toEqual(issuePayload('orders-admin-ui', '@factory/orders-api-angular', '1.0.1', 'wrong totals'));
    expect((posts[0]!.body as { labels: string[] }).labels).toEqual(['recall']);
  });

  it('ignores consumers of the material version\'s other packages', async () => {
    const mixed = [...consumers, { product: 'orders-service', package: '@factory/orders-api-nest@1.0.1' }, { product: 'orders-report-worker', package: '@factory/orders-api-nest@1.0.1' }];
    const { impl, calls } = fakeFetch(mixed);
    const r = await recall('@factory/orders-api-angular@1.0.1', { reason: 'x', graphUrl: 'http://graph', repo: 'o/r', token: 't', fetchImpl: impl, deprecate: () => undefined });
    expect(r.products).toEqual(['orders-admin-ui', 'orders-ui']);
    expect(calls.filter((c) => c.url.includes('api.github.com') && c.method === 'POST')).toHaveLength(2);
  });

  it('opens no issues when nobody consumes the version, and needs no token then', async () => {
    const { impl, calls } = fakeFetch([]);
    const r = await recall('@factory/orders-api-nest@2.0.0', { reason: 'x', graphUrl: 'http://graph', fetchImpl: impl, deprecate: () => undefined });
    expect(r.issues).toEqual([]);
    expect(calls.every((c) => c.url.startsWith('http://graph'))).toBe(true);
  });

  it('deprecates on the registry before the graph is told, so a failed graph update never leaves graph recalled and registry not', async () => {
    const order: string[] = [];
    const { impl } = fakeFetch(consumers, { graphStatus: 404 });
    const tracked = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') order.push('graph');
      return impl(url, init);
    }) as unknown as typeof fetch;
    await expect(recall('@factory/orders-api-nest@9.9.9', { reason: 'x', graphUrl: 'http://graph', fetchImpl: tracked, deprecate: () => void order.push('registry') })).rejects.toThrow(/404/);
    expect(order).toEqual(['registry', 'graph']);
    await expect(recall('@factory/orders-api-nest@1.0.0', { reason: ' ' })).rejects.toThrow(/--reason/);
  });
});

describe('recall idempotency', () => {
  const run = (o: Parameters<typeof fakeFetch>[1]) => {
    const { impl, calls } = fakeFetch(consumers, o);
    const deprecated: string[][] = [];
    const p = recall(ang, { reason: 'x', graphUrl: 'http://graph', repo: 'o/r', token: 't', fetchImpl: impl, deprecate: (...a) => void deprecated.push(a) });
    return { p, calls, deprecated };
  };

  it('skips products that already have an open recall issue', async () => {
    const { p, calls } = run({ openIssues: [issuePayload('orders-ui', '@factory/orders-api-angular', '1.0.1', 'x').title] });
    const r = await p;
    expect(r.existingIssues).toEqual(['orders-ui']);
    expect(r.issues.map((i) => i.product)).toEqual(['orders-admin-ui']);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('changes nothing when the version is already recalled and its issues exist', async () => {
    const titles = ['orders-ui', 'orders-admin-ui'].map((p) => issuePayload(p, '@factory/orders-api-angular', '1.0.1', 'x').title);
    const { p, calls, deprecated } = run({ state: 'recalled', openIssues: titles });
    const r = await p;
    expect(r.alreadyRecalled).toBe(true);
    expect(r.issues).toEqual([]);
    expect(deprecated).toEqual([]);
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('on an already recalled version still opens issues that a failed earlier run missed', async () => {
    const { p, calls, deprecated } = run({ state: 'recalled' });
    const r = await p;
    expect(r.issues).toHaveLength(2);
    expect(deprecated).toEqual([]);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});

describe('recall dry run', () => {
  it('reads the graph but writes nothing', async () => {
    const { impl, calls } = fakeFetch(consumers);
    const deprecated: string[][] = [];
    const r = await recall(ang, { reason: 'CVE-1', dryRun: true, graphUrl: 'http://graph', fetchImpl: impl, deprecate: (...a) => void deprecated.push(a) });
    expect(r.products).toEqual(['orders-admin-ui', 'orders-ui']);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expect(deprecated).toEqual([]);
  });
});
