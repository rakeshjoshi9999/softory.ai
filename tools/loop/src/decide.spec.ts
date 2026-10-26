import { describe, expect, it } from 'vitest';
import { blockedBy, branchFor, compareTaskIds, decide, issueOfPull, needsHuman, taskId } from './decide.js';
import type { Issue, Pull } from './types.js';

const issue = (n: number, title: string, labels: string[], blockers: string[] = [], state: Issue['state'] = 'open'): Issue => ({
  number: n,
  title,
  state,
  labels,
  body: `### Goal\nx\n\n### Blocked by\n${blockers.length ? blockers.join(', ') : '_none_'}\n`,
});
const pull = (n: number, headRef: string, labels: string[] = [], body = ''): Pull => ({ number: n, title: `PR ${n}`, draft: false, headRef, labels, body });

describe('task ids', () => {
  it('parses and orders by phase then number', () => {
    expect(taskId('[P2-13] Fix scan')).toBe('P2-13');
    expect(taskId('Gate 1 review')).toBeNull();
    expect(['P2-13', 'P1-11', 'P2-2'].sort(compareTaskIds)).toEqual(['P1-11', 'P2-2', 'P2-13']);
  });

  it('reads Blocked by and ignores the rest of the body', () => {
    expect(blockedBy('### Goal\nsee P9-9\n\n### Blocked by\nP2-06, P2-13\n\n### Notes\nP3-1')).toEqual(['P2-06', 'P2-13']);
    expect(blockedBy('### Blocked by\n_none_')).toEqual([]);
    expect(blockedBy('no section')).toEqual([]);
  });

  it('makes claude/<n>-<slug> branches', () => {
    expect(branchFor(issue(78, '[P2-14] Assembly security: fail-closed integrity!', []))).toBe('claude/78-assembly-security-fail-closed-integrity');
  });

  it('finds the issue a PR closes', () => {
    expect(issueOfPull(pull(1, 'claude/x', [], 'Closes #74\n\nbody'))).toBe(74);
    expect(issueOfPull(pull(1, 'claude/21-vuln-scan'))).toBe(21);
    expect(issueOfPull(pull(1, 'feature/x'))).toBeNull();
  });
});

describe('decide', () => {
  it('returns none when there is nothing to do', () => {
    expect(decide({ issues: [], pulls: [], branches: [] }).kind).toBe('none');
  });

  it('fixes a changes-requested PR before anything else, oldest first', () => {
    const j = decide({
      issues: [issue(5, '[P1-01] a', ['ready'])],
      pulls: [pull(9, 'claude/7-b', ['changes-requested'], 'Closes #7'), pull(8, 'claude/6-a', ['merge-conflict'])],
      branches: [],
    });
    expect(j).toEqual({ kind: 'fix', pr: 8, branch: 'claude/6-a', issue: 6, reason: 'merge-conflict' });
  });

  it('ignores PRs that are not on claude/ branches', () => {
    const j = decide({ issues: [], pulls: [pull(3, 'human/x', ['changes-requested'])], branches: [] });
    expect(j.kind).toBe('none');
  });

  it('resumes a claimed task that has a branch but no PR', () => {
    const j = decide({
      issues: [issue(12, '[P2-02] b', ['ready', 'in-progress']), issue(11, '[P2-01] a', ['ready'])],
      pulls: [],
      branches: ['main', 'claude/12-b'],
    });
    expect(j).toEqual({ kind: 'resume', issue: 12, branch: 'claude/12-b', taskId: 'P2-02' });
  });

  it('builds the lowest unblocked ready task', () => {
    const j = decide({
      issues: [
        issue(22, '[P2-12] gate demo', ['ready'], ['P2-13']),
        issue(74, '[P2-13] fix scan', ['ready']),
        issue(76, '[P1-11] fix release', ['ready']),
      ],
      pulls: [],
      branches: [],
    });
    expect(j).toMatchObject({ kind: 'build', issue: 76, taskId: 'P1-11' });
  });

  it('skips blocked, planned, claimed and already-PRed tasks', () => {
    const j = decide({
      issues: [
        issue(1, '[P2-01] has pr', ['ready']),
        issue(2, '[P2-02] planned', ['planned']),
        issue(3, '[P2-03] blocked label', ['ready', 'blocked']),
        issue(4, '[P2-04] blocked by open', ['ready'], ['P2-01']),
        issue(5, '[P2-05] merged already', ['ready', 'in-progress']),
        issue(6, '[P2-06] free', ['ready'], ['P1-99']),
      ],
      pulls: [pull(40, 'claude/1-has-pr', [], 'Closes #1')],
      branches: [],
      merged: [5],
    });
    expect(j).toMatchObject({ kind: 'build', issue: 6 });
  });

  it('rebuilds a stale claim that has no branch and no PR', () => {
    const j = decide({ issues: [issue(7, '[P2-07] claimed long ago', ['ready', 'in-progress'])], pulls: [], branches: ['main'] });
    expect(j).toMatchObject({ kind: 'build', issue: 7 });
  });
});

describe('needsHuman', () => {
  it('flags CI, Claude config, prompts, deploy and auth paths', () => {
    expect(needsHuman(['tools/factory/src/a.ts'])).toBe(false);
    for (const f of ['.github/workflows/ci.yml', '.claude/settings.json', 'prompts/loop/build.md', 'deploy/charts/x.yaml', 'products/x/src/auth/guard.ts', 'CLAUDE.md']) {
      expect(needsHuman([f])).toBe(true);
    }
    expect(needsHuman([], ['needs-human'])).toBe(true);
  });
});
