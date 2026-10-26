import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Block = 'lint' | 'test' | 'build';

/** Order matters: `ci` stops at the first failing block. */
export const BLOCKS: readonly Block[] = ['lint', 'test', 'build'];

/** pnpm major the lockfile (v9) and the verify job use; corepack's default is newer and refuses unapproved build scripts. */
export const PNPM_VERSION = '9.15.9';

/** Host-only directories kept out of the container at any depth, so it matches a clean checkout. */
export const SOURCE_EXCLUDES: readonly string[] = ['**/node_modules', '**/.nx', '**/dist'];

/** argv that activates the pinned pnpm through corepack. */
export function pnpmSetupCommands(): string[][] {
  return [['corepack', 'enable'], ['corepack', 'prepare', `pnpm@${PNPM_VERSION}`, '--activate']];
}

/** PostgreSQL service the test blocks bind (graph-service integration tests need a database). */
export const POSTGRES_SERVICE = {
  image: 'postgres:16-alpine',
  alias: 'postgres',
  port: 5432,
  env: { POSTGRES_PASSWORD: 'factory-test', POSTGRES_USER: 'postgres', POSTGRES_DB: 'postgres' },
  /** Env set on the workspace container so pg-fixture.ts uses the service instead of local binaries. */
  clientEnv: { TEST_DATABASE_URL: 'postgresql://postgres:factory-test@postgres:5432/postgres' },
} as const;

const BASE_PATTERN = /^[A-Za-z0-9._\/-]+$/;

const WORKSPACE_FILES = ['package.json', 'nx.json', 'pnpm-lock.yaml'] as const;

/** Throws unless `entries` (the top-level names of a source directory) include the factory workspace files. */
export function assertWorkspaceEntries(entries: readonly string[], where: string): void {
  for (const f of WORKSPACE_FILES) {
    if (!entries.includes(f)) throw new Error(`not a factory workspace: ${f} missing in ${where}`);
  }
}

/** Throws unless `dir` looks like a factory workspace (pnpm + Nx). */
export function assertWorkspace(dir: string): void {
  assertWorkspaceEntries(WORKSPACE_FILES.filter((f) => existsSync(join(dir, f))), dir);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { private?: boolean };
  if (typeof pkg !== 'object' || pkg === null) throw new Error('package.json is not an object');
}

/** argv for one block; `base` makes it run on affected projects only. */
export function blockCommand(block: Block, base?: string): string[] {
  if (!BLOCKS.includes(block)) throw new Error(`unknown block: ${block}`);
  if (base === undefined || base === '') return ['pnpm', 'nx', 'run-many', '-t', block];
  if (!BASE_PATTERN.test(base) || base.startsWith('-')) throw new Error(`invalid base ref: ${base}`);
  return ['pnpm', 'nx', 'affected', '-t', block, `--base=${base}`];
}

/** The full pipeline: lint, then test, then build. */
export function ciCommands(base?: string): string[][] {
  return BLOCKS.map((b) => blockCommand(b, base));
}

const FILE_PATTERN = /^[A-Za-z0-9._-]+$/;

function assertFile(name: string): void {
  if (!FILE_PATTERN.test(name) || name.startsWith('-')) throw new Error(`invalid file name: ${name}`);
}

/** Syft argv: SPDX JSON SBOM of one tarball. */
export function sbomCommand(tarball: string): string[] {
  assertFile(tarball);
  return ['syft', `file:${tarball}`, '-o', 'spdx-json'];
}

/** Cosign argv: sign a tarball with the key held in the env var `COSIGN_KEY` (never an argument). */
export function signCommand(tarball: string): string[] {
  assertFile(tarball);
  return ['cosign', 'sign-blob', '--yes', '--key', 'env://COSIGN_KEY', tarball];
}

export type ProductKind = 'angular-remote' | 'nestjs-service';

export interface ImageSpec {
  /** Runtime base image (pinned). */
  base: string;
  /** Where the built output is copied to in the runtime image. */
  dest: string;
  /** Container port. */
  port: number;
  /** Runtime user (non-root). */
  user: string;
  /** Entrypoint argv, empty when the base image serves the content itself. */
  entrypoint: string[];
}

