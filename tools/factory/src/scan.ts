import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_GRAPH_URL } from './graph.js';
import { parsePackageRef, recall, type RecallOptions, type RecallResult } from './recall.js';

export interface Finding {
  id: string;
  severity: string;
  pkg: string;
}

/** Findings from a Trivy JSON report (`Results[].Vulnerabilities[]`). */
export function parseTrivy(report: unknown): Finding[] {
  if (typeof report !== 'object' || report === null || Array.isArray(report)) throw new Error('not a Trivy JSON report (expected an object)');
  // Trivy omits `Results` when it found nothing to report
  const results = (report as { Results?: { Vulnerabilities?: { VulnerabilityID: string; Severity: string; PkgName?: string }[] }[] }).Results ?? [];
  if (!Array.isArray(results)) throw new Error('not a Trivy JSON report (Results is not an array)');
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

/** Runs the Trivy CLI on a registry image. */
export function trivyImage(image: string): unknown {
  return JSON.parse(execFileSync('trivy', ['image', '--format', 'json', '--quiet', image], { encoding: 'utf8', maxBuffer: 1 << 28 }));
}

export interface ScanAllOptions extends Omit<RecallOptions, 'reason'> {
  scanSbom?: (path: string) => unknown;
  /** Released image references (`registry/name@sha256:...`) to scan as well. */
  images?: string[];
  scanImage?: (image: string) => unknown;
}

export interface ScanAllResult {
  outcomes: ScanOutcome[];
  /** Refs already `recalled` in the graph: not touched again. */
  skipped: string[];
  failures: { ref: string; error: string }[];
}

/** Version state from the graph (`released` unless set); throws when the graph does not know the version. */
async function graphState(ref: string, opts: ScanAllOptions): Promise<string> {
  const { material, version } = parsePackageRef(ref);
  const graph = (opts.graphUrl ?? process.env['FACTORY_GRAPH_URL'] ?? DEFAULT_GRAPH_URL).replace(/\/$/, '');
  const res = await (opts.fetchImpl ?? fetch)(`${graph}/materials/${encodeURIComponent(material)}/versions/${encodeURIComponent(version)}`);
  if (!res.ok) throw new Error(`graph service answered ${res.status} for ${material}@${version}`);
  return ((await res.json()) as { state?: string }).state ?? 'released';
}

/**
 * Nightly job: scan every released package's SBOM and image, recalling packages with a critical finding.
 * One failure never stops the run; the caller exits non-zero when `failures` is not empty.
 */
export async function scanAll(store: string, opts: ScanAllOptions = {}): Promise<ScanAllResult> {
  const scanSbom = opts.scanSbom ?? trivySbom;
  const scanImage = opts.scanImage ?? trivyImage;
  const sboms = storedSboms(store);
  if (sboms.length === 0) throw new Error(`no SBOMs found in the attestation store "${store}": restore it before scanning`);
  const result: ScanAllResult = { outcomes: [], skipped: [], failures: [] };
  for (const { ref, sbom } of sboms) {
    try {
      if ((await graphState(ref, opts)) === 'recalled') {
        result.skipped.push(ref);
        continue;
      }
      result.outcomes.push(await scanPackage(ref, scanSbom(sbom), opts));
    } catch (e) {
      result.failures.push({ ref, error: (e as Error).message });
    }
  }
  for (const image of opts.images ?? []) {
    try {
      const findings = parseTrivy(scanImage(image));
      result.outcomes.push({ ref: image, findings });
      // an image has no package ref to recall; a critical finding fails the run so a human acts on it
      const crit = criticals(findings);
      if (crit.length > 0) result.failures.push({ ref: image, error: `critical finding(s) in image: ${[...new Set(crit.map((f) => f.id))].sort().join(', ')}` });
    } catch (e) {
      result.failures.push({ ref: image, error: (e as Error).message });
    }
  }
  return result;
}

export const readReport = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
