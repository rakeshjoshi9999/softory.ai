import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGh } from './github.js';
import { gateBody, gateCriterion, plan } from './plan.js';
import { cap, fill, previousReview, template } from './prompt.js';
import { formatStats, parseExecution, parseStatus, resultBody } from './result.js';
import { latestChangesRequest, parseReview, renderReview, reviewLabels } from './review.js';
import type { Issue } from './types.js';

describe('prompt', () => {
  it('fills placeholders and drops unknown ones', () => {
    expect(fill('a {{x}} b {{y}}\n\n\n\nc', { x: 1 })).toBe('a 1 b \n\nc');
  });
  it('caps long text', () => {
    expect(cap('abcdef', 3)).toContain('[... truncated 3 characters]');
  });
  it('loads the repo templates', () => {
    const root = mkdtempSync(join(tmpdir(), 'loop-'));
    mkdirSync(join(root, 'prompts', 'loop'), { recursive: true });
    writeFileSync(join(root, 'prompts', 'loop', 'build.md'), 'Issue #{{issue}}');
    expect(fill(template('build', root), { issue: 7 })).toBe('Issue #7');
    expect(template('review')).toContain('.loop/review.json');
  });
  it('previous review is empty without comments', () => {
    expect(previousReview([])).toBe('');
    expect(previousReview(['x'])).toContain('Earlier review');
  });
});

describe('result', () => {
  it('reads the last STATUS line', () => {
    expect(parseStatus('work\nSTATUS: done')).toEqual({ kind: 'done' });
    expect(parseStatus('STATUS: blocked - needs a decision on storage')).toEqual({ kind: 'blocked', reason: 'needs a decision on storage' });
    expect(parseStatus('no status')).toEqual({ kind: 'missing' });
    expect(parseStatus(null)).toEqual({ kind: 'missing' });
  });
  it('strips the STATUS line from the body', () => {
    expect(resultBody('- did x\nSTATUS: done')).toBe('- did x');
  });
  it('parses execution stats best-effort', () => {
    const exec = JSON.stringify([{ type: 'system' }, { type: 'result', total_cost_usd: 1.234, num_turns: 17, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900 } }]);
    const s = parseExecution(exec);
    expect(s).toMatchObject({ costUsd: 1.234, turns: 17, inputTokens: 100, outputTokens: 50, cacheReadTokens: 900 });
    expect(formatStats('build', 'm', s)).toContain('17 turns');
    expect(parseExecution('not json')).toEqual({});
  });
});

describe('review', () => {
  it('derives the verdict from findings', () => {
    const r = parseReview('{"verdict":"approve","summary":"s","findings":[{"file":"a.ts","line":3,"problem":"p","fix":"f"}]}');
    expect(r.verdict).toBe('changes');
    expect(parseReview('```json\n{"verdict":"changes","findings":[]}\n```').verdict).toBe('approve');
  });
  it('rejects malformed output', () => {
    expect(() => parseReview('nope')).toThrow(/valid JSON/);
    expect(() => parseReview('{"verdict":"maybe","findings":[]}')).toThrow(/verdict/);
    expect(() => parseReview('{"verdict":"changes","findings":[{}]}')).toThrow(/problem/);
  });
  it('renders and labels', () => {
    const r = parseReview('{"verdict":"changes","summary":"s","findings":[{"file":"a.ts","line":3,"problem":"p","fix":"f"}]}');
    const text = renderReview(r, { needsHuman: true });
    expect(text).toContain('changes requested (1 blocking problem)');
    expect(text).toContain('`a.ts:3`');
    expect(reviewLabels(r, true)).toEqual({ add: ['changes-requested', 'needs-human'], remove: ['claude-approved'] });
    expect(latestChangesRequest([
      { body: '**Review: changes requested** old', created_at: '2026-01-01' },
      { body: '**Review: changes requested** new', created_at: '2026-01-02' },
      { body: '**Review: no blocking problems.**', created_at: '2026-01-03' },
    ])).toContain('new');
  });
});

const iss = (n: number, title: string, labels: string[], state: Issue['state'] = 'closed', stateReason: string | null = 'completed'): Issue => ({ number: n, title, labels, state, stateReason, body: '' });

describe('plan', () => {
  it('opens a gate when a phase is done and none exists', () => {
    const a = plan([iss(1, '[P1-01] a', ['phase-1']), iss(2, '[P1-02] b', ['phase-1']), iss(3, '[P2-01] c', ['phase-2', 'ready'], 'open', null)]);
    expect(a.openGates).toEqual([{ phase: 1, tasks: [{ number: 1, title: '[P1-01] a' }, { number: 2, title: '[P1-02] b' }] }]);
    expect(a.promote).toEqual([]);
  });
  it('does not reopen an existing gate, and promotes after it closes as completed', () => {
    const base = [iss(1, '[P1-01] a', ['phase-1']), iss(5, '[P2-01] c', ['phase-2', 'planned'], 'open', null)];
    expect(plan([...base, iss(9, 'Gate 1 review', ['needs-human'], 'open', null)])).toEqual({ promote: [], openGates: [], close: [] });
    expect(plan([...base, iss(9, 'Gate 1 review', [], 'closed', 'completed')]).promote).toEqual([{ phase: 2, issues: [5] }]);
    expect(plan([...base, iss(9, 'Gate 1 review', [], 'closed', 'not_planned')]).promote).toEqual([]);
  });
  it('closes issues whose PR merged, and counts them as done for the gate', () => {
    const a = plan([iss(1, '[P1-01] a', ['phase-1']), iss(2, '[P1-02] b', ['phase-1', 'in-progress'], 'open', null)], [{ number: 50, issue: 2 }, { number: 51, issue: null }]);
    expect(a.close).toEqual([{ issue: 2, pr: 50 }]);
    expect(a.openGates.map((g) => g.phase)).toEqual([1]);
  });

  it('reads the gate criterion from the roadmap table', () => {
    const md = '| Phase | Delivers | Gate |\n| --- | --- | --- |\n| 1 Foundations | x | One product rebuilt from its spec |\n| 2 Supply chain | y | Spec change reaches 3 products |';
    expect(gateCriterion(md, 2)).toBe('Spec change reaches 3 products');
    expect(gateCriterion(md, 7)).toBeNull();
    expect(gateBody(2, [{ number: 4, title: 't' }], 'c')).toContain('- #4 t');
  });
});

describe('github client', () => {
  it('sends auth, paginates and tolerates 404 on label removal paths', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      const page = Number(new URL(url).searchParams.get('page'));
      const body = page === 1 ? Array.from({ length: 100 }, (_, i) => ({ i })) : [{ i: 100 }];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const gh = createGh('t', 'o/r', fake);
    expect((await gh.paginate('/issues?state=open')).length).toBe(101);
    expect(calls[0]).toBe('https://api.github.com/repos/o/r/issues?state=open&per_page=100&page=1');
  });
  it('throws readable errors', async () => {
    const fake = (async () => new Response('{"message":"Bad"}', { status: 422 })) as unknown as typeof fetch;
    await expect(createGh('t', 'o/r', fake).request('POST', '/issues', {})).rejects.toThrow(/422/);
  });
});
