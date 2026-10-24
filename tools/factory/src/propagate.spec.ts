import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { branchName, labelsFor, propagate, type PropagateDeps } from './propagate.js';

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

function fakes(opts: { testsOk?: boolean; existing?: string[] } = {}) {
  const calls: string[] = [];
  const deps: PropagateDeps = {
    assemble: async (m, dry) => void calls.push(`assemble:${dry ? 'dry' : 'wet'}:${m.split('/').at(-2)}`),
    runTests: (p) => (calls.push(`test:${p}`), opts.testsOk ?? true),
    pushBranch: (b) => void calls.push(`push:${b}`),
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
    const f = fakes();
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
});
