// Installs the published packages from the local registry into a temp project and checks they resolve.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const registry = process.env['FACTORY_REGISTRY'] ?? 'http://localhost:4873/';
const names = process.argv.slice(2);
if (!names.length) {
  console.error('usage: verify-install.ts <package>...');
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), 'factory-verify-'));
writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'verify', private: true, version: '0.0.0' }));
execFileSync('npm', ['install', '--no-audit', '--no-fund', '--legacy-peer-deps', '--registry', registry, ...names], { cwd: dir, stdio: 'inherit' });
for (const n of names) {
  const entry = join(dir, 'node_modules', n, 'src', 'index.ts');
  if (!existsSync(entry)) {
    console.error(`${n}: not resolved (missing ${entry})`);
    process.exit(1);
  }
  console.log(`${n}: resolved from ${registry}`);
}
