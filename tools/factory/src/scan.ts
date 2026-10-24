import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { recall, type RecallOptions, type RecallResult } from './recall.js';

export interface Finding {
  id: string;
  severity: string;
  pkg: string;
}

/** Findings from a Trivy JSON report (`Results[].Vulnerabilities[]`). */
export function parseTrivy(report: unknown): Finding[] {
  const results = (report as { Results?: { Vulnerabilities?: { VulnerabilityID: string; Severity: string; PkgName?: string }[] }[] } | null)?.Results;
  if (!Array.isArray(results)) throw new Error('not a Trivy JSON report (no Results array)');
  return results.flatMap((r) => (r.Vulnerabilities ?? []).map((v) => ({ id: v.VulnerabilityID, severity: v.Severity, pkg: v.PkgName ?? '' })));
}

export const criticals = (findings: Finding[]): Finding[] => findings.filter((f) => f.severity === 'CRITICAL');

/** Runs the Trivy CLI on an SBOM (the Dagger `scan` function is the CI path). */
export function trivySbom(sbomPath: string): unknown {
  return JSON.parse(execFileSync('trivy', ['sbom', '--format', 'json', '--quiet', sbomPath], { encoding: 'utf8', maxBuffer: 1 << 28 }));
}

export interface ScanOutcome {
  ref: string;
  findings: Finding[];
  recall?: RecallResult;
}

/** Scans one package's SBOM; a critical finding recalls it with the CVE ids as the reason. */
export async function scanPackage(ref: string, report: unknown, opts: Omit<RecallOptions, 'reason'> = {}): Promise<ScanOutcome> {
  const findings = parseTrivy(report);
  const crit = criticals(findings);
  if (crit.length === 0) return { ref, findings };
  const reason = [...new Set(crit.map((f) => f.id))].sort().join(', ');
  return { ref, findings, recall: await recall(ref, { ...opts, reason }) };
}

/** `<store>/@factory/<pkg>/<version>/*.sbom.spdx.json` -> `@factory/<pkg>@<version>` and the SBOM path. */
export function storedSboms(store: string): { ref: string; sbom: string }[] {
  const out: { ref: string; sbom: string }[] = [];
  const scope = join(store, '@factory');
  if (!existsSync(scope)) return out;
  for (const pkg of readdirSync(scope).sort()) {
    for (const version of readdirSync(join(scope, pkg)).sort()) {
      const dir = join(scope, pkg, version);
      const file = readdirSync(dir).find((f) => f.endsWith('.sbom.spdx.json'));
      if (file) out.push({ ref: `@factory/${pkg}@${version}`, sbom: join(dir, file) });
    }
  }
  return out;
}

/** Nightly job: scan every released package's SBOM, recalling those with a critical finding. */
export async function scanAll(store: string, opts: Omit<RecallOptions, 'reason'> & { scanSbom?: (path: string) => unknown } = {}): Promise<ScanOutcome[]> {
  const scanSbom = opts.scanSbom ?? trivySbom;
  const outcomes: ScanOutcome[] = [];
  for (const { ref, sbom } of storedSboms(store)) outcomes.push(await scanPackage(ref, scanSbom(sbom), opts));
  return outcomes;
}

export const readReport = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
