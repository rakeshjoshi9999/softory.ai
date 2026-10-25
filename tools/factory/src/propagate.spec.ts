import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { branchName, labelsFor, propagate, realPropagateDeps, type PropagateDeps } from './propagate.js';

let root: string;
const product = (name: string, pin: string, range = '^1') => {
  const dir = join(root, 'products', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'product.lock.json'), JSON.stringify({ registry: 'x', packages: { '@factory/orders-api-angular': pin } }));
  writeFileSync(
    join(dir, 'product.yaml'),
    `apiVersion: factory/v1\nkind: Product\nmetadata:\n  name: ${name}\n  owner: t\nspec:\n  recipe: angular-remote@1\n  consumes:\n    api: orders-api@${range}\n  delivery:\n    pipeline: frontend@1\n    envs: [preview]\n`,
  );
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'propagate-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const pinLock = (name: string, pin: string) =>
  writeFileSync(join(root, 'products', name, 'product.lock.json'), JSON.stringify({ registry: 'x', packages: { '@factory/orders-api-angular': pin } }));

/** `resolve` is the version the fake registry hands back; the fake assemble writes it into the lockfile like the real one. */
function fakes(opts: { testsOk?: boolean; existing?: string[]; resolve?: string; pushThrows?: boolean; testThrows?: boolean } = {}) {
  const calls: string[] = [];
  const deps: PropagateDeps = {
    assemble: async (m, dry) => {
      calls.push(`assemble:${dry ? 'dry' : 'wet'}:${m.split('/').at(-2)}`);
      if (!dry) pinLock(m.split('/').at(-2)!, opts.resolve ?? '1.0.2');
    },
    runTests: (p) => {
      calls.push(`test:${p}`);
      if (opts.testThrows) throw new Error('spawn failed');
      return opts.testsOk ?? true;
    },
    pushBranch: (b) => {
      calls.push(`push:${b}`);
      if (opts.pushThrows) throw new Error('nothing to commit');
    },
    reset: (p) => void calls.push(`reset:${p}`),
  };
  const opened: { head?: string; labels?: string[] }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    if (url.includes('/pulls?')) {
      const head = decodeURIComponent(url.split('head=')[1]!).split(':')[1]!;
      return new Response(JSON.stringify((opts.existing ?? []).includes(head) ? [{ number: 1 }] : []));
    }
    if (url.endsWith('/pulls')) return opened.push({ head: body.head }), new Response(JSON.stringify({ number: opened.length + 10 }), { status: 201 });
    if (url.includes('/labels')) return (opened.at(-1)!.labels = body.labels), new Response('[]');
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { deps, calls, opened, fetchImpl };
}

const run = (f: ReturnType<typeof fakes>, extra = {}) => propagate('orders-api@1.0.2', { root, repo: 'o/r', token: 't', deps: f.deps, fetchImpl: f.fetchImpl, ...extra });

