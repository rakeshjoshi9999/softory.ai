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
