import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attest, sbomFor, signBlob, tarballName, verifyBlob, verifyPackage } from './attest.js';

// Test-only keys, generated per run. Real keys come from FACTORY_SIGNING_KEY and are never committed.
const keys = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
};

function pkgDir() {
  const dir = mkdtempSync(join(tmpdir(), 'attest-pkg-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@factory/demo-nest', version: '1.2.3', license: 'MIT', dependencies: { rxjs: '^7' }, files: ['src'] }));
  return dir;
}

describe('attest with a relative store', () => {
  it('writes into the store relative to the working directory, not the package directory', () => {
    const pkg = pkgDir();
    const store = relative(process.cwd(), mkdtempSync(join(process.cwd(), 'tmp-attest-rel-')));
    try {
      const out = attest(pkg, store, keys().priv);
      expect(existsSync(out.tarball)).toBe(true);
      expect(existsSync(join(pkg, store))).toBe(false);
    } finally {
      rmSync(store, { recursive: true, force: true });
    }
  });
});

describe('sign / verify', () => {
  it('accepts the signed bytes, rejects other bytes and other keys', () => {
    const k = keys();
    const blob = Buffer.from('tarball');
    const sig = signBlob(blob, k.priv);
    expect(verifyBlob(blob, sig, k.pub)).toBe(true);
    expect(verifyBlob(Buffer.from('tampered'), sig, k.pub)).toBe(false);
    expect(verifyBlob(blob, sig, keys().pub)).toBe(false);
    expect(verifyBlob(blob, 'not-a-signature', k.pub)).toBe(false);
  });
});

describe('sbom', () => {
  it('is SPDX 2.3 listing the package, its dependencies and file checksums', () => {
    const sbom = sbomFor(pkgDir(), Buffer.from('x'), '2026-01-01T00:00:00Z');
    expect(sbom.spdxVersion).toBe('SPDX-2.3');
    expect(sbom.packages.map((p) => p.name)).toEqual(['@factory/demo-nest', 'rxjs']);
    expect(sbom.files.map((f) => f.fileName)).toContain('src/a.ts');
  });
});

describe('verifyPackage against a fake registry', () => {
  const k = keys();
  let server: Server;
  let registry: string;
  let served = Buffer.alloc(0);
  const store = mkdtempSync(join(tmpdir(), 'attest-store-'));

  beforeAll(async () => {
    const out = attest(pkgDir(), store, k.priv);
    expect(out.tarball.endsWith(tarballName('@factory/demo-nest', '1.2.3'))).toBe(true);
    expect(JSON.parse(readFileSync(out.sbom, 'utf8')).spdxVersion).toBe('SPDX-2.3');
    served = readFileSync(out.tarball);
    server = createServer((req, res) => {
      if (req.url?.endsWith('.tgz')) return void res.end(served);
      const port = (server.address() as AddressInfo).port;
      res.end(JSON.stringify({ versions: { '1.2.3': { dist: { tarball: `http://127.0.0.1:${port}/demo.tgz` } } } }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => server.close());

  it('verifies the published tarball', async () => {
    await expect(verifyPackage('@factory/demo-nest@1.2.3', { registry, store, publicKeyPem: k.pub })).resolves.toMatch(/signature ok/);
  });

  it('fails when the tarball was tampered with', async () => {
    const original = served;
    served = Buffer.concat([original, Buffer.from('evil')]);
    await expect(verifyPackage('@factory/demo-nest@1.2.3', { registry, store, publicKeyPem: k.pub })).rejects.toThrow(/tampered/);
    served = original;
  });

  it('fails for unknown versions and wrong keys', async () => {
    await expect(verifyPackage('@factory/demo-nest@9.9.9', { registry, store, publicKeyPem: k.pub })).rejects.toThrow(/not published/);
    await expect(verifyPackage('@factory/demo-nest@1.2.3', { registry, store, publicKeyPem: keys().pub })).rejects.toThrow(/tampered|wrong key/);
  });
});
