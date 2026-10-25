import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GraphError, graphClient } from './graph-client.js';

export { DEFAULT_GRAPH_URL } from './graph-client.js';

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
  const build = opts.build ?? gitBuild();
  const graph = graphClient(opts.url);
  const synced: SyncResult['synced'] = [];
  for (const { product, packages } of readLockfiles(opts.root)) {
    try {
      synced.push(await graph.ingestLockfile({ product, build, packages }));
    } catch (e) {
      throw e instanceof GraphError ? new Error(`${product}: ${e.message}`) : e;
    }
  }
  return { synced };
}
