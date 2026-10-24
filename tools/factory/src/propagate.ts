import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import { assemble, parseRef, readManifest } from './assemble.js';
import { readLockfiles } from './graph.js';

export interface PropagateOptions {
  root?: string;
  /** `owner/repo` that receives the upgrade PRs. */
  repo?: string;
  token?: string;
  /** Plan everything (assembly in dry-run mode) but change no file, branch, PR or label. */
  dryRun?: boolean;
  base?: string;
  fetchImpl?: typeof fetch;
  deps?: PropagateDeps;
}

/** Everything that touches git, the registry or the product's tests, injectable for tests. */
export interface PropagateDeps {
  assemble(manifest: string, dryRun: boolean): Promise<void>;
  runTests(product: string): boolean;
  /** Creates `branch` from `origin/<base>` with the product's changes committed and pushed, then returns to the starting branch with a clean product tree. */
  pushBranch(branch: string, product: string, message: string, base: string): void;
  /** Discards the product's uncommitted changes (after a failed assembly, test or push). */
  reset(product: string): void;
}

export interface ProductOutcome {
  product: string;
  from: string;
  to: string;
  status: 'opened' | 'exists' | 'skipped' | 'failed' | 'planned';
  detail: string;
  labels: string[];
}

export interface PropagateResult {
  material: string;
  version: string;
  products: ProductOutcome[];
}

const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });

