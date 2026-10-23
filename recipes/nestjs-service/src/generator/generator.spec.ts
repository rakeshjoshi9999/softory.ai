import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { afterAll, describe, expect, it } from 'vitest';
import nestjsServiceGenerator, { renderService } from './generator.js';
import { parse } from 'yaml';

const repoRoot = resolve(__dirname, '../../../..');

describe('nestjs-service recipe', () => {
  it('snapshots the generated file tree', async () => {
    const tree = createTreeWithEmptyWorkspace();
    nestjsServiceGenerator(tree, { name: 'orders-service' });
    const files = tree
      .listChanges()
      .map((c) => c.path)
      .filter((p) => p.startsWith('products/orders-service/'))
      .sort();
    expect(files).toMatchInlineSnapshot(`
      [
        "products/orders-service/README.md",
        "products/orders-service/chart/Chart.yaml",
        "products/orders-service/chart/templates/workload.yaml",
        "products/orders-service/chart/values.yaml",
        "products/orders-service/package.json",
        "products/orders-service/project.json",
        "products/orders-service/src/app.module.ts",
        "products/orders-service/src/config/config.spec.ts",
        "products/orders-service/src/config/config.ts",
        "products/orders-service/src/ext/index.ts",
        "products/orders-service/src/health/health.controller.spec.ts",
        "products/orders-service/src/health/health.controller.ts",
        "products/orders-service/src/main.ts",
        "products/orders-service/src/telemetry.ts",
        "products/orders-service/tsconfig.app.json",
        "products/orders-service/tsconfig.json",
      ]
    `);
  });

  it('generates a thin chart pointing at factory-lib', () => {
    const files = renderService({ name: 'billing', directory: 'products/billing' });
    const chart = parse(files['chart/Chart.yaml']!) as { dependencies: { repository: string }[] };
    expect(chart.dependencies[0]!.repository).toBe('file://../../../deploy/charts/factory-lib');
    expect(files['chart/templates/workload.yaml']).toContain('factory-lib.service');
  });

  it('is deterministic', () => {
    expect(renderService({ name: 'a-b' })).toEqual(renderService({ name: 'a-b' }));
  });

  it('rejects names that are not kebab-case', () => {
    expect(() => renderService({ name: 'Bad_Name' })).toThrow(/kebab-case/);
  });

  describe('generated service', () => {
    const dir = mkdtempSync(join(repoRoot, 'products', 'gen-test-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('passes lint, compiles and passes its own tests', () => {
      const rel = `products/${dir.split('/').pop()}`;
      for (const [path, content] of Object.entries(renderService({ name: 'tmp-gen', directory: rel }))) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
      }
      execFileSync('pnpm', ['exec', 'eslint', rel], { cwd: repoRoot, stdio: 'pipe' });
      execFileSync('pnpm', ['exec', 'tsc', '-p', `${rel}/tsconfig.app.json`, '--noEmit'], { cwd: repoRoot, stdio: 'pipe' });
      execFileSync('pnpm', ['exec', 'vitest', 'run', '--root', '.', rel], { cwd: repoRoot, stdio: 'pipe' });
    }, 120_000);
  });
});
