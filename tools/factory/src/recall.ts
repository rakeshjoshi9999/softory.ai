import { execFileSync } from 'node:child_process';
import { graphClient } from './graph-client.js';
import { DEFAULT_REGISTRY } from './release.js';

/** Prefix `npm deprecate` carries for recalled versions; `assemble` refuses these. */
export const RECALL_PREFIX = 'RECALLED: ';

export interface RecallOptions {
  reason: string;
  graphUrl?: string;
  registry?: string;
  /** `owner/repo` that receives one issue per affected product. */
  repo?: string;
  token?: string;
  /** Compute the affected products and issues but change nothing (graph state, registry, GitHub). */
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
  deprecate?: (pkg: string, message: string, registry: string) => void;
}

export interface RecallResult {
  package: string;
  material: string;
  version: string;
  products: string[];
  issues: { product: string; payload: { title: string; body: string; labels: string[] } }[];
}

/** `@factory/orders-api-angular@1.0.1` -> material `orders-api`, version `1.0.1`. */
export function parsePackageRef(ref: string): { pkg: string; material: string; version: string } {
  const m = /^(@factory\/(.+)-(?:nest|angular))@(\d+\.\d+\.\d+\S*)$/.exec(ref);
  if (!m) throw new Error(`"${ref}" is not @factory/<material>-(nest|angular)@<version>`);
  return { pkg: m[1]!, material: m[2]!, version: m[3]! };
}

export function issuePayload(product: string, pkg: string, version: string, reason: string) {
  return {
    title: `Recall: ${pkg}@${version} (${product})`,
    body: `\`${pkg}@${version}\` has been recalled.\n\n**Reason:** ${reason}\n\n\`${product}\` consumes it. Re-run \`factory assemble\` after a fixed version is released and move the \`consumes\` range off ${version}.`,
    labels: ['recall'],
  };
}

const npmDeprecate = (pkg: string, message: string, registry: string) =>
  void execFileSync('npm', ['deprecate', pkg, message, '--registry', registry], { stdio: 'pipe' });

/** Deprecates a version on the registry, marks it recalled in the graph and opens one issue per affected product. */
export async function recall(ref: string, opts: RecallOptions): Promise<RecallResult> {
  if (!opts.reason.trim()) throw new Error('a recall needs --reason');
  const { pkg, material, version } = parsePackageRef(ref);
  const registry = opts.registry ?? process.env['FACTORY_REGISTRY'] ?? DEFAULT_REGISTRY;
  const f = opts.fetchImpl ?? fetch;
  const graph = graphClient(opts.graphUrl, f);

  const consumers = await graph.listConsumers(material, version);
  // the graph lists consumers of every package of the material version; only this package's are affected
  const products = [...new Set(consumers.filter((c) => c.package === `${pkg}@${version}`).map((c) => c.product))].sort();

  if (opts.dryRun) {
    const planned = products.map((product) => ({ product, payload: issuePayload(product, pkg, version, opts.reason) }));
    return { package: pkg, material, version, products, issues: planned };
  }
  // registry first: a half-done recall must never leave the graph saying "recalled" while the registry still serves the version
  (opts.deprecate ?? npmDeprecate)(`${pkg}@${version}`, `${RECALL_PREFIX}${opts.reason}`, registry);
  await graph.setVersionState(material, version, { state: 'recalled', reason: opts.reason });

  const repo = opts.repo ?? process.env['FACTORY_RECALL_REPO'] ?? process.env['GITHUB_REPOSITORY'];
  const token = opts.token ?? process.env['GITHUB_TOKEN'];
  const issues = products.map((product) => ({ product, payload: issuePayload(product, pkg, version, opts.reason) }));
  if (issues.length > 0) {
    if (!repo || !token) throw new Error('GITHUB_TOKEN and FACTORY_RECALL_REPO (owner/repo) are required to open recall issues');
    for (const i of issues) {
      const res = await f(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
        body: JSON.stringify(i.payload),
      });
      if (!res.ok) throw new Error(`${i.product}: GitHub answered ${res.status} ${await res.text()}`);
    }
  }
  return { package: pkg, material, version, products, issues };
}
