import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attest, attestationDir, tarballName } from './attest.js';
import { provenanceErrors, provenanceFor, readProvenance, renderProvenance, writeProvenance } from './provenance.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function released() {
  const dir = mkdtempSync(join(tmpdir(), 'prov-pkg-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@factory/demo-nest', version: '1.2.3', files: ['src'] }));
  const store = mkdtempSync(join(tmpdir(), 'prov-store-'));
  const a = attest(dir, store, priv);
  const statement = provenanceFor({
    tarball: { name: 'demo.tgz', bytes: Buffer.from('tar') },
    pkgDir: dir,
    material: { name: 'demo', version: '1.2.3' },
    emitters: [{ id: 'nest-server', version: '0.0.0' }],
    commit: 'a'.repeat(40),
    finishedOn: '2026-01-01T00:00:00Z',
  });
  return { statement, store, a };
}

describe('provenance', () => {
  it('lists commit, material, emitters and output digests, and matches the schema', () => {
    const { statement } = released();
    expect(provenanceErrors(statement)).toEqual([]);
    const text = renderProvenance(statement);
    expect(text).toContain('demo@1.2.3');
    expect(text).toContain('a'.repeat(40));
    expect(text).toContain('nest-server@0.0.0');
    expect(text).toContain('src/a.ts');
  });

  it('rejects statements missing required fields', () => {
    const { statement } = released();
    const bad = JSON.parse(JSON.stringify(statement));
    delete bad.predicate.buildDefinition.externalParameters.material;
    bad.subject[0].digest.sha256 = 'xyz';
    expect(provenanceErrors(bad).length).toBeGreaterThanOrEqual(2);
    expect(provenanceErrors({})).not.toEqual([]);
  });

  it('is signed with the package key: reads back, fails when tampered or with another key', () => {
    const { statement, store, a } = released();
    writeProvenance(statement, a.tarball, priv);
    const ref = '@factory/demo-nest@1.2.3';
    expect(readProvenance(ref, store, pub).predicate.buildDefinition.externalParameters.material.name).toBe('demo');
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(() => readProvenance(ref, store, other)).toThrow(/signature/);
    writeFileSync(join(attestationDir(store, '@factory/demo-nest', '1.2.3'), `${tarballName('@factory/demo-nest', '1.2.3')}.provenance.json`), '{}\n');
    expect(() => readProvenance(ref, store, pub)).toThrow(/signature/);
    expect(() => readProvenance('@factory/none@1.0.0', store)).toThrow(/no provenance/);
  });
});
