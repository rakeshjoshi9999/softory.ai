import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { graphSync, readLockfiles } from './graph.js';

let root: string;
let server: Server;
let url: string;
let status = 201;
const received: { path?: string; body: Record<string, unknown> }[] = [];

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'graph-sync-'));
  for (const [name, pkgs] of [['b-ui', { '@factory/orders-api-angular': '1.0.1' }], ['a-svc', { '@factory/orders-api-nest': '1.0.1' }]] as const) {
    mkdirSync(join(root, 'products', name), { recursive: true });
    writeFileSync(join(root, 'products', name, 'product.lock.json'), JSON.stringify({ registry: 'x', packages: pkgs }));
  }
  mkdirSync(join(root, 'products', 'no-lock'), { recursive: true });
  server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const body = JSON.parse(data) as Record<string, unknown>;
      received.push({ path: req.url, body });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ product: body['product'], build: body['build'], consumed: ['orders-api@1.0.1'] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

describe('factory graph sync', () => {
  it('reads only products that have a lockfile, sorted', () => {
    expect(readLockfiles(root).map((l) => l.product)).toEqual(['a-svc', 'b-ui']);
  });

  it('posts each lockfile to /ingest/lockfile with the build id', async () => {
    const r = await graphSync({ root, url, build: 'abc123' });
    expect(r.synced.map((s) => s.product)).toEqual(['a-svc', 'b-ui']);
    expect(received.map((x) => x.path)).toEqual(['/ingest/lockfile', '/ingest/lockfile']);
    expect(received[0]?.body).toEqual({ product: 'a-svc', build: 'abc123', packages: { '@factory/orders-api-nest': '1.0.1' } });
  });

  it('fails loudly when the graph service rejects a lockfile', async () => {
    status = 400;
    await expect(graphSync({ root, url, build: 'x' })).rejects.toThrow(/a-svc: graph service answered 400/);
  });
});
