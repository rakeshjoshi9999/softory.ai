import type { Issue, Pull } from './types.js';

type FetchLike = typeof fetch;

export interface Gh {
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  paginate<T>(path: string): Promise<T[]>;
}

/** Tiny GitHub REST client. `repo` is `owner/name`. */
export function createGh(token: string, repo: string, f: FetchLike = fetch): Gh {
  const base = `https://api.github.com/repos/${repo}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await f(path.startsWith('http') ? path : `${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
  async function paginate<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 20; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const batch = await request<T[]>('GET', `${path}${sep}per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }
  return { request, paginate };
}

interface RawIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  state_reason?: string | null;
  labels: { name: string }[];
  body: string | null;
  pull_request?: unknown;
}
interface RawPull {
  number: number;
  title: string;
  draft: boolean;
  head: { ref: string };
  labels: { name: string }[];
  body: string | null;
  mergeable?: boolean | null;
}

export const toIssue = (i: RawIssue): Issue => ({
  number: i.number,
  title: i.title,
  state: i.state,
  stateReason: i.state_reason ?? null,
  labels: i.labels.map((l) => l.name),
  body: i.body ?? '',
});

export const toPull = (p: RawPull): Pull => ({
  number: p.number,
  title: p.title,
  draft: p.draft,
  headRef: p.head.ref,
  labels: p.labels.map((l) => l.name),
  body: p.body ?? '',
  mergeable: p.mergeable,
});

export async function listIssues(gh: Gh, state: 'open' | 'all' = 'all'): Promise<Issue[]> {
  const raw = await gh.paginate<RawIssue>(`/issues?state=${state}`);
  return raw.filter((i) => !i.pull_request).map(toIssue);
}

export async function listOpenPulls(gh: Gh): Promise<Pull[]> {
  return (await gh.paginate<RawPull>('/pulls?state=open')).map(toPull);
}

interface RawClosedPull extends RawPull {
  merged_at: string | null;
}

/** Recently merged PRs (newest 200), as PR number and the issue they close. */
export async function listMergedPulls(gh: Gh, issueOf: (p: Pull) => number | null): Promise<{ number: number; issue: number | null }[]> {
  const out: { number: number; issue: number | null }[] = [];
  for (const page of [1, 2]) {
    const batch = await gh.request<RawClosedPull[]>('GET', `/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
    for (const p of batch) if (p.merged_at) out.push({ number: p.number, issue: issueOf(toPull(p)) });
    if (batch.length < 100) break;
  }
  return out;
}

export async function getPull(gh: Gh, n: number): Promise<Pull> {
  return toPull(await gh.request<RawPull>('GET', `/pulls/${n}`));
}

export async function getIssue(gh: Gh, n: number): Promise<Issue> {
  return toIssue(await gh.request<RawIssue>('GET', `/issues/${n}`));
}

export async function listBranches(gh: Gh): Promise<string[]> {
  return (await gh.paginate<{ name: string }>('/branches')).map((b) => b.name);
}

export async function addLabels(gh: Gh, n: number, labels: string[]): Promise<void> {
  if (labels.length) await gh.request('POST', `/issues/${n}/labels`, { labels });
}

export async function removeLabel(gh: Gh, n: number, label: string): Promise<void> {
  try {
    await gh.request('DELETE', `/issues/${n}/labels/${encodeURIComponent(label)}`);
  } catch (e) {
    if (!String(e).includes(' 404 ')) throw e;
  }
}

export async function comment(gh: Gh, n: number, body: string): Promise<void> {
  await gh.request('POST', `/issues/${n}/comments`, { body });
}
