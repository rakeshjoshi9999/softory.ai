import { existsSync, readFileSync } from 'node:fs';

export type Status = { kind: 'done' } | { kind: 'blocked'; reason: string } | { kind: 'missing' };

/** Reads the last `STATUS:` line of `.loop/result.md`. `missing` means the run was cut off. */
export function parseStatus(text: string | null): Status {
  if (!text) return { kind: 'missing' };
  const lines = text.trim().split('\n').reverse();
  for (const line of lines) {
    const m = /^\s*STATUS:\s*(done|blocked)\s*(?:[-—:]\s*(.*))?$/i.exec(line);
    if (!m) continue;
    return m[1]?.toLowerCase() === 'done' ? { kind: 'done' } : { kind: 'blocked', reason: (m[2] ?? '').trim() || 'no reason given' };
  }
  return { kind: 'missing' };
}

export function readResult(path = '.loop/result.md'): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** Result text without the STATUS line, for PR bodies and comments. */
export function resultBody(text: string | null): string {
  if (!text) return '_The run ended before writing a result._';
  return text.replace(/^\s*STATUS:.*$/im, '').trim();
}

export interface RunStats {
  costUsd?: number;
  turns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}

/** Best-effort stats from the claude-code-action execution file (a JSON array of SDK messages). */
export function parseExecution(text: string | null): RunStats {
  if (!text) return {};
  try {
    const msgs = JSON.parse(text) as Record<string, unknown>[];
    const result = [...msgs].reverse().find((m) => m['type'] === 'result');
    if (!result) return {};
    const usage = (result['usage'] ?? {}) as Record<string, number>;
    return {
      costUsd: typeof result['total_cost_usd'] === 'number' ? result['total_cost_usd'] : undefined,
      turns: typeof result['num_turns'] === 'number' ? result['num_turns'] : undefined,
      inputTokens: usage['input_tokens'],
      outputTokens: usage['output_tokens'],
      cacheReadTokens: usage['cache_read_input_tokens'],
    };
  } catch {
    return {};
  }
}

export function formatStats(job: string, model: string, s: RunStats): string {
  const parts = [`factory-loop ${job}`, `model ${model}`];
  if (s.turns !== undefined) parts.push(`${s.turns} turns`);
  if (s.inputTokens !== undefined) parts.push(`${s.inputTokens} in / ${s.outputTokens ?? 0} out tokens`);
  if (s.cacheReadTokens) parts.push(`${s.cacheReadTokens} cached`);
  if (s.costUsd !== undefined) parts.push(`~$${s.costUsd.toFixed(2)} API-equivalent`);
  return parts.join(' · ');
}

/** Marker on comments for runs that ended before writing a result. */
export const INTERRUPTED = '<!-- factory-loop:interrupted -->';
export const MAX_INTERRUPTS = 2;
