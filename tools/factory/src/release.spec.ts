import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attestationDir, tarballName } from './attest.js';
import { type NpmRunner, packagesFor, pendingChangesets, readVersion, release, stage } from './release.js';

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'release-spec-'));
  for (const p of packagesFor('demo', root)) {
    mkdirSync(p.source, { recursive: true });
    mkdirSync(p.dir, { recursive: true });
    writeFileSync(join(p.source, 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ name: p.name, version: '2.3.4' }));
  }
  return root;
}

describe('release', () => {
  it('names the angular and nest packages after the material', () => {
    expect(packagesFor('orders-api').map((p) => p.name)).toEqual(['@factory/orders-api-angular', '@factory/orders-api-nest']);
  });

  it('stages emitter output into each package src, with an index for the angular client', () => {
    const root = workspace();
    const [angular, nest] = packagesFor('demo', root);
    stage(angular);
    stage(nest);
    expect(existsSync(join(angular.dir, 'src', 'a.ts'))).toBe(true);
    expect(readFileSync(join(angular.dir, 'src', 'index.ts'), 'utf8')).toContain("export * from './models/index';");
    expect(existsSync(join(nest.dir, 'src', 'a.ts'))).toBe(true);
    expect(readVersion(nest)).toBe('2.3.4');
  });

  it('fails when the emitter has not run', () => {
    const [angular] = packagesFor('missing', mkdtempSync(join(tmpdir(), 'release-spec-')));
    expect(() => stage(angular)).toThrow(/emit targets/);
  });

  it('detects pending changesets but ignores the README', () => {
    const root = workspace();
    mkdirSync(join(root, '.changeset'));
    writeFileSync(join(root, '.changeset', 'README.md'), 'x');
    expect(pendingChangesets(root)).toBe(false);
    writeFileSync(join(root, '.changeset', 'brave-lions.md'), '---\n---\n');
    expect(pendingChangesets(root)).toBe(true);
  });

  describe('release()', () => {
    const key = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    function repo() {
      const root = workspace();
      mkdirSync(join(root, 'dist'), { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: root });
      execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: root });
      return root;
    }
    /** Fake npm: records publish calls; `view` reports the versions in `published`. */
    function fakeNpm(published: string[] = []) {
      const calls: string[][] = [];
      const run: NpmRunner = (args) => {
        calls.push(args);
        if (args[0] === 'view' && !published.includes(args[1]!)) throw new Error('E404');
      };
      return { calls, run, publishes: () => calls.filter((c) => c[0] === 'publish') };
    }

    it('rejects a bad signing key before packing or publishing anything', () => {
      const root = repo();
      const npm = fakeNpm();
      expect(() => release('demo', { root, store: join(root, 'store'), signingKey: 'not a key', npm: npm.run })).toThrow(/FACTORY_SIGNING_KEY/);
      const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      expect(() => release('demo', { root, store: join(root, 'store'), signingKey: rsa, npm: npm.run })).toThrow(/P-256/);
      expect(npm.calls).toEqual([]);
      expect(existsSync(join(root, 'store'))).toBe(false);
      expect(existsSync(join(packagesFor('demo', root)[0]!.dir, 'src'))).toBe(false);
    });

    it('publishes the exact tarball that was signed', () => {
      const root = repo();
      const store = join(root, 'store');
      const npm = fakeNpm();
      const refs = release('demo', { root, store, signingKey: key(), npm: npm.run });
      expect(refs).toEqual(['@factory/demo-angular@2.3.4', '@factory/demo-nest@2.3.4']);
      expect(npm.publishes()).toHaveLength(2);
      for (const pkg of packagesFor('demo', root)) {
        const tgz = join(attestationDir(store, pkg.name, '2.3.4'), tarballName(pkg.name, '2.3.4'));
        const publish = npm.publishes().find((c) => c[1] === tgz);
        expect(publish, `publish of ${tgz}`).toBeDefined();
        for (const ext of ['.sig', '.sbom.spdx.json', '.provenance.json', '.provenance.json.sig']) expect(existsSync(tgz + ext)).toBe(true);
        expect(readFileSync(tgz).length).toBeGreaterThan(0);
      }
      // publish never runs from the package directory (which would re-pack different bytes)
      expect(npm.publishes().every((c) => c[1]!.endsWith('.tgz'))).toBe(true);
    });

    it('publishes nothing when attestation of any package fails', () => {
      const root = repo();
      const [, nest] = packagesFor('demo', root);
      writeFileSync(join(nest!.dir, 'package.json'), '{ not json');
      const npm = fakeNpm();
      expect(() => release('demo', { root, store: join(root, 'store'), signingKey: key(), npm: npm.run })).toThrow();
      expect(npm.publishes()).toEqual([]);
    });

    it('reports a published version that has no attestations instead of skipping it', () => {
      const root = repo();
      const store = join(root, 'store');
      const npm = fakeNpm(['@factory/demo-angular@2.3.4']);
      expect(() => release('demo', { root, store, signingKey: key(), npm: npm.run })).toThrow(/published but unsigned.*demo-angular-2\.3\.4\.tgz/);
      expect(npm.publishes()).toEqual([]);
    });

    it('skips a published version whose attestations exist, and is idempotent', () => {
      const root = repo();
      const store = join(root, 'store');
      const k = key();
      release('demo', { root, store, signingKey: k, npm: fakeNpm().run });
      const again = fakeNpm(['@factory/demo-angular@2.3.4', '@factory/demo-nest@2.3.4']);
      expect(release('demo', { root, store, signingKey: k, npm: again.run })).toEqual([]);
      expect(again.publishes()).toEqual([]);
      rmSync(store, { recursive: true });
      expect(() => release('demo', { root, store, signingKey: k, npm: again.run })).toThrow(/unsigned/);
    });
  });
});
