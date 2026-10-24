import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { GraphError, graphClient } from './graph-client.js';

const spec = parse(readFileSync(fileURLToPath(new URL('../../../materials/graph-api/generated/openapi.yaml', import.meta.url)), 'utf8')) as {
  paths: Record<string, Record<string, unknown>>;
};

function recorder(status = 200, body: unknown = {}) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe('graph client matches the graph-api OpenAPI spec', () => {
  it('every call hits a method + path the spec defines', async () => {
    const { calls, impl } = recorder(200, []);
    const g = graphClient('http://graph/', impl);
    await g.ingestLockfile({ product: 'p', build: 'b', packages: {} });
    await g.listConsumers('orders-api', '1.0.1');
    await g.getVersion('orders-api', '1.0.1');
    await g.setVersionState('orders-api', '1.0.1', { state: 'recalled', reason: 'x' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST http://graph/ingest/lockfile',
      'GET http://graph/materials/orders-api/versions/1.0.1/consumers',
      'GET http://graph/materials/orders-api/versions/1.0.1',
      'PUT http://graph/materials/orders-api/versions/1.0.1/state',
    ]);
    for (const c of calls) {
      const path = new URL(c.url).pathname.replace('/orders-api', '/{name}').replace('/1.0.1', '/{version}');
      expect(spec.paths[path]?.[c.method.toLowerCase()], `${c.method} ${path} is not in the spec`).toBeDefined();
    }
  });

  it('throws GraphError carrying the status', async () => {
    const { impl } = recorder(404, { message: 'nope' });
    await expect(graphClient('http://graph', impl).getVersion('a', '1.0.0')).rejects.toMatchObject({ status: 404 });
    await expect(graphClient('http://graph', impl).getVersion('a', '1.0.0')).rejects.toBeInstanceOf(GraphError);
  });
});
