import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assemble, assertSafeTarball, parseRef, resolvePackage } from './assemble.js';

const scratch = mkdtempSync(join(tmpdir(), 'assemble-spec-'));
let server: Server;
let registry: string;
let tarball: Buffer;

beforeAll(async () => {
  const pkgDir = join(scratch, 'pkg', 'package');
  mkdirSync(join(pkgDir, 'src'), { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), '{"name":"@factory/orders-api-nest","version":"1.2.0"}');
  writeFileSync(join(pkgDir, 'src', 'index.ts'), 'export const marker = 1;\n');
  execFileSync('tar', ['-czf', join(scratch, 'pkg.tgz'), '-C', join(scratch, 'pkg'), 'package']);
  tarball = readFileSync(join(scratch, 'pkg.tgz'));
  server = createServer((req, res) => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (req.url === '/pkg.tgz') return void res.end(tarball);
    if (req.url === '/@factory%2forders-api-nest') {
      const dist = (tb: string, integrity?: string) => ({ dist: { tarball: tb, integrity } });
      const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
      return void res.end(JSON.stringify({ versions: { '1.0.0': dist(`${base}/pkg.tgz`, 'sha512-bad'), '1.2.0': dist(`${base}/pkg.tgz`, integrity), '2.0.0': dist(`${base}/pkg.tgz`) } }));
    }
    if (req.url === '/@factory%2forders-api-angular') {
      const bad = { dist: { tarball: `${base}/pkg.tgz` }, deprecated: 'RECALLED: wrong totals' };
      const sha = { dist: { tarball: `${base}/pkg.tgz`, shasum: createHash('sha1').update(tarball).digest('hex') } };
      return void res.end(JSON.stringify({ versions: { '1.0.0': sha, '1.0.1': bad } }));
    }
    if (req.url === '/@factory%2fforeign') {
      return void res.end(JSON.stringify({ versions: { '1.0.0': { dist: { tarball: 'http://evil.example/pkg.tgz', shasum: 'x' } } } }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(() => void server.close());

function workspace(consumes = 'orders-api@^1') {
  const root = mkdtempSync(join(scratch, 'ws-'));
  const gen = join(root, 'recipes', 'nestjs-service', 'src', 'generator');
  mkdirSync(gen, { recursive: true });
  writeFileSync(
    join(gen, 'generator.ts'),
    `export default (tree: { write(p: string, c: string): void }, o: { name: string }) => {
  tree.write('products/' + o.name + '/package.json', '{"name":"' + o.name + '"}');
  tree.write('products/' + o.name + '/src/ext/index.ts', 'export {};\\n');
};\n`,
  );
  const dir = join(root, 'products', 'svc');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'product.yaml'),
    `apiVersion: factory/v1\nkind: Product\nmetadata: { name: svc, owner: team }\nspec:\n  recipe: nestjs-service@1\n  consumes:\n    api: ${consumes}\n`,
  );
  return { root, dir, manifest: join(dir, 'product.yaml') };
}

describe('assemble', () => {
  it('parses name@range references', () => {
    expect(parseRef('orders-api@^1.2')).toEqual({ name: 'orders-api', range: '^1.2' });
  });

  it('resolves the highest satisfying version', async () => {
    expect((await resolvePackage(registry, '@factory/orders-api-nest', '^1')).version).toBe('1.2.0');
    await expect(resolvePackage(registry, '@factory/orders-api-nest', '^3')).rejects.toThrow(/no published version/);
    await expect(resolvePackage(registry, '@factory/missing', '^1')).rejects.toThrow(/404/);
  });

  it('refuses a recalled version and prints the reason', async () => {
    await expect(resolvePackage(registry, '@factory/orders-api-angular', '^1')).rejects.toThrow(/1\.0\.1 was recalled: wrong totals/);
    expect((await resolvePackage(registry, '@factory/orders-api-angular', '1.0.0')).version).toBe('1.0.0');
  });

  it('rejects a version whose metadata has no usable integrity', async () => {
    await expect(resolvePackage(registry, '@factory/orders-api-nest', '2.0.0')).rejects.toThrow(/no sha512 integrity or shasum/);
  });

  it('rejects a tarball URL on a foreign origin', async () => {
    await expect(resolvePackage(registry, '@factory/foreign', '^1')).rejects.toThrow(/not on the registry origin/);
  });

  it('rejects tarballs with symlinks, hardlinks, absolute paths or .. segments', () => {
    const make = (name: string, setup: (dir: string) => void, args: string[] = []) => {
      const dir = join(scratch, name);
      mkdirSync(join(dir, 'package'), { recursive: true });
      setup(join(dir, 'package'));
      const file = join(dir, 'x.tgz');
      execFileSync('tar', ['-czf', file, ...args, '-C', dir, 'package']);
      return file;
    };
    const sym = make('sym', (d) => symlinkSync('/etc/passwd', join(d, 'link')));
    expect(() => assertSafeTarball(sym, 'p')).toThrow(/link/);
    const hard = make('hard', (d) => {
      writeFileSync(join(d, 'a'), 'a');
      execFileSync('ln', [join(d, 'a'), join(d, 'b')]);
    });
    expect(() => assertSafeTarball(hard, 'p')).toThrow(/link/);
    const abs = make('abs', (d) => writeFileSync(join(d, 'a'), 'a'), ['-P', '--transform=s,^package/a,/tmp/abs-evil,']);
    expect(() => assertSafeTarball(abs, 'p')).toThrow(/unsafe path/);
    const dots = make('dots', (d) => writeFileSync(join(d, 'a'), 'a'), ['--transform=s,^package/a,package/../evil,']);
    expect(() => assertSafeTarball(dots, 'p')).toThrow(/unsafe path/);
    expect(() => assertSafeTarball(join(scratch, 'pkg.tgz'), 'p')).not.toThrow();
  });

  it('runs the recipe, locks versions and installs the package', async () => {
    const ws = workspace();
    const r = await assemble(ws.manifest, { root: ws.root, registry });
    expect(r.installed).toEqual(['@factory/orders-api-nest@1.2.0']);
    expect(readFileSync(join(ws.dir, 'package.json'), 'utf8')).toContain('"svc"');
    expect(JSON.parse(readFileSync(join(ws.dir, 'product.lock.json'), 'utf8')).packages).toEqual({ '@factory/orders-api-nest': '1.2.0' });
    expect(readFileSync(join(ws.dir, 'node_modules/@factory/orders-api-nest/src/index.ts'), 'utf8')).toContain('marker');
  });

  it('is idempotent and never overwrites hand-written src/ext', async () => {
    const ws = workspace();
    await assemble(ws.manifest, { root: ws.root, registry });
    writeFileSync(join(ws.dir, 'src/ext/index.ts'), 'export const mine = 1;\n');
    const again = await assemble(ws.manifest, { root: ws.root, registry });
    expect(again.written).toEqual([]);
    expect(readFileSync(join(ws.dir, 'src/ext/index.ts'), 'utf8')).toBe('export const mine = 1;\n');
  });

  it('fails on an unsatisfiable range, a failed integrity check and an invalid manifest', async () => {
    const ws = workspace('orders-api@^3');
    await expect(assemble(ws.manifest, { root: ws.root, registry })).rejects.toThrow(/no published version/);
    const bad = workspace('orders-api@1.0.0');
    await expect(assemble(bad.manifest, { root: bad.root, registry })).rejects.toThrow(/integrity/);
    writeFileSync(ws.manifest, 'kind: Nope\n');
    await expect(assemble(ws.manifest, { root: ws.root, registry })).rejects.toThrow(/not a valid Product/);
  });
});
