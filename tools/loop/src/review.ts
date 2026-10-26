export interface Finding {
  file: string;
  line: number;
  problem: string;
  fix: string;
}

export interface Review {
  verdict: 'approve' | 'changes';
  summary: string;
  findings: Finding[];
}

/** Parses and validates `.loop/review.json`. Throws with a readable reason on bad output. */
export function parseReview(text: string): Review {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    throw new Error('review.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('review.json is not an object');
  const r = raw as Record<string, unknown>;
  if (r['verdict'] !== 'approve' && r['verdict'] !== 'changes') throw new Error('verdict must be "approve" or "changes"');
  if (!Array.isArray(r['findings'])) throw new Error('findings must be an array');
  const findings = (r['findings'] as unknown[]).map((f, i): Finding => {
    const o = (f ?? {}) as Record<string, unknown>;
    if (typeof o['problem'] !== 'string' || !o['problem']) throw new Error(`findings[${i}].problem is missing`);
    return {
      file: typeof o['file'] === 'string' ? o['file'] : '',
      line: typeof o['line'] === 'number' ? o['line'] : 0,
      problem: o['problem'],
      fix: typeof o['fix'] === 'string' ? o['fix'] : '',
    };
  });
  // The verdict follows the findings, whatever the model wrote.
  const verdict = findings.length ? 'changes' : 'approve';
  return { verdict, summary: typeof r['summary'] === 'string' ? r['summary'] : '', findings };
}

export const REVIEW_MARKER = '<!-- factory-review -->';

export function renderReview(r: Review, opts: { needsHuman: boolean; stats?: string }): string {
  const head =
    r.verdict === 'approve'
      ? '**Review: no blocking problems.**'
      : `**Review: changes requested (${r.findings.length} blocking ${r.findings.length === 1 ? 'problem' : 'problems'}).**`;
  const lines = [REVIEW_MARKER, head, ''];
  if (r.summary) lines.push(r.summary, '');
  r.findings.forEach((f, i) => {
    const where = f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\` — ` : '';
    lines.push(`${i + 1}. ${where}${f.problem}${f.fix ? `\n   **Fix:** ${f.fix}` : ''}`);
  });
  if (opts.needsHuman) lines.push('', 'Labelled `needs-human`: this PR changes CI, Claude configuration, prompts, deployment or auth, or its issue requires a human merge.');
  if (opts.stats) lines.push('', `<sub>${opts.stats}</sub>`);
  return lines.join('\n');
}

/** Labels to add and remove for a verdict. */
export function reviewLabels(r: Review, needsHuman: boolean): { add: string[]; remove: string[] } {
  const add = r.verdict === 'approve' ? ['claude-approved'] : ['changes-requested'];
  if (needsHuman) add.push('needs-human');
  const remove = r.verdict === 'approve' ? ['changes-requested'] : ['claude-approved'];
  return { add, remove };
}

/** The latest review comment that requested changes, for the fix prompt. */
export function latestChangesRequest(comments: { body: string; created_at: string }[]): string | null {
  const hits = comments
    .filter((c) => /review:\s*changes requested/i.test(c.body))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return hits.at(-1)?.body.replace(REVIEW_MARKER, '').trim() ?? null;
}