export const realPropagateDeps = (root: string): PropagateDeps => ({
  async assemble(manifest, dryRun) {
    await assemble(manifest, { root, dryRun });
  },
  runTests(product) {
    try {
      execFileSync('pnpm', ['nx', 'test', product, '--skip-nx-cache'], { cwd: root, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  },
  pushBranch(branch, product, message, base) {
    const start = git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    try {
      git(root, 'checkout', '-B', branch, `origin/${base}`);
      git(root, 'add', '--', `products/${product}`);
      git(root, 'commit', '-m', message);
      git(root, 'push', '--force-with-lease', '-u', 'origin', branch);
    } finally {
      git(root, 'checkout', '-f', start);
      this.reset(product);
    }
  },
  reset(product) {
    git(root, 'checkout', '--', `products/${product}`);
    git(root, 'clean', '-fdq', '--', `products/${product}`);
  },
});

/** The material's package pin in a lockfile (angular or nest package). */
const pinOf = (packages: Record<string, string>, material: string) =>
  packages[`@factory/${material}-angular`] ?? packages[`@factory/${material}-nest`];

export const branchName = (material: string, version: string, product: string) => `factory/propagate-${material}-${version}-${product}`;

/** Only a green patch bump may auto-merge; minor and major wait for a human. */
export const labelsFor = (from: string, to: string): string[] =>
  semver.diff(from, to) === 'patch' ? ['needs-review', 'claude-approved'] : ['needs-review'];

/**
 * Bumps `material@version` in every consuming product: re-assembles, runs the product's tests and opens one PR per
 * product. Re-running opens no duplicates (an open PR for the same branch is detected and left alone).
 */
export async function propagate(ref: string, opts: PropagateOptions = {}): Promise<PropagateResult> {
  const root = opts.root ?? '.';
  const { name: material, range: version } = parseRef(ref);
  if (!material || !semver.valid(version)) throw new Error(`"${ref}" is not <material>@<exact version>`);
  const deps = opts.deps ?? realPropagateDeps(root);
  const f = opts.fetchImpl ?? fetch;
  const repo = opts.repo ?? process.env['FACTORY_RECALL_REPO'] ?? process.env['GITHUB_REPOSITORY'];
  const token = opts.token ?? process.env['GITHUB_TOKEN'];
  const base = opts.base ?? 'main';
  if (!opts.dryRun && (!repo || !token)) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY (owner/repo) are required to open upgrade PRs');
  const gh = (path: string, init?: RequestInit) =>
    f(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    });

  const products: ProductOutcome[] = [];
  const consumers = readLockfiles(root).filter((l) => pinOf(l.packages, material));
  for (const { product, packages } of consumers) {
    const from = pinOf(packages, material)!;
    const out = (status: ProductOutcome['status'], detail: string, labels: string[] = []) => products.push({ product, from, to: version, status, detail, labels });
    if (!semver.gt(version, from)) {
      out('skipped', `already at ${from}`);
      continue;
    }
    const manifestPath = join(root, 'products', product, 'product.yaml');
    const range = existsSync(manifestPath)
      ? Object.values(readManifest(manifestPath).spec.consumes ?? {}).map(parseRef).find((r) => r.name === material)?.range
      : undefined;
    if (!range || !semver.satisfies(version, semver.validRange(range) ? range : `^${range}`)) {
      out('skipped', `consumes range "${range ?? 'none'}" excludes ${version}; widen it by hand`);
      continue;
    }
    const branch = branchName(material, version, product);
    const labels = labelsFor(from, version);
    if (opts.dryRun) {
      await deps.assemble(manifestPath, true).catch((e: Error) => out('failed', e.message.split('\n')[0] ?? 'assembly failed'));
      if (!products.some((p) => p.product === product)) out('planned', `would open ${branch}`, labels);
      continue;
    }
    const open = await gh(`/pulls?state=open&head=${encodeURIComponent(`${repo!.split('/')[0]}:${branch}`)}`);
    if (!open.ok) throw new Error(`${product}: GitHub answered ${open.status} listing PRs`);
    if (((await open.json()) as unknown[]).length > 0) {
      out('exists', `PR for ${branch} is already open`);
      continue;
    }
    const abandon = (detail: string) => {
      try {
        deps.reset(product);
      } catch (e) {
        detail += ` (reset failed: ${(e as Error).message.split('\n')[0]})`;
      }
      out('failed', detail);
    };
    try {
      await deps.assemble(manifestPath, false);
    } catch (e) {
      abandon(`assembly: ${(e as Error).message.split('\n')[0]}`);
      continue;
    }
    const pinned = readLockfiles(root).find((l) => l.product === product);
    const got = pinned && pinOf(pinned.packages, material);
    if (got !== version) {
      abandon(`assembly pinned ${got ?? 'nothing'}, not ${version} (is it in the registry?)`);
      continue;
    }
    let tested = false;
    try {
      tested = deps.runTests(product);
    } catch (e) {
      abandon(`nx test ${product} errored: ${(e as Error).message.split('\n')[0]}`);
      continue;
    }
    if (!tested) {
      abandon(`nx test ${product} failed after the bump`);
      continue;
    }
    try {
      deps.pushBranch(branch, product, `chore(${product}): bump ${material} ${from} -> ${version}`, base);
    } catch (e) {
      abandon(`push: ${(e as Error).message.split('\n')[0]}`);
      continue;
    }
    const created = await gh('/pulls', {
      method: 'POST',
      body: JSON.stringify({
        title: `chore(${product}): bump ${material} ${from} -> ${version}`,
        head: branch,
        base,
        body: `Opened by \`factory propagate ${material}@${version}\`.\n\n- Lockfile pin re-resolved with \`factory assemble\`\n- \`nx test ${product}\` passed\n- Change class: ${semver.diff(from, version)}${labels.includes('claude-approved') ? ' (patch: auto-merge eligible)' : ' (needs a human)'}`,
      }),
    });
    if (!created.ok) throw new Error(`${product}: GitHub answered ${created.status} creating the PR: ${await created.text()}`);
    const { number } = (await created.json()) as { number: number };
    const lab = await gh(`/issues/${number}/labels`, { method: 'POST', body: JSON.stringify({ labels }) });
    if (!lab.ok) throw new Error(`${product}: GitHub answered ${lab.status} labelling PR #${number}`);
    out('opened', `PR #${number}`, labels);
  }
  return { material, version, products };
}
