import { describe, expect, it } from 'vitest';
import { validateDocument } from './validate.js';

const material = `
apiVersion: factory/v1
kind: Material
metadata: { name: orders-api, type: api-contract, owner: team-orders, version: 1.0.0 }
spec:
  source: orders.tsp
  format: typespec
  validators: [spectral]
  emitters: [ts-angular-client@1]
  dependsOn: []
  compatibility: backward
`;
const product = `
apiVersion: factory/v1
kind: Product
metadata: { name: orders-ui, owner: team-orders }
spec:
  recipe: angular-remote@1
  consumes: { api: orders-api@^1 }
  delivery: { pipeline: frontend@1, envs: [preview] }
`;

describe('material.yaml', () => {
  it('accepts a valid material', () => expect(validateDocument(material).ok).toBe(true));
  it('rejects an unknown type', () => {
    const r = validateDocument(material.replace('api-contract', 'banana'));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('/metadata/type');
  });
  it('rejects a missing source', () => {
    expect(validateDocument(material.replace('  source: orders.tsp\n', '')).ok).toBe(false);
  });
  it('rejects a bad compatibility value', () => {
    expect(validateDocument(material.replace('backward', 'sideways')).ok).toBe(false);
  });
});

describe('product.yaml', () => {
  it('accepts a valid product', () => expect(validateDocument(product).ok).toBe(true));
  it('rejects a recipe without a major version', () => {
    expect(validateDocument(product.replace('angular-remote@1', 'angular-remote')).ok).toBe(false);
  });
  it('rejects a missing owner', () => {
    expect(validateDocument(product.replace(', owner: team-orders', '')).ok).toBe(false);
  });
  it('rejects empty envs', () => {
    expect(validateDocument(product.replace('[preview]', '[]')).ok).toBe(false);
  });
});

describe('general', () => {
  it('rejects an unknown kind and bad YAML readably', () => {
    expect(validateDocument('kind: Nope').errors[0]).toContain('"kind" must be');
    expect(validateDocument('a: [').errors[0]).toContain('invalid YAML');
  });
});
