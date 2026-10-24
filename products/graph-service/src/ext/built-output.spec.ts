import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, TestDatabase } from './testing/pg-fixture';

const root = resolve(__dirname, '../../../..');

describe('graph-service built output', () => {
  let db: TestDatabase;
  let tmp: string;
  let child: ChildProcess | undefined;

  beforeAll(() => {
    db = startTestDatabase();
    execFileSync('pnpm', ['nx', 'build', 'graph-service', '--skip-nx-cache'], { cwd: root, stdio: 'pipe' });
    // Run the build from a directory outside the repo: nothing may depend on the source layout.
    tmp = mkdtempSync(join(tmpdir(), 'graph-built-'));
    cpSync(join(root, 'dist/products/graph-service'), join(tmp, 'app'), { recursive: true });
    symlinkSync(join(root, 'node_modules'), join(tmp, 'node_modules'));
  }, 240_000);

  afterAll(() => {
    child?.kill();
    rmSync(tmp, { recursive: true, force: true });
    db.stop();
  });

  it('applies migrations and answers /health when started with node main.js', async () => {
    const port = 3900 + (process.pid % 90);
    child = spawn('node', [join(tmp, 'app/main.js')], { cwd: tmp, env: { ...process.env, DATABASE_URL: db.url, PORT: String(port) }, stdio: 'pipe' });
    let log = '';
    child.stdout?.on('data', (d) => (log += d));
    child.stderr?.on('data', (d) => (log += d));
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) {
      try {
        ok = (await fetch(`http://127.0.0.1:${port}/health`)).ok;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    expect(ok, log).toBe(true);
    const pool = new Pool({ connectionString: db.url });
    try {
      const r = await pool.query("select to_regclass('public.nodes') as t");
      expect(r.rows[0].t).not.toBeNull();
    } finally {
      await pool.end();
    }
  }, 30_000);
});
