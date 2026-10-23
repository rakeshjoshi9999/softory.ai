import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

export type NodeKind = 'Material' | 'MaterialVersion' | 'Package' | 'Product' | 'ProductBuild';
export type EdgeKind = 'depends_on' | 'emitted_by' | 'consumed_by';

export class BadRequest extends Error {}

export interface Consumer {
  product: string;
  build: string;
  package: string;
}

const MIGRATIONS = join(__dirname, '../../migrations');

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || v === '') throw new BadRequest(`${what} must be a non-empty string`);
  return v;
};
const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new BadRequest(`${what} must be an object`);
  return v as Record<string, unknown>;
};

/** `factory-orders-api-nest-1.0.1.tgz` -> `@factory/orders-api-nest` */
function packageFromTarball(tarball: string, version: string): string {
  const suffix = `-${version}.tgz`;
  if (!tarball.endsWith(suffix) || !tarball.startsWith('factory-')) throw new BadRequest(`unrecognised package tarball name "${tarball}"`);
  return `@factory/${tarball.slice('factory-'.length, -suffix.length)}`;
}

/** `@factory/orders-api-nest` -> `orders-api` */
function materialFromPackage(pkg: string): string {
  const m = /^@factory\/(.+)-(nest|angular)$/.exec(pkg);
  if (!m) throw new BadRequest(`"${pkg}" is not a factory material package`);
  return m[1]!;
}

export class GraphStore {
  constructor(private readonly pool: Pool) {}

  /** Applies the checked-in SQL migrations in file order. */
  async migrate(dir = MIGRATIONS): Promise<void> {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      await this.pool.query(readFileSync(join(dir, file), 'utf8'));
    }
  }

  private async node(db: Pool | import('pg').PoolClient, kind: NodeKind, key: string, props: object = {}): Promise<number> {
    const r = await db.query<{ id: string }>(
      `INSERT INTO nodes (kind, key, props) VALUES ($1, $2, $3)
       ON CONFLICT (kind, key) DO UPDATE SET props = nodes.props || EXCLUDED.props RETURNING id`,
      [kind, key, JSON.stringify(props)],
    );
    return Number(r.rows[0]!.id);
  }

  private async edge(db: Pool | import('pg').PoolClient, from: number, to: number, kind: EdgeKind): Promise<void> {
    await db.query('INSERT INTO edges (from_id, to_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [from, to, kind]);
  }

  private async tx<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  /** Records Package -emitted_by-> MaterialVersion -depends_on-> Material from a provenance statement. */
  async ingestProvenance(body: unknown): Promise<{ package: string; material: string; version: string }> {
    const s = obj(body, 'statement');
    if (s['_type'] !== 'https://in-toto.io/Statement/v1') throw new BadRequest('not an in-toto Statement v1');
    if (s['predicateType'] !== 'https://slsa.dev/provenance/v1') throw new BadRequest('not a SLSA provenance v1 predicate');
    const subjects = s['subject'];
    if (!Array.isArray(subjects) || subjects.length === 0) throw new BadRequest('statement has no subjects');
    const first = obj(subjects[0], 'subject[0]');
    const digest = str(obj(first['digest'], 'subject[0].digest')['sha256'], 'subject[0].digest.sha256');
    const def = obj(obj(s['predicate'], 'predicate')['buildDefinition'], 'predicate.buildDefinition');
    const material = obj(obj(def['externalParameters'], 'externalParameters')['material'], 'externalParameters.material');
    const name = str(material['name'], 'material.name');
    const version = str(material['version'], 'material.version');
    const pkg = packageFromTarball(str(first['name'], 'subject[0].name'), version);
    const resolved = Array.isArray(def['resolvedDependencies']) ? (def['resolvedDependencies'] as Record<string, unknown>[]) : [];
    const emitters = resolved.filter((r) => typeof r['name'] === 'string' && (r['name'] as string).startsWith('emitter:')).map((r) => r['annotations']);
    const commit = (resolved.find((r) => r['name'] === 'source')?.['digest'] as { gitCommit?: string } | undefined)?.gitCommit;

    await this.tx(async (c) => {
      const m = await this.node(c, 'Material', name);
      const mv = await this.node(c, 'MaterialVersion', `${name}@${version}`, { version, emitters, commit });
      const p = await this.node(c, 'Package', `${pkg}@${version}`, { sha256: digest });
      await this.edge(c, mv, m, 'depends_on');
      await this.edge(c, p, mv, 'emitted_by');
    });
    return { package: `${pkg}@${version}`, material: name, version };
  }

  /** Records MaterialVersion -consumed_by-> ProductBuild (and ProductBuild -depends_on-> Package/Product). */
  async ingestLockfile(body: unknown): Promise<{ product: string; build: string; consumed: string[] }> {
    const b = obj(body, 'body');
    const product = str(b['product'], 'product');
    const build = str(b['build'], 'build');
    const packages = obj(b['packages'], 'packages');
    const entries = Object.entries(packages).map(([pkg, v]) => ({ pkg, version: str(v, `packages["${pkg}"]`), material: materialFromPackage(pkg) }));

    await this.tx(async (c) => {
      const prod = await this.node(c, 'Product', product);
      const pb = await this.node(c, 'ProductBuild', `${product}@${build}`, { build });
      await this.edge(c, pb, prod, 'depends_on');
      for (const e of entries) {
        const mv = await this.node(c, 'MaterialVersion', `${e.material}@${e.version}`, { version: e.version });
        const p = await this.node(c, 'Package', `${e.pkg}@${e.version}`);
        await this.edge(c, mv, pb, 'consumed_by');
        await this.edge(c, pb, p, 'depends_on');
      }
    });
    return { product, build, consumed: entries.map((e) => `${e.material}@${e.version}`) };
  }

  /** Every product build that consumes the material version; null when the version is unknown. */
  async consumers(material: string, version: string): Promise<Consumer[] | null> {
    const known = await this.pool.query('SELECT 1 FROM nodes WHERE kind = $1 AND key = $2', ['MaterialVersion', `${material}@${version}`]);
    if (known.rowCount === 0) return null;
    const r = await this.pool.query<Consumer>(
      `SELECT prod.key AS product, pb.props->>'build' AS build, pkg.key AS package
         FROM nodes mv
         JOIN edges c ON c.from_id = mv.id AND c.kind = 'consumed_by'
         JOIN nodes pb ON pb.id = c.to_id AND pb.kind = 'ProductBuild'
         JOIN edges bp ON bp.from_id = pb.id AND bp.kind = 'depends_on'
         JOIN nodes prod ON prod.id = bp.to_id AND prod.kind = 'Product'
         JOIN edges bk ON bk.from_id = pb.id AND bk.kind = 'depends_on'
         JOIN nodes pkg ON pkg.id = bk.to_id AND pkg.kind = 'Package'
        WHERE mv.kind = 'MaterialVersion' AND mv.key = $1 AND pkg.key LIKE $2
        ORDER BY prod.key, pb.key, pkg.key`,
      [`${material}@${version}`, `@factory/${material.replace(/[\\%_]/g, '\\$&')}-%@${version.replace(/[\\%_]/g, '\\$&')}`],
    );
    return r.rows;
  }
}
