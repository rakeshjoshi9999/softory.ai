import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Block = 'lint' | 'test' | 'build';

/** Order matters: `ci` stops at the first failing block. */
export const BLOCKS: readonly Block[] = ['lint', 'test', 'build'];

const BASE_PATTERN = /^[A-Za-z0-9._\/-]+$/;

/** Throws unless `dir` looks like a factory workspace (pnpm + Nx). */
export function assertWorkspace(dir: string): void {
  for (const f of ['package.json', 'nx.json', 'pnpm-lock.yaml']) {
    if (!existsSync(join(dir, f))) throw new Error(`not a factory workspace: ${f} missing in ${dir}`);
  }
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
  /** Build output directory inside the workspace, relative to the product root. */
  outDir: string;
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
    return { base: 'nginxinc/nginx-unprivileged:1.27-alpine', dest: '/usr/share/nginx/html', outDir: 'dist', port: 8080, user: '101', entrypoint: [] };
  }
  if (kind === 'nestjs-service') {
    return { base: 'gcr.io/distroless/nodejs22-debian12:nonroot', dest: '/app', outDir: 'dist', port: 3000, user: 'nonroot', entrypoint: ['/nodejs/bin/node', '/app/main.js'] };
  }
  throw new Error(`unknown product kind: ${kind}`);
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