const PRODUCT_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Runtime image per product kind: static nginx-unprivileged for remotes, distroless Node for services. */
export function imageSpec(kind: string): ImageSpec {
  if (kind === 'angular-remote') {
    return { base: 'nginxinc/nginx-unprivileged:1.27-alpine', dest: '/usr/share/nginx/html', port: 8080, user: '101', entrypoint: [] };
  }
  if (kind === 'nestjs-service') {
    return { base: 'gcr.io/distroless/nodejs22-debian12:nonroot', dest: '/app', port: 3000, user: '65532', entrypoint: ['/nodejs/bin/node', '/app/main.js'] };
  }
  throw new Error(`unknown product kind: ${kind}`);
}

/** Build output directory of a product, relative to the workspace root (the recipes' `project.json` `outputs`). */
export function imageOutDir(product: string): string {
  if (!PRODUCT_PATTERN.test(product)) throw new Error(`invalid product name: ${product}`);
  return `dist/products/${product}`;
}

/** Packages a built NestJS service requires at runtime (everything its `main.js` and the recipe templates import). */
export const SERVICE_RUNTIME_DEPENDENCIES: readonly string[] = [
  '@nestjs/common',
  '@nestjs/core',
  '@nestjs/platform-express',
  '@opentelemetry/api',
  '@opentelemetry/exporter-trace-otlp-http',
  '@opentelemetry/sdk-node',
  'class-transformer',
  'class-validator',
  'reflect-metadata',
  'rxjs',
];

/** Node image used only to install production dependencies (the distroless runtime has no npm). */
export const DEPS_IMAGE = 'node:22-slim';

/** package.json text for the runtime install: versions come from the workspace root so the image matches what was tested. */
export function runtimePackageJson(root: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }, names: readonly string[] = SERVICE_RUNTIME_DEPENDENCIES): string {
  const known = { ...root.devDependencies, ...root.dependencies };
  const dependencies: Record<string, string> = {};
  for (const name of [...names].sort()) {
    const range = known[name];
    if (range === undefined) throw new Error(`runtime dependency ${name} is not declared in the root package.json`);
    dependencies[name] = range;
  }
  return `${JSON.stringify({ name: 'runtime-deps', private: true, dependencies }, null, 2)}\n`;
}

/** argv that installs production dependencies without running install scripts. */
export function runtimeInstallCommand(): string[] {
  return ['npm', 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
}

/** Paths that must exist in the final image for the product to start and pass its probe. */
export function imageRequiredPaths(kind: string): string[] {
  const spec = imageSpec(kind);
  if (kind === 'nestjs-service') {
    return [`${spec.dest}/main.js`, ...SERVICE_RUNTIME_DEPENDENCIES.map((d) => `${spec.dest}/node_modules/${d}/package.json`)];
  }
  return [`${spec.dest}/index.html`];
}

/** Source of the page nginx serves at `/` for a remote, relative to the workspace root. */
export function remoteIndexHtml(product: string): string {
  if (!PRODUCT_PATTERN.test(product)) throw new Error(`invalid product name: ${product}`);
  return `products/${product}/src/index.html`;
}

/** argv that builds one product with Nx. */
export function productBuildCommand(product: string): string[] {
  if (!PRODUCT_PATTERN.test(product)) throw new Error(`invalid product name: ${product}`);
  return ['pnpm', 'nx', 'build', product];
}

/** Cosign argv: sign an image by digest reference with the key in `COSIGN_KEY`. */
export function signImageCommand(ref: string): string[] {
  if (!/^[A-Za-z0-9._:\/-]+@sha256:[0-9a-f]{64}$/.test(ref)) throw new Error(`image reference must be pinned by digest: ${ref}`);
  return ['cosign', 'sign', '--yes', '--key', 'env://COSIGN_KEY', ref];
}

const TRIVY_TARGET = /^[A-Za-z0-9._:\/@-]+$/;

/** Trivy argv: JSON findings for an SBOM file or an image reference (never an option-looking target). */
export function scanCommand(kind: 'sbom' | 'image', target: string): string[] {
  if (!TRIVY_TARGET.test(target) || target.startsWith('-')) throw new Error(`invalid scan target: ${target}`);
  if (kind !== 'sbom' && kind !== 'image') throw new Error(`unknown scan kind: ${kind}`);
  return ['trivy', kind, '--format', 'json', '--quiet', target];
}
