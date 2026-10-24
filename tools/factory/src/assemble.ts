import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';
import { parse } from 'yaml';
import { RECALL_PREFIX } from './recall.js';
import { DEFAULT_REGISTRY } from './release.js';
import { validateFile } from './validate.js';

export interface ProductManifest {
  metadata: { name: string; owner: string };
  spec: { recipe: string; consumes?: Record<string, string> };
}

/** Package suffix each recipe consumes from a material's published packages. */
const RECIPE_PACKAGE: Record<string, string> = { 'angular-remote': 'angular', 'nestjs-service': 'nest' };

export interface Resolved {
  alias: string;
  name: string;
  version: string;
  tarball: string;
  integrity?: string;
  shasum?: string;
}

export function readManifest(file: string): ProductManifest {
  const result = validateFile(file);
  if (!result.ok || result.kind !== 'Product') {
    throw new Error(`${file}: not a valid Product${result.errors.length ? `\n  - ${result.errors.join('\n  - ')}` : ''}`);
  }
  return parse(readFileSync(file, 'utf8')) as ProductManifest;
}

export function parseRef(ref: string): { name: string; range: string } {
  const at = ref.indexOf('@');
  return { name: ref.slice(0, at), range: ref.slice(at + 1) };
}

function registryUrl(registry: string, pkg: string): string {
  return `${registry.replace(/\/?$/, '/')}${pkg.replace('/', '%2f')}`;
}

/** Picks the highest published version of `pkg` satisfying `range`. */
export async function resolvePackage(registry: string, pkg: string, range: string): Promise<Omit<Resolved, 'alias'>> {
  const res = await fetch(registryUrl(registry, pkg));
  if (!res.ok) throw new Error(`${pkg}: registry answered ${res.status} (is ${registry} running and released?)`);
  const doc = (await res.json()) as { versions?: Record<string, { deprecated?: string; dist: { tarball: string; integrity?: string; shasum?: string } }> };
  const versions = Object.keys(doc.versions ?? {});
  const version = semver.maxSatisfying(versions, semver.validRange(range) ? range : `^${range}`);
  const entry = version ? doc.versions?.[version] : undefined;
  if (!version || !entry) throw new Error(`${pkg}: no published version satisfies "${range}" (have: ${versions.join(', ') || 'none'})`);
  if (entry.deprecated?.startsWith(RECALL_PREFIX)) throw new Error(`${pkg}@${version} was recalled: ${entry.deprecated.slice(RECALL_PREFIX.length)}. Release a fixed version and update the consumes range.`);
  const { tarball, integrity, shasum } = entry.dist;
  if (new URL(tarball, registry).origin !== new URL(registry).origin) throw new Error(`${pkg}@${version}: tarball ${tarball} is not on the registry origin ${new URL(registry).origin}`);
  if (!integrity?.startsWith('sha512-') && !shasum) throw new Error(`${pkg}@${version}: registry metadata has no sha512 integrity or shasum; refusing to install an unverifiable package`);
  return { name: pkg, version, tarball, integrity, shasum };
}

export async function resolveConsumes(manifest: ProductManifest, registry: string): Promise<Resolved[]> {
  const kind = parseRef(manifest.spec.recipe).name;
  const suffix = RECIPE_PACKAGE[kind];
  if (!suffix) throw new Error(`unknown recipe "${kind}": supported are ${Object.keys(RECIPE_PACKAGE).join(', ')}`);
  const out: Resolved[] = [];
  for (const [alias, ref] of Object.entries(manifest.spec.consumes ?? {})) {
    const { name, range } = parseRef(ref);
    out.push({ alias, ...(await resolvePackage(registry, `@factory/${name}-${suffix}`, range)) });
  }
  return out;
}

/** Lists the tarball and rejects links, absolute paths and `..` segments before anything is extracted. */
export function assertSafeTarball(file: string, label: string): void {
  const names = execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const name of names) {
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split(/[\\/]/).includes('..')) throw new Error(`${label}: unsafe path "${name}" in tarball`);
  }
  const verbose = execFileSync('tar', ['-tvzf', file], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const line of verbose) {
    if (line[0] === 'l' || line[0] === 'h' || / link to /.test(line)) throw new Error(`${label}: tarball contains a link: ${line}`);
  }
}