describe('propagate', () => {
  it('labels only green patch bumps for auto-merge', () => {
    expect(labelsFor('1.0.1', '1.0.2')).toEqual(['needs-review', 'claude-approved']);
    expect(labelsFor('1.0.1', '1.1.0')).toEqual(['needs-review']);
  });

  it('opens one labelled PR per consumer after assembling and testing', async () => {
    product('a-ui', '1.0.1');
    product('b-ui', '1.0.1');
    const f = fakes();
    const r = await run(f);
    expect(r.products.map((p) => [p.product, p.status])).toEqual([['a-ui', 'opened'], ['b-ui', 'opened']]);
    expect(f.opened.map((o) => o.head)).toEqual([branchName('orders-api', '1.0.2', 'a-ui'), branchName('orders-api', '1.0.2', 'b-ui')]);
    expect(f.opened.every((o) => o.labels?.includes('claude-approved'))).toBe(true);
    expect(f.calls.indexOf('assemble:wet:a-ui')).toBeLessThan(f.calls.indexOf('test:a-ui'));
  });

  it('does not auto-approve a minor bump', async () => {
    product('a-ui', '1.0.1');
    const f = fakes({ resolve: '1.1.0' });
    await propagate('orders-api@1.1.0', { root, repo: 'o/r', token: 't', deps: f.deps, fetchImpl: f.fetchImpl });
    expect(f.opened[0]!.labels).toEqual(['needs-review']);
  });

  it('opens no duplicate PRs when run twice', async () => {
    product('a-ui', '1.0.1');
    const f = fakes({ existing: [branchName('orders-api', '1.0.2', 'a-ui')] });
    const r = await run(f);
    expect(r.products[0]!.status).toBe('exists');
    expect(f.opened).toHaveLength(0);
    expect(f.calls).toEqual([]);
  });

  it('opens no PR when the product tests fail after the bump', async () => {
    product('a-ui', '1.0.1');
    const f = fakes({ testsOk: false });
    const r = await run(f);
    expect(r.products[0]).toMatchObject({ status: 'failed' });
    expect(f.opened).toHaveLength(0);
    expect(f.calls.some((c) => c.startsWith('push:'))).toBe(false);
  });

  it('fails without a PR when the registry resolves another version than requested', async () => {
    product('a-ui', '1.0.1');
    const f = fakes({ resolve: '1.0.3' });
    const r = await run(f);
    expect(r.products[0]).toMatchObject({ status: 'failed', labels: [] });
    expect(r.products[0]!.detail).toContain('1.0.3');
    expect(f.opened).toHaveLength(0);
    expect(f.calls).toContain('reset:a-ui');
    expect(f.calls.some((c) => c.startsWith('push:') || c.startsWith('test:'))).toBe(false);
  });

  it('records a failure per product and carries on when push or tests throw', async () => {
    product('a-ui', '1.0.1');
    product('b-ui', '1.0.1');
    const f = fakes({ pushThrows: true });
    const r = await run(f);
    expect(r.products.map((p) => [p.product, p.status])).toEqual([['a-ui', 'failed'], ['b-ui', 'failed']]);
    expect(f.calls.filter((c) => c.startsWith('reset:'))).toEqual(['reset:a-ui', 'reset:b-ui']);
    product('a-ui', '1.0.1');
    product('b-ui', '1.0.1');
    const g = fakes({ testThrows: true });
    expect((await run(g)).products.map((p) => p.status)).toEqual(['failed', 'failed']);
  });

  it('skips consumers already up to date or whose range excludes the version', async () => {
    product('new-ui', '1.1.0');
    product('pinned-ui', '1.0.1', '~1.0.0');
    const f = fakes();
    const r = await propagate('orders-api@1.1.0', { root, repo: 'o/r', token: 't', deps: f.deps, fetchImpl: f.fetchImpl });
    expect(r.products.map((p) => [p.product, p.status])).toEqual([['new-ui', 'skipped'], ['pinned-ui', 'skipped']]);
    expect(f.opened).toHaveLength(0);
  });

  it('dry run changes nothing', async () => {
    product('a-ui', '1.0.1');
    const f = fakes();
    const r = await run(f, { dryRun: true, token: undefined, repo: undefined });
    expect(r.products[0]).toMatchObject({ status: 'planned', labels: ['needs-review', 'claude-approved'] });
    expect(f.calls).toEqual(['assemble:dry:a-ui']);
    expect(f.opened).toHaveLength(0);
  });

  it('rejects a ref without an exact version', async () => {
    await expect(propagate('orders-api@^1', { root })).rejects.toThrow(/exact version/);
  });

  it('real git: every PR branch starts from origin/base and the base checkout is restored', async () => {
    const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
    const remote = join(root, 'remote.git');
    const work = join(root, 'work');
    mkdirSync(work);
    sh(root, 'init', '-q', '--bare', '-b', 'main', remote);
    sh(work, 'init', '-q', '-b', 'main');
    sh(work, 'config', 'user.email', 't@t');
    sh(work, 'config', 'user.name', 't');
    const real = root;
    root = work;
    product('a-ui', '1.0.1');
    product('b-ui', '1.0.1');
    sh(work, 'add', '.');
    sh(work, 'commit', '-qm', 'init');
    sh(work, 'remote', 'add', 'origin', remote);
    sh(work, 'push', '-q', 'origin', 'main');
    const deps = realPropagateDeps(work);
    for (const name of ['a-ui', 'b-ui']) {
      pinLock(name, '1.0.2');
      writeFileSync(join(work, 'products', name, 'stray.txt'), 'x');
      deps.pushBranch(`b-${name}`, name, `bump ${name}`, 'main');
      expect(sh(work, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
      expect(sh(work, 'status', '--porcelain')).toBe('');
    }
    expect(sh(work, 'rev-list', '--count', 'origin/main..origin/b-b-ui')).toBe('1');
    expect(sh(work, 'diff', '--name-only', 'origin/main', 'origin/b-b-ui')).toBe('products/b-ui/product.lock.json\nproducts/b-ui/stray.txt');
    pinLock('a-ui', '1.0.9');
    deps.reset('a-ui');
    expect(readFileSync(join(work, 'products', 'a-ui', 'product.lock.json'), 'utf8')).toContain('1.0.1');
    root = real;
  });
});
