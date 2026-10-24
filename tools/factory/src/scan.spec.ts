import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { criticals, parseTrivy, readReport, scanAll, scanPackage, storedSboms } from './scan.js';

const ref = '@factory/orders-api-angular@1.0.1';
const fixture = readReport(join(fileURLToPath(new URL('.', import.meta.url)), '../test-fixtures/critical.trivy.json'));
const clean = { Results: [{ Target: 't', Vulnerabilities: [{ VulnerabilityID: 'CVE-1', Severity: 'HIGH', PkgName: 'x' }] }] };

function fakeFetch(states: Record<string, string> = {}) {
  const calls: { url: string; method: string }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    if (/\/versions\/[^/]+$/.test(url)) return new Response(JSON.stringify({ state: states[url.split('/').pop()!] ?? 'released' }), { status: url.endsWith('/9.9.9') ? 404 : 200 });
    return new Response(url.endsWith('/consumers') ? JSON.stringify([{ product: 'orders-ui', package: `${ref}` }]) : '{}');
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('scan', () => {
  it('parses Trivy findings and picks the critical ones', () => {
    expect(criticals(parseTrivy(fixture)).map((f) => f.id)).toEqual(['CVE-2021-44228']);
    expect(() => parseTrivy('x')).toThrow(/not a Trivy/);
    expect(() => parseTrivy(null)).toThrow(/not a Trivy/);
  });

  it('a report without Results means no findings', () => {
    expect(parseTrivy({ SchemaVersion: 2 })).toEqual([]);
    expect(parseTrivy({})).toEqual([]);
  });

  it('a fixture SBOM report with a critical CVE produces a recall in dry-run mode, changing nothing', async () => {
    const { impl, calls } = fakeFetch();
    const deprecated: string[] = [];
    const o = await scanPackage(ref, fixture, { dryRun: true, graphUrl: 'http://graph', fetchImpl: impl, deprecate: (p) => void deprecated.push(p) });
    expect(o.recall?.products).toEqual(['orders-ui']);
    expect(o.recall?.issues[0]?.payload.body).toContain('CVE-2021-44228');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(deprecated).toEqual([]);
  });

  it('does not recall without a critical finding', async () => {
    const { impl, calls } = fakeFetch();
    const o = await scanPackage(ref, clean, { dryRun: true, fetchImpl: impl });
    expect(o.recall).toBeUndefined();
    expect(calls).toEqual([]);
  });

  function makeStore(pkgs: [string, string][]) {
    const store = mkdtempSync(join(tmpdir(), 'att-'));
    for (const [pkg, v] of pkgs) {
      const d = join(store, '@factory', pkg, v);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, `${pkg}-${v}.tgz.sbom.spdx.json`), '{}');
    }
    return store;
  }
  const angular = (p: string) => (p.includes('angular') ? fixture : clean);

  it('nightly scan walks the attestation store', async () => {
    const store = makeStore([['orders-api-angular', '1.0.1'], ['orders-api-nest', '1.0.1']]);
    expect(storedSboms(store).map((s) => s.ref)).toEqual(['@factory/orders-api-angular@1.0.1', '@factory/orders-api-nest@1.0.1']);
    const { impl } = fakeFetch();
    const out = await scanAll(store, { dryRun: true, graphUrl: 'http://graph', fetchImpl: impl, scanSbom: angular });
    expect(out.outcomes.map((o) => !!o.recall)).toEqual([true, false]);
    expect(out.failures).toEqual([]);
  });

  it('skips versions already recalled: no PUT, no deprecate, no issue', async () => {
    const store = makeStore([['orders-api-angular', '1.0.1']]);
    const { impl, calls } = fakeFetch({ '1.0.1': 'recalled' });
    const deprecated: string[] = [];
    const out = await scanAll(store, { graphUrl: 'http://graph', repo: 'o/r', token: 't', fetchImpl: impl, scanSbom: angular, deprecate: (p) => void deprecated.push(p) });
    expect(out.skipped).toEqual(['@factory/orders-api-angular@1.0.1']);
    expect(out.outcomes).toEqual([]);
    expect(calls.every((c) => c.method === 'GET' && !c.url.includes('github'))).toBe(true);
    expect(deprecated).toEqual([]);
  });

  it('one failing package does not stop the run; failures are collected', async () => {
    const store = makeStore([['orders-api-angular', '9.9.9'], ['orders-api-nest', '1.0.1'], ['orders-web-angular', '1.0.1']]);
    const { impl } = fakeFetch();
    const out = await scanAll(store, {
      dryRun: true,
      graphUrl: 'http://graph',
      fetchImpl: impl,
      scanSbom: (p) => {
        if (p.includes('orders-web')) throw new Error('trivy exploded');
        return clean;
      },
    });
    expect(out.outcomes.map((o) => o.ref)).toEqual(['@factory/orders-api-nest@1.0.1']);
    expect(out.failures.map((f) => [f.ref, f.error])).toEqual([
      ['@factory/orders-api-angular@9.9.9', expect.stringContaining('404')],
      ['@factory/orders-web-angular@1.0.1', 'trivy exploded'],
    ]);
  });

  it('a missing or empty attestation store fails loudly', async () => {
    await expect(scanAll(join(tmpdir(), 'does-not-exist-att'), {})).rejects.toThrow(/no SBOMs/);
    await expect(scanAll(mkdtempSync(join(tmpdir(), 'att-')), {})).rejects.toThrow(/no SBOMs/);
  });

  it('scans released images too; a critical image finding is a failure, a clean one is not', async () => {
    const store = makeStore([['orders-api-nest', '1.0.1']]);
    const { impl } = fakeFetch();
    const out = await scanAll(store, { dryRun: true, graphUrl: 'http://graph', fetchImpl: impl, scanSbom: () => clean, images: ['r/a@sha256:1', 'r/b@sha256:2'], scanImage: (i) => (i.endsWith('1') ? fixture : clean) });
    expect(out.outcomes.map((o) => o.ref)).toEqual(['@factory/orders-api-nest@1.0.1', 'r/a@sha256:1', 'r/b@sha256:2']);
    expect(out.failures).toEqual([{ ref: 'r/a@sha256:1', error: expect.stringContaining('CVE-2021-44228') }]);
  });
});
