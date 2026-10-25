import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import { parse } from 'yaml';
import { assemble, parseRef, readManifest } from './assemble.js';
import { GraphError, graphClient } from './graph-client.js';
import { readLockfiles } from './graph.js';
import { DEFAULT_REGISTRY, packagesFor, release } from './release.js';

export type Change = 'patch' | 'minor' | 'breaking';

export interface ProductImpact {
  product: string;
  /** Where the consumer was found. */
  via: 'graph' | 'lockfile';
  /** Range in product.yaml accepts the version this change would release. */
  rangeAccepts: boolean;
  assemble: { ok: boolean; detail: string };
  tests: { ok: boolean; detail: string };
}

export interface ImpactReport {
  material: string;
  current: string;
  next: string;
  change: Change;
  /** oasdiff messages behind the classification. */
  findings: string[];
  products: ProductImpact[];
  /** `run` when the dry-run assembly resolved packages from a registry, `skipped` when none was reachable. */
  dryRun: 'run' | 'skipped';
  ok: boolean;
}

/** Everything that touches the outside world, injectable for tests. */
export interface ImpactDeps {
  /** Runs oasdiff with the given args and returns stdout (JSON). */
  oasdiff(args: string[]): string;
  /** Product names consuming `material`, or null when the graph is unreachable. */
  graphConsumers(material: string, version: string): Promise<string[] | null>;
  /** True when the registry answers; the dry-run assembly is skipped otherwise. */
  registryReachable(): Promise<boolean>;
  /** Publishes the proposed version of `material` (from `generated/`) so consumers can resolve it. */
  seedRegistry?(material: string, version: string): void;
  dryAssemble(manifest: string): Promise<{ ok: boolean; detail: string }>;
  runTests(product: string): { ok: boolean; detail: string };
}

interface OasdiffEntry {
  level: number;
  text: string;
}

const parseEntries = (out: string): OasdiffEntry[] => {
  const json = out.slice(out.indexOf('['));
  return (JSON.parse(json || '[]') as OasdiffEntry[]) ?? [];
};

/** patch = no API change, minor = non-breaking API change, breaking = oasdiff reports an error-level change. */
export function classify(deps: Pick<ImpactDeps, 'oasdiff'>, released: string, generated: string): { change: Change; findings: string[] } {
  const breaking = parseEntries(deps.oasdiff(['breaking', released, generated, '--format', 'json'])).filter((e) => e.level >= 3);
  if (breaking.length) return { change: 'breaking', findings: breaking.map((e) => e.text) };
  const all = parseEntries(deps.oasdiff(['changelog', released, generated, '--format', 'json']));
  return all.length ? { change: 'minor', findings: all.map((e) => e.text) } : { change: 'patch', findings: [] };
}

const bump = (version: string, change: Change) => semver.inc(version, change === 'breaking' ? 'major' : change)!;

