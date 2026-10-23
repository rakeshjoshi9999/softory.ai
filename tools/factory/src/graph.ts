import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_GRAPH_URL = 'http://localhost:3000';

export interface SyncResult {
  synced: { product: string; build: string; consumed: string[] }[];
}

/** Products that have a product.lock.json, as `{ product, packages }`. */
export function readLockfiles(root = '.'): { product: string; packages: Record<string, string> }[] {
  const dir = join(root, 'products');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, 'product.lock.json')))
    .sort()
    .map((product) => {
      const lock = JSON.parse(readFileSync(join(dir, product, 'product.lock.json'), 'utf8')) as { packages?: Record<string, string> };
      return { product, packages: lock.packages ?? {} };
    });
}

const gitBuild = () => execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();

/** Posts every product lockfile to the graph service's `POST /ingest/lockfile`. Idempotent per build id. */
export async function graphSync(opts: { root?: string; url?: string; build?: string } = {}): Promise<SyncResult> {
  const url = (opts.url ?? process.env['FACTORY_GRAPH_URL'] ?? DEFAULT_GRAPH_URL).replace(/\/$/, '');
  const build = opts.build ?? gitBuild();
  const synced: SyncResult['synced'] = [];
  for (const { product, packages } of readLockfiles(opts.root)) {
    const res = await fetch(`${url}/ingest/lockfile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ product, build, packages }),
    });
    if (!res.ok) throw new Error(`${product}: graph service answered ${res.status} ${await res.text()}`);
    synced.push((await res.json()) as SyncResult['synced'][number]);
  }
  return { synced };
}
