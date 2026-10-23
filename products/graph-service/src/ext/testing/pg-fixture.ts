import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestDatabase {
  url: string;
  stop(): void;
}

const PG_BIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/15/bin', '/usr/bin'];

function pgBin(name: string): string {
  for (const dir of PG_BIN) {
    try {
      execFileSync(join(dir, name), ['--version'], { stdio: 'ignore' });
      return join(dir, name);
    } catch {
      /* try next */
    }
  }
  throw new Error(`${name} not found: set TEST_DATABASE_URL to a PostgreSQL instance (CI provides one via docker compose)`);
}

/** Uses TEST_DATABASE_URL when set; otherwise starts a throwaway local cluster on a unix socket. */
export function startTestDatabase(): TestDatabase {
  const external = process.env['TEST_DATABASE_URL'];
  if (external) return { url: external, stop: () => undefined };

  const dir = mkdtempSync(join(tmpdir(), 'graph-pg-'));
  chmodSync(dir, 0o777);
  const data = join(dir, 'data');
  const asPg = process.getuid?.() === 0 ? ['runuser', '-u', 'postgres', '--'] : [];
  const run = (bin: string, args: string[]) => execFileSync(asPg[0] ?? bin, [...asPg.slice(1), ...(asPg.length ? [bin] : []), ...args], { stdio: 'pipe' });
  run(pgBin('initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres']);
  run(pgBin('pg_ctl'), ['-D', data, '-o', `-c listen_addresses= -c unix_socket_directories=${dir}`, '-l', join(dir, 'log'), '-w', 'start']);
  return {
    url: `postgresql://postgres@/postgres?host=${encodeURIComponent(dir)}`,
    stop: () => {
      try {
        run(pgBin('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
