import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const config = JSON.parse(readFileSync(join(root, 'renovate.json'), 'utf8'));
const manager = config.customManagers[0];
const matcher = new RegExp(manager.matchStrings[0], 'g');

describe('renovate.json', () => {
  it('detects every @factory/* pin in every product lockfile', () => {
    const products = readdirSync(join(root, 'products')).filter((p) =>
      existsSync(join(root, 'products', p, 'product.lock.json')),
    );
    expect(products.length).toBeGreaterThanOrEqual(4);
    for (const p of products) {
      const text = readFileSync(join(root, 'products', p, 'product.lock.json'), 'utf8');
      const expected = Object.keys(JSON.parse(text).packages).filter((n) => n.startsWith('@factory/'));
      const found = [...text.matchAll(matcher)].map((m) => m.groups?.depName);
      expect(found.sort(), p).toEqual(expected.sort());
    }
  });

  it('looks packages up in the Verdaccio registry', () => {
    expect(manager.datasourceTemplate).toBe('npm');
    expect(manager.registryUrlTemplate).toBe('http://localhost:4873/');
  });

  it('groups @factory/* and auto-merges only patch updates', () => {
    const rules = config.packageRules.filter((r: { matchPackageNames?: string[] }) =>
      r.matchPackageNames?.includes('@factory/*'),
    );
    expect(rules.find((r: { groupName?: string }) => r.groupName)).toBeTruthy();
    const auto = rules.find((r: { automerge?: boolean }) => r.automerge);
    expect(auto.matchUpdateTypes).toEqual(['patch']);
    expect(rules.filter((r: { automerge?: boolean }) => r.automerge)).toHaveLength(1);
  });
});
