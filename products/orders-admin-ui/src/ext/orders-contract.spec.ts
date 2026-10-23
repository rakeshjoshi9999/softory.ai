import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * Contract test against orders-service: this product must consume the same orders-api contract
 * version that orders-service serves, within the range its product.yaml declares.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const lock = (product: string) => JSON.parse(read(`../../../${product}/product.lock.json`)) as { packages: Record<string, string> };
const pkg = '@factory/orders-api-angular';

describe('orders-api contract with orders-service', () => {
  const manifest = parse(read('../../product.yaml')) as { spec: { consumes: Record<string, string> } };
  const mine = lock('orders-admin-ui').packages[pkg];
  const served = lock('orders-service').packages['@factory/orders-api-nest'];

  it('pins a version inside the declared range', () => {
    expect(manifest.spec.consumes['api']).toBe('orders-api@^1');
    expect(mine).toBeDefined();
    expect(semver.satisfies(mine as string, '^1')).toBe(true);
  });

  it('consumes the version orders-service serves', () => {
    expect(mine).toBe(served);
  });
});
