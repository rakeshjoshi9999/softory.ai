import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { criticals, parseTrivy, readReport, scanAll, scanPackage, storedSboms } from './scan.js';

const ref = '@factory/orders-api-angular@1.0.1';
const fixture = readReport(join(fileURLToPath(new URL('.', import.meta.url)), '../test-fixtures/critical.trivy.json'));
const clean = { Results: [{ Target: 't', Vulnerabilities: [{ VulnerabilityID: 'CVE-1', Severity: 'HIGH', PkgName: 'x' }] }] };

function fakeFetch() {
  const calls: { url: string; method: string }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    return new Response(url.endsWith('/consumers') ? JSON.stringify([{ product: 'orders-ui', package: `${ref}` }]) : '{}');
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('scan', () => {
  it('parses Trivy findings and picks the critical ones', () => {
    expect(criticals(parseTrivy(fixture)).map((f) => f.id)).toEqual(['CVE-2021-44228']);
    expect(() => parseTrivy({})).toThrow(/not a Trivy/);
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

  it('nightly scan walks the attestation store', async () => {
    const store = mkdtempSync(join(tmpdir(), 'att-'));
    for (const [pkg, v] of [['orders-api-angular', '1.0.1'], ['orders-api-nest', '1.0.1']] as const) {
      const d = join(store, '@factory', pkg, v);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, `${pkg}-${v}.tgz.sbom.spdx.json`), '{}');
    }
    expect(storedSboms(store).map((s) => s.ref)).toEqual(['@factory/orders-api-angular@1.0.1', '@factory/orders-api-nest@1.0.1']);
    const { impl } = fakeFetch();
    const out = await scanAll(store, { dryRun: true, graphUrl: 'http://graph', fetchImpl: impl, scanSbom: (p) => (p.includes('angular') ? fixture : clean) });
    expect(out.map((o) => !!o.recall)).toEqual([true, false]);
  });
});
