import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { afterAll, describe, expect, it } from 'vitest';
import angularRemoteGenerator, { renderRemote } from './generator.js';
import { parse } from 'yaml';

const repoRoot = resolve(__dirname, '../../../..');

describe('angular-remote recipe', () => {
  it('snapshots the generated file tree', async () => {
    const tree = createTreeWithEmptyWorkspace();
    angularRemoteGenerator(tree, { name: 'orders-ui' });
    const files = tree
      .listChanges()
      .map((c) => c.path)
      .filter((p) => p.startsWith('products/orders-ui/'))
      .sort();
    expect(files).toMatchInlineSnapshot(`
      [
        "products/orders-ui/README.md",
        "products/orders-ui/chart/Chart.yaml",
        "products/orders-ui/chart/templates/workload.yaml",
        "products/orders-ui/chart/values.yaml",
        "products/orders-ui/federation.config.js",
        "products/orders-ui/package.json",
        "products/orders-ui/project.json",
        "products/orders-ui/src/app/app.component.ts",
        "products/orders-ui/src/app/app.config.ts",
        "products/orders-ui/src/app/app.routes.ts",
        "products/orders-ui/src/app/home.component.ts",
        "products/orders-ui/src/app/remote.routes.spec.ts",
        "products/orders-ui/src/app/remote.routes.ts",
        "products/orders-ui/src/bootstrap.ts",
        "products/orders-ui/src/ext/index.ts",
        "products/orders-ui/src/index.html",
        "products/orders-ui/src/main.ts",
        "products/orders-ui/tsconfig.app.json",
        "products/orders-ui/tsconfig.json",
      ]
    `);
  });

  it('exposes the routes through Native Federation', () => {
    const files = renderRemote({ name: 'orders-ui' });
    expect(files['federation.config.js']).toContain("'./routes': './src/app/remote.routes.ts'");
    expect(files['src/main.ts']).toContain('initFederation');
  });

  it('generates a thin chart pointing at factory-lib', () => {
    const files = renderRemote({ name: 'admin', directory: 'products/admin' });
    const chart = parse(files['chart/Chart.yaml']!) as { dependencies: { repository: string }[] };
    expect(chart.dependencies[0]!.repository).toBe('file://../../../deploy/charts/factory-lib');
    expect(files['chart/templates/workload.yaml']).toContain('factory-lib.static-site');
  });

  it('is deterministic', () => {
    expect(renderRemote({ name: 'a-b' })).toEqual(renderRemote({ name: 'a-b' }));
  });

  it('rejects names that are not kebab-case', () => {
    expect(() => renderRemote({ name: 'Bad_Name' })).toThrow(/kebab-case/);
  });

  describe('generated remote', () => {
    const dir = mkdtempSync(join(repoRoot, 'products', 'gen-test-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('passes lint, builds and passes its own tests', () => {
      const rel = `products/${dir.split('/').pop()}`;
      for (const [path, content] of Object.entries(renderRemote({ name: 'tmp-gen', directory: rel }))) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
      }
      execFileSync('pnpm', ['exec', 'eslint', rel], { cwd: repoRoot, stdio: 'pipe' });
      execFileSync('pnpm', ['exec', 'ngc', '-p', `${rel}/tsconfig.app.json`, '--outDir', join(dir, '.out')], { cwd: repoRoot, stdio: 'pipe' });
      execFileSync('pnpm', ['exec', 'vitest', 'run', '--root', '.', rel], { cwd: repoRoot, stdio: 'pipe' });
    }, 180_000);
  });
});
