import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { SERVICE_RUNTIME_DEPENDENCIES, imageOutDir, imageRequiredPaths, imageSpec, productBuildCommand, remoteIndexHtml, runtimeInstallCommand, runtimePackageJson, signImageCommand } from '../src/plan.js';

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
    expect(imageSpec('nestjs-service').user).toBe('65532');
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

  it('sets a numeric runAsUser matching the image user, overridable by values', () => {
    expect(lib).toMatch(/runAsUser: \{\{ default \.uid \.ctx\.Values\.runAsUser \}\}/);
    expect(read('deploy/charts/factory-lib/templates/_service.tpl')).toContain('"uid" 65532');
    expect(read('deploy/charts/factory-lib/templates/_static-site.tpl')).toContain('"uid" 101');
    expect(imageSpec('nestjs-service').user).toMatch(/^\d+$/);
    expect(imageSpec('angular-remote').user).toMatch(/^\d+$/);
    expect(65532).toBe(Number(imageSpec('nestjs-service').user));
    expect(101).toBe(Number(imageSpec('angular-remote').user));
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

describe('image contents', () => {
  const rootPkg = JSON.parse(read('package.json'));

  it('pins every service runtime dependency from the root package.json and rejects unknown ones', () => {
    const pkg = JSON.parse(runtimePackageJson(rootPkg));
    expect(Object.keys(pkg.dependencies).sort()).toEqual([...SERVICE_RUNTIME_DEPENDENCIES].sort());
    expect(pkg.dependencies['@nestjs/core']).toBe(rootPkg.dependencies?.['@nestjs/core'] ?? rootPkg.devDependencies['@nestjs/core']);
    expect(() => runtimePackageJson(rootPkg, ['left-pad-nope'])).toThrow(/not declared/);
  });

  it('installs production dependencies without running scripts', () => {
    expect(runtimeInstallCommand()).toEqual(expect.arrayContaining(['--omit=dev', '--ignore-scripts']));
  });

  it('covers every package the built service imports', () => {
    const files = [
      'products/orders-service/src/main.ts',
      'products/orders-service/src/app.module.ts',
      'products/orders-service/src/telemetry.ts',
      'products/orders-service/src/health/health.controller.ts',
      'products/orders-service/src/config/config.ts',
    ];
    const imported = new Set<string>();
    for (const f of files) {
      for (const m of read(f).matchAll(/(?:from|import)\s+'([^.'][^']*)'/g)) {
        const parts = m[1].split('/');
        imported.add(m[1].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
      }
    }
    expect(imported.size).toBeGreaterThan(0);
    for (const name of imported) {
      if (name.startsWith('node:')) continue;
      expect(SERVICE_RUNTIME_DEPENDENCIES, name).toContain(name);
    }
  });

  it('requires main.js and its dependencies in the service image, index.html in the remote image', () => {
    const paths = imageRequiredPaths('nestjs-service');
    expect(paths).toContain('/app/main.js');
    expect(paths).toContain('/app/node_modules/@nestjs/common/package.json');
    expect(imageRequiredPaths('angular-remote')).toEqual(['/usr/share/nginx/html/index.html']);
  });

  it('the entrypoint is one of the required paths and the remote page exists in the sources', () => {
    expect(imageRequiredPaths('nestjs-service')).toContain(imageSpec('nestjs-service').entrypoint[1]);
    expect(existsSync(join(root, remoteIndexHtml('orders-ui')))).toBe(true);
    expect(() => remoteIndexHtml('../x')).toThrow(/invalid product name/);
  });
});
