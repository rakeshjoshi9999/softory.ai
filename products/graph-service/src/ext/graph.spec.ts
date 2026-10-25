import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IngestController, VersionsController } from './graph.controller';
import { GraphStore } from './graph.store';
import { startTestDatabase, TestDatabase } from './testing/pg-fixture';

const provenance = (material: string, version: string, pkg = `factory-${material}-nest`) => ({
  _type: 'https://in-toto.io/Statement/v1',
  subject: [{ name: `${pkg}-${version}.tgz`, digest: { sha256: 'ab'.repeat(32) } }],
  predicateType: 'https://slsa.dev/provenance/v1',
  predicate: {
    buildDefinition: {
      buildType: 'x',
      externalParameters: { material: { name: material, version } },
      resolvedDependencies: [
        { name: 'source', digest: { gitCommit: 'c0ffee' } },
        { name: 'emitter:nest-server', digest: { version: '0.0.0' }, annotations: { id: 'nest-server', version: '0.0.0' } },
      ],
    },
    runDetails: { builder: { id: 'b' }, metadata: { finishedOn: '2026-10-23T00:00:00Z' } },
  },
});

describe('graph-service (PostgreSQL)', () => {
  let db: TestDatabase;
  let pool: Pool;
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    db = startTestDatabase();
    pool = new Pool({ connectionString: db.url });
    const store = new GraphStore(pool);
    await store.migrate();
    const mod = await Test.createTestingModule({ controllers: [IngestController, VersionsController], providers: [{ provide: GraphStore, useValue: store }] }).compile();
    app = mod.createNestApplication();
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    db?.stop();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE edges, nodes RESTART IDENTITY CASCADE');
  });

  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('migrations create the node and edge tables and reject unknown kinds', async () => {
    await expect(pool.query("INSERT INTO nodes (kind, key) VALUES ('Bogus', 'x')")).rejects.toThrow(/check constraint/);
    const { rows } = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1");
    expect(rows.map((r) => r.table_name)).toEqual(['edges', 'nodes']);
  });

  it('ingests provenance into Material, MaterialVersion and Package nodes with edges', async () => {
    const res = await post('/ingest/provenance', provenance('orders-api', '1.0.1'));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ package: '@factory/orders-api-nest@1.0.1', material: 'orders-api', version: '1.0.1' });
    const nodes = await pool.query('SELECT kind, key FROM nodes ORDER BY kind, key');
    expect(nodes.rows).toEqual([
      { kind: 'Material', key: 'orders-api' },
      { kind: 'MaterialVersion', key: 'orders-api@1.0.1' },
      { kind: 'Package', key: '@factory/orders-api-nest@1.0.1' },
    ]);
    const edges = await pool.query('SELECT a.key AS f, e.kind, b.key AS t FROM edges e JOIN nodes a ON a.id = e.from_id JOIN nodes b ON b.id = e.to_id ORDER BY e.kind');
    expect(edges.rows).toEqual([
      { f: 'orders-api@1.0.1', kind: 'depends_on', t: 'orders-api' },
      { f: '@factory/orders-api-nest@1.0.1', kind: 'emitted_by', t: 'orders-api@1.0.1' },
    ]);
  });

  it('is idempotent and rejects malformed statements', async () => {
    await post('/ingest/provenance', provenance('orders-api', '1.0.1'));
    expect((await post('/ingest/provenance', provenance('orders-api', '1.0.1'))).status).toBe(201);
    expect((await pool.query('SELECT count(*) FROM nodes')).rows[0].count).toBe('3');
    expect((await post('/ingest/provenance', { _type: 'nope' })).status).toBe(400);
    expect((await post('/ingest/provenance', { ...provenance('orders-api', '1.0.1'), subject: [] })).status).toBe(400);
  });

  it('lists every product build consuming a material version', async () => {
    await post('/ingest/provenance', provenance('orders-api', '1.0.1'));
    await post('/ingest/provenance', provenance('orders-api', '1.1.0'));
    expect((await post('/ingest/lockfile', { product: 'orders-service', build: 'b1', packages: { '@factory/orders-api-nest': '1.0.1' } })).status).toBe(201);
    await post('/ingest/lockfile', { product: 'orders-service', build: 'b2', packages: { '@factory/orders-api-nest': '1.1.0' } });
    await post('/ingest/lockfile', { product: 'orders-ui', build: 'b1', packages: { '@factory/orders-api-angular': '1.0.1' } });

    const old = await fetch(`${base}/materials/orders-api/versions/1.0.1/consumers`);
    expect(old.status).toBe(200);
    expect(await old.json()).toEqual([
      { product: 'orders-service', build: 'b1', package: '@factory/orders-api-nest@1.0.1' },
      { product: 'orders-ui', build: 'b1', package: '@factory/orders-api-angular@1.0.1' },
    ]);
    expect(await (await fetch(`${base}/materials/orders-api/versions/1.1.0/consumers`)).json()).toEqual([
      { product: 'orders-service', build: 'b2', package: '@factory/orders-api-nest@1.1.0' },
    ]);
  });

  it('does not mix up materials where one name is a prefix of the other', async () => {
    await post('/ingest/lockfile', { product: 'a', build: 'b1', packages: { '@factory/orders-nest': '1.0.1', '@factory/orders-api-nest': '1.0.1' } });
    await post('/ingest/lockfile', { product: 'c', build: 'b1', packages: { '@factory/orders-api-angular': '1.0.1' } });
    expect(await (await fetch(`${base}/materials/orders/versions/1.0.1/consumers`)).json()).toEqual([
      { product: 'a', build: 'b1', package: '@factory/orders-nest@1.0.1' },
    ]);
    expect(await (await fetch(`${base}/materials/orders-api/versions/1.0.1/consumers`)).json()).toEqual([
      { product: 'a', build: 'b1', package: '@factory/orders-api-nest@1.0.1' },
      { product: 'c', build: 'b1', package: '@factory/orders-api-angular@1.0.1' },
    ]);
  });

  it('returns 404 for an unknown version, [] for a known one nobody uses, 400 for a bad lockfile', async () => {
    expect((await fetch(`${base}/materials/orders-api/versions/9.9.9/consumers`)).status).toBe(404);
    await post('/ingest/provenance', provenance('orders-api', '2.0.0'));
    expect(await (await fetch(`${base}/materials/orders-api/versions/2.0.0/consumers`)).json()).toEqual([]);
    expect((await post('/ingest/lockfile', { product: 'p', build: 'b', packages: { 'left-pad': '1.0.0' } })).status).toBe(400);
    expect((await post('/ingest/lockfile', { product: 'p' })).status).toBe(400);
  });

  it('stores a lifecycle state per version, survives re-ingest, and validates input', async () => {
    const put = (v: string, body: unknown) => fetch(`${base}/materials/orders-api/versions/${v}/state`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await post('/ingest/provenance', provenance('orders-api', '1.0.1'));
    expect(await (await fetch(`${base}/materials/orders-api/versions/1.0.1`)).json()).toEqual({ material: 'orders-api', version: '1.0.1', state: 'released' });
    expect(await (await put('1.0.1', { state: 'recalled', reason: 'wrong totals' })).json()).toEqual({ material: 'orders-api', version: '1.0.1', state: 'recalled', reason: 'wrong totals' });
    await post('/ingest/provenance', provenance('orders-api', '1.0.1'));
    expect((await (await fetch(`${base}/materials/orders-api/versions/1.0.1`)).json()).state).toBe('recalled');
    expect((await put('1.0.1', { state: 'deprecated' })).status).toBe(200);
    expect(await (await fetch(`${base}/materials/orders-api/versions/1.0.1`)).json()).toEqual({ material: 'orders-api', version: '1.0.1', state: 'deprecated' });
    expect((await put('1.0.1', { state: 'recalled' })).status).toBe(400);
    expect((await put('1.0.1', { state: 'bogus' })).status).toBe(400);
    expect((await put('9.9.9', { state: 'draft' })).status).toBe(404);
    expect((await fetch(`${base}/materials/orders-api/versions/9.9.9`)).status).toBe(404);
  });
});
