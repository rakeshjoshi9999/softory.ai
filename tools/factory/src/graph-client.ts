/**
 * Typed calls to the graph service. The request/response shapes and paths mirror
 * materials/graph-api/generated/openapi.yaml; graph-client.spec.ts fails when they drift.
 * The generated Angular client is HttpClient/DI-bound and lives outside this project's rootDir,
 * so the CLI cannot use it directly.
 */
export const DEFAULT_GRAPH_URL = 'http://localhost:3000';

export type VersionState = 'draft' | 'released' | 'deprecated' | 'recalled';
export interface LockfileIngest { product: string; build: string; packages: Record<string, string> }
export interface LockfileIngested { product: string; build: string; consumed: string[] }
export interface Consumer { product: string; build: string; package: string }
export interface VersionInfo { material: string; version: string; state: VersionState; reason?: string }
export interface StateChange { state: VersionState; reason?: string }

/** Non-2xx answer from the graph service. */
export class GraphError extends Error {
  constructor(readonly status: number, readonly body: string, what: string) {
    super(`graph service answered ${status} ${what}${body ? `: ${body}` : ''}`);
  }
}

export interface GraphClient {
  ingestLockfile(body: LockfileIngest): Promise<LockfileIngested>;
  listConsumers(material: string, version: string): Promise<Consumer[]>;
  getVersion(material: string, version: string): Promise<VersionInfo>;
  setVersionState(material: string, version: string, change: StateChange): Promise<VersionInfo>;
}

export function graphClient(baseUrl?: string, fetchImpl: typeof fetch = fetch): GraphClient {
  const base = (baseUrl ?? process.env['FACTORY_GRAPH_URL'] ?? DEFAULT_GRAPH_URL).replace(/\/$/, '');
  const version = (m: string, v: string) => `${base}/materials/${encodeURIComponent(m)}/versions/${encodeURIComponent(v)}`;
  async function call<T>(what: string, url: string, init?: { method: string; body: unknown }): Promise<T> {
    const res = await fetchImpl(url, init && { method: init.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) });
    if (!res.ok) throw new GraphError(res.status, await res.text(), what);
    return (await res.json()) as T;
  }
  return {
    ingestLockfile: (body) => call(`for POST /ingest/lockfile (${body.product})`, `${base}/ingest/lockfile`, { method: 'POST', body }),
    listConsumers: (m, v) => call(`listing consumers of ${m}@${v}`, `${version(m, v)}/consumers`),
    getVersion: (m, v) => call(`reading ${m}@${v}`, version(m, v)),
    setVersionState: (m, v, change) => call(`for ${m}@${v}`, `${version(m, v)}/state`, { method: 'PUT', body: change }),
  };
}