/** Downloads, verifies and unpacks a package into <productDir>/node_modules/<name>. */
export async function install(productDir: string, pkg: Resolved): Promise<void> {
  const res = await fetch(pkg.tarball);
  if (!res.ok) throw new Error(`${pkg.name}@${pkg.version}: tarball download answered ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (pkg.integrity?.startsWith('sha512-')) {
    const actual = `sha512-${createHash('sha512').update(data).digest('base64')}`;
    if (actual !== pkg.integrity) throw new Error(`${pkg.name}@${pkg.version}: integrity check failed`);
  } else if (pkg.shasum) {
    if (createHash('sha1').update(data).digest('hex') !== pkg.shasum) throw new Error(`${pkg.name}@${pkg.version}: integrity check failed (shasum)`);
  } else {
    throw new Error(`${pkg.name}@${pkg.version}: no integrity to verify against`);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'factory-assemble-'));
  try {
    const file = join(tmp, 'pkg.tgz');
    writeFileSync(file, data);
    const target = join(productDir, 'node_modules', pkg.name);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    assertSafeTarball(file, `${pkg.name}@${pkg.version}`);
    execFileSync('tar', ['-xzf', file, '-C', target, '--strip-components=1', '--no-same-owner']);
    if (!existsSync(join(target, 'src', 'index.ts'))) throw new Error(`${pkg.name}@${pkg.version}: package has no src/index.ts`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

interface WriteTree {
  write(path: string, content: string): void;
}

/** Runs the recipe's Nx generator against a file collector instead of an Nx Tree. */
async function runRecipe(root: string, kind: string, name: string): Promise<Map<string, string>> {
  const entry = join(root, 'recipes', kind, 'src', 'generator', 'generator.ts');
  if (!existsSync(entry)) throw new Error(`recipe "${kind}" not found at ${entry}`);
  const mod = (await import(pathToFileURL(resolve(entry)).href)) as { default: (tree: WriteTree, o: { name: string }) => void };
  const files = new Map<string, string>();
  mod.default({ write: (p, c) => files.set(p, c) }, { name });
  return files;
}

const isHandWritten = (rel: string) => rel.includes('/src/ext/');

export interface AssembleResult {
  product: string;
  written: string[];
  unchanged: number;
  installed: string[];
}

export async function assemble(manifestPath: string, opts: { root?: string; registry?: string; dryRun?: boolean } = {}): Promise<AssembleResult> {
  const root = opts.root ?? '.';
  const registry = opts.registry ?? process.env['FACTORY_REGISTRY'] ?? DEFAULT_REGISTRY;
  const manifest = readManifest(manifestPath);
  const name = manifest.metadata.name;
  const productDir = dirname(resolve(manifestPath));
  const relDir = productDir.slice(resolve(root).length + 1);
  if (relDir !== `products/${name}`) throw new Error(`product.yaml must live in products/${name}/ (found ${relDir})`);

  const resolved = await resolveConsumes(manifest, registry);
  const files = await runRecipe(root, parseRef(manifest.spec.recipe).name, name);

  const written: string[] = [];
  let unchanged = 0;
  for (const [path, content] of files) {
    const rel = path.slice(relDir.length + 1);
    const abs = resolve(root, path);
    if (opts.dryRun) {
      if (existsSync(abs) && (isHandWritten(path) || readFileSync(abs, 'utf8') === content)) unchanged++;
      else written.push(rel);
      continue;
    }
    if (existsSync(abs) && (isHandWritten(path) || readFileSync(abs, 'utf8') === content)) {
      unchanged++;
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    written.push(rel);
  }

  const lock = `${JSON.stringify({ registry, packages: Object.fromEntries(resolved.map((r) => [r.name, r.version])) }, null, 2)}\n`;
  const lockPath = join(productDir, 'product.lock.json');
  if (opts.dryRun) {
    if (!existsSync(lockPath) || readFileSync(lockPath, 'utf8') !== lock) written.push('product.lock.json');
    return { product: name, written, unchanged, installed: resolved.map((r) => `${r.name}@${r.version}`) };
  }
  if (!existsSync(lockPath) || readFileSync(lockPath, 'utf8') !== lock) {
    writeFileSync(lockPath, lock);
    written.push('product.lock.json');
  }

  for (const pkg of resolved) await install(productDir, pkg);
  return { product: name, written, unchanged, installed: resolved.map((r) => `${r.name}@${r.version}`) };
}