export const realDeps = (root: string): ImpactDeps => ({
  oasdiff: (args) => {
    try {
      return execFileSync(join(root, 'tools/oasdiff/oasdiff.sh'), args, { encoding: 'utf8', cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      const out = (e as { stdout?: string }).stdout;
      if (out?.includes('[')) return out;
      throw e;
    }
  },
  async graphConsumers(material, version) {
    try {
      return [...new Set((await graphClient().listConsumers(material, version)).map((c) => c.product))];
    } catch (e) {
      return e instanceof GraphError && e.status === 404 ? [] : null;
    }
  },
  async registryReachable() {
    const registry = process.env['FACTORY_REGISTRY'] ?? DEFAULT_REGISTRY;
    try {
      return (await fetch(`${registry.replace(/\/?$/, '/')}-/ping`)).ok;
    } catch {
      return false;
    }
  },
  seedRegistry(material, version) {
    for (const pkg of packagesFor(material, root)) {
      const file = join(pkg.dir, 'package.json');
      const json = JSON.parse(readFileSync(file, 'utf8')) as { version: string };
      json.version = version;
      writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    }
    release(material, { root });
  },
  async dryAssemble(manifest) {
    try {
      const r = await assemble(manifest, { root, dryRun: true });
      return { ok: true, detail: `would write ${r.written.length} file(s), ${r.unchanged} unchanged` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message.split('\n')[0] ?? 'failed' };
    }
  },
  runTests(product) {
    try {
      execFileSync('pnpm', ['nx', 'test', product, '--skip-nx-cache'], { cwd: root, stdio: 'ignore' });
      return { ok: true, detail: 'contract tests passed' };
    } catch {
      return { ok: false, detail: `nx test ${product} failed` };
    }
  },
});

/** Reports what changing `materials/<name>` would do to the products that consume it. */
export async function impact(materialDir: string, opts: { root?: string; deps?: ImpactDeps; seed?: boolean } = {}): Promise<ImpactReport> {
  const root = opts.root ?? '.';
  const deps = opts.deps ?? realDeps(root);
  const dir = join(root, materialDir);
  const meta = (parse(readFileSync(join(dir, 'material.yaml'), 'utf8')) as { metadata: { name: string; version: string } }).metadata;
  const released = join(materialDir, 'released/openapi.yaml');
  const generated = join(materialDir, 'generated/openapi.yaml');
  if (!existsSync(join(root, released)) || !existsSync(join(root, generated))) throw new Error(`${materialDir}: needs released/openapi.yaml and generated/openapi.yaml (run emit-openapi)`);

  const { change, findings } = classify(deps, released, generated);
  const next = bump(meta.version, change);

  // The graph knows who consumes the version in use today; lockfiles are the fallback when it is down.
  const fromGraph = await deps.graphConsumers(meta.name, await currentPin(root, meta.name, meta.version));
  const lock = readLockfiles(root).filter((l) => Object.keys(l.packages).some((p) => p.startsWith(`@factory/${meta.name}-`)));
  const names = fromGraph ?? lock.map((l) => l.product);
  const via: ProductImpact['via'] = fromGraph ? 'graph' : 'lockfile';

  const reachable = await deps.registryReachable();
  if (reachable && opts.seed) deps.seedRegistry?.(meta.name, next);

  const products: ProductImpact[] = [];
  for (const product of [...new Set(names)].sort()) {
    const manifestPath = join(root, 'products', product, 'product.yaml');
    const range = existsSync(manifestPath)
      ? Object.values(readManifest(manifestPath).spec.consumes ?? {}).map(parseRef).find((r) => r.name === meta.name)?.range
      : undefined;
    const rangeAccepts = range ? semver.satisfies(next, semver.validRange(range) ? range : `^${range}`) : false;
    products.push({
      product,
      via,
      rangeAccepts,
      assemble: !existsSync(manifestPath)
        ? { ok: false, detail: 'no product.yaml' }
        : reachable
          ? await deps.dryAssemble(manifestPath)
          : { ok: true, detail: 'skipped, registry unreachable' },
      tests: deps.runTests(product),
    });
  }
  const ok = products.every((p) => p.rangeAccepts && p.assemble.ok && p.tests.ok);
  return { material: meta.name, current: meta.version, next, change, findings, products, dryRun: reachable ? 'run' : 'skipped', ok };
}

/** Version of the material the lockfiles pin today (falls back to the material's own version). */
async function currentPin(root: string, material: string, fallback: string): Promise<string> {
  for (const l of readLockfiles(root)) {
    const v = l.packages[`@factory/${material}-nest`] ?? l.packages[`@factory/${material}-angular`];
    if (v) return v;
  }
  return fallback;
}

const mark = (ok: boolean) => (ok ? 'pass' : 'FAIL');

export function renderMarkdown(r: ImpactReport): string {
  const lines = [
    `### Impact of \`${r.material}\`: **${r.change}** (${r.current} -> ${r.next})`,
    '',
    ...(r.findings.length ? r.findings.map((f) => `- ${f}`) : ['No API changes.']),
    '',
  ];
  if (!r.products.length) lines.push('No consuming products found.');
  else {
    lines.push('| Product | Range accepts next | Dry-run assembly | Contract tests |', '| --- | --- | --- | --- |');
    for (const p of r.products) lines.push(`| ${p.product} | ${mark(p.rangeAccepts)} | ${mark(p.assemble.ok)} (${p.assemble.detail}) | ${mark(p.tests.ok)} (${p.tests.detail}) |`);
  }
  lines.push('', r.dryRun === 'run' ? 'Dry-run assembly: run against the registry.' : 'Dry-run assembly: **skipped** (registry unreachable).');
  lines.push('', r.ok ? 'Result: no consumer breaks.' : 'Result: **at least one consumer breaks.**');
  return `${lines.join('\n')}\n`;
}
