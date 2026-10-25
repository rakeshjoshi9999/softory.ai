import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { imageOutDir, imageSpec, productBuildCommand, signImageCommand } from '../src/plan.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('image output directory', () => {
  it('matches the build output declared by the committed products and the recipes', () => {
    for (const product of ['orders-service', 'orders-ui']) {
      const project = JSON.parse(read(`products/${product}/project.json`));
      expect(project.targets.build.outputs).toContain(`{workspaceRoot}/${imageOutDir(product)}`);
    }
    for (const recipe of ['nestjs-service', 'angular-remote']) {
      expect(read(`recipes/${recipe}/src/generator/templates.ts`)).toContain('outputs: [`{workspaceRoot}/dist/${v.directory}`]');
    }
    expect(imageOutDir('orders-service')).toBe('dist/products/orders-service');
  });
  it('rejects unsafe product names', () => {
    expect(() => imageOutDir('../x')).toThrow(/invalid product name/);
  });
});

describe('image plan', () => {
  it('uses nginx-unprivileged for remotes and distroless Node for services, both non-root', () => {
    expect(imageSpec('angular-remote')).toMatchObject({ base: expect.stringContaining('nginx-unprivileged'), port: 8080 });
    expect(imageSpec('nestjs-service').base).toContain('distroless/nodejs');
    expect(imageSpec('nestjs-service').user).toBe('nonroot');
    expect(() => imageSpec('php')).toThrow(/unknown product kind/);
  });

  it('validates product names and signs only digest-pinned references', () => {
    expect(productBuildCommand('orders-ui')).toEqual(['pnpm', 'nx', 'build', 'orders-ui']);
    expect(() => productBuildCommand('x; rm -rf /')).toThrow(/invalid product/);
    const digest = 'a'.repeat(64);
    expect(signImageCommand(`reg.local/orders-ui@sha256:${digest}`)).toContain('env://COSIGN_KEY');
    expect(() => signImageCommand('reg.local/orders-ui:latest')).toThrow(/digest/);
  });
});

describe('Helm charts', () => {
  const lib = read('deploy/charts/factory-lib/templates/_helpers.tpl');

  it('factory-lib is a library chart with service and static-site templates', () => {
    expect(parse(read('deploy/charts/factory-lib/Chart.yaml'))).toMatchObject({ name: 'factory-lib', type: 'library' });
    expect(read('deploy/charts/factory-lib/templates/_service.tpl')).toContain('define "factory-lib.service"');
    expect(read('deploy/charts/factory-lib/templates/_static-site.tpl')).toContain('define "factory-lib.static-site"');
  });

  it('the shared workload sets probes, resources and a restricted security context', () => {
    for (const needle of ['livenessProbe', 'readinessProbe', 'resources:', 'runAsNonRoot: true', 'readOnlyRootFilesystem: true', 'allowPrivilegeEscalation: false', 'drop: ["ALL"]']) {
      expect(lib).toContain(needle);
    }
  });

  it.each([
    ['nestjs-service', 'factory-lib.service'],
    ['angular-remote', 'factory-lib.static-site'],
  ])('thin chart %s depends on factory-lib and includes %s', (kind, tpl) => {
    const chart = parse(read(`deploy/charts/${kind}/Chart.yaml`)) as { dependencies: { name: string; repository: string }[] };
    expect(chart.dependencies).toEqual([expect.objectContaining({ name: 'factory-lib', repository: 'file://../factory-lib' })]);
    expect(read(`deploy/charts/${kind}/templates/workload.yaml`)).toContain(tpl);
    expect(parse(read(`deploy/charts/${kind}/values.yaml`))).toHaveProperty('resources.limits');
  });
});

describe('product charts', () => {
  const products = readdirSync(join(root, 'products')).filter((d) => existsSync(join(root, 'products', d, 'product.yaml')));

  it('finds the assembled products', () => {
    expect(products).toEqual(expect.arrayContaining(['graph-service', 'orders-service', 'orders-ui']));
  });

  it.each(products)('%s has a recipe-generated chart that depends on factory-lib', (name) => {
    const chart = parse(read(`products/${name}/chart/Chart.yaml`)) as { name: string; dependencies: { name: string; repository: string }[] };
    expect(chart.name).toBe(name);
    expect(chart.dependencies).toEqual([expect.objectContaining({ name: 'factory-lib', repository: 'file://../../../deploy/charts/factory-lib' })]);
    expect(read(`products/${name}/chart/templates/workload.yaml`)).toContain('factory-lib.');
  });
});
