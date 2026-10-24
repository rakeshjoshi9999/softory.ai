import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

/** Where signatures and SBOMs live, next to the registry's tarballs (Verdaccio cannot serve extra files). */
export function attestationDir(store: string, name: string, version: string): string {
  return join(store, name, version);
}

export function tarballName(name: string, version: string): string {
  return `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/**
 * ECDSA P-256 / SHA-256 over the tarball bytes, base64 DER: the format `cosign sign-blob` writes,
 * so `cosign verify-blob --key` accepts it. The key is a PKCS#8 PEM, normally from FACTORY_SIGNING_KEY.
 */
export function signBlob(blob: Buffer, privateKeyPem: string): string {
  return sign('sha256', blob, createPrivateKey(privateKeyPem)).toString('base64');
}

export function verifyBlob(blob: Buffer, signature: string, publicKeyPem: string): boolean {
  try {
    return verify('sha256', blob, createPublicKey(publicKeyPem), Buffer.from(signature.trim(), 'base64'));
  } catch {
    return false;
  }
}

/** Throws unless `pem` is an ECDSA P-256 private key that signs and verifies a probe. */
export function validateSigningKey(pem: string): void {
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('not an ECDSA P-256 key');
    const probe = Buffer.from('factory-key-probe');
    if (!verifyBlob(probe, signBlob(probe, pem), createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString())) throw new Error('probe signature failed');
  } catch (e) {
    throw new Error(`FACTORY_SIGNING_KEY is not a usable ECDSA P-256 PKCS#8 PEM: ${(e as Error).message}`);
  }
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === 'node_modules' ? [] : listFiles(p)) : [p];
  });
}

/** SPDX 2.3 JSON for a package directory (Syft is the CI path; this keeps release working offline). */
export function sbomFor(pkgDir: string, tarball: Buffer, created = new Date().toISOString()) {
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
    license?: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const files = listFiles(pkgDir).sort();
  const deps = { ...pkg.peerDependencies, ...pkg.dependencies };
  const root = 'SPDXRef-Package';
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `${pkg.name}@${pkg.version}`,
    documentNamespace: `https://factory.local/spdx/${pkg.name}/${pkg.version}/${sha256(tarball).slice(0, 16)}`,
    creationInfo: { created, creators: ['Tool: factory-release'] },
    packages: [
      {
        SPDXID: root,
        name: pkg.name,
        versionInfo: pkg.version,
        downloadLocation: 'NOASSERTION',
        filesAnalyzed: true,
        licenseConcluded: pkg.license ?? 'NOASSERTION',
        checksums: [{ algorithm: 'SHA256', checksumValue: sha256(tarball) }],
      },
      ...Object.entries(deps).map(([n, range], i) => ({
        SPDXID: `SPDXRef-Dep-${i}`,
        name: n,
        versionInfo: range,
        downloadLocation: 'NOASSERTION',
        filesAnalyzed: false,
      })),
    ],
    files: files.map((f, i) => ({
      SPDXID: `SPDXRef-File-${i}`,
      fileName: relative(pkgDir, f),
      checksums: [{ algorithm: 'SHA256', checksumValue: sha256(readFileSync(f)) }],
    })),
    relationships: [
      { spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: root },
      ...Object.keys(deps).map((_, i) => ({ spdxElementId: root, relationshipType: 'DEPENDS_ON', relatedSpdxElement: `SPDXRef-Dep-${i}` })),
    ],
  };
}

/** Packs `pkgDir`, writes `<tarball>.sbom.spdx.json` and `<tarball>.sig` into the store; returns their paths. */
export function attest(pkgDir: string, store: string, privateKeyPem: string): { tarball: string; sbom: string; sig: string } {
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { name: string; version: string };
  // npm runs with cwd = pkgDir, so a relative store would otherwise be created in one place and packed into another.
  const dir = resolve(attestationDir(store, pkg.name, pkg.version));
  mkdirSync(dir, { recursive: true });
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', dir], { cwd: pkgDir, stdio: 'pipe' }).toString()) as { filename: string }[];
  const tarball = join(dir, basename(packed[0]!.filename));
  const bytes = readFileSync(tarball);
  const sbom = `${tarball}.sbom.spdx.json`;
  const sig = `${tarball}.sig`;
  writeFileSync(sbom, JSON.stringify(sbomFor(pkgDir, bytes), null, 2) + '\n');
  writeFileSync(sig, signBlob(bytes, privateKeyPem) + '\n');
  return { tarball, sbom, sig };
}

export interface VerifyOptions {
  registry: string;
  store: string;
  publicKeyPem: string;
}

/** Fetches `name@version` from the registry and checks it against the stored signature. Throws on any failure. */
export async function verifyPackage(ref: string, opts: VerifyOptions): Promise<string> {
  const at = ref.lastIndexOf('@');
  if (at <= 0) throw new Error(`expected <package>@<version>, got "${ref}"`);
  const name = ref.slice(0, at);
  const version = ref.slice(at + 1);
  const doc = await fetch(`${opts.registry.replace(/\/?$/, '/')}${name.replace('/', '%2f')}`);
  if (!doc.ok) throw new Error(`${name}: registry answered ${doc.status}`);
  const meta = (await doc.json()) as { versions?: Record<string, { dist: { tarball: string } }> };
  const entry = meta.versions?.[version];
  if (!entry) throw new Error(`${ref}: not published`);
  const sigFile = join(attestationDir(opts.store, name, version), `${tarballName(name, version)}.sig`);
  if (!existsSync(sigFile)) throw new Error(`${ref}: no signature at ${sigFile}`);
  const res = await fetch(entry.dist.tarball);
  if (!res.ok) throw new Error(`${ref}: tarball download answered ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!verifyBlob(bytes, readFileSync(sigFile, 'utf8'), opts.publicKeyPem)) {
    throw new Error(`${ref}: signature does not match the tarball (tampered or wrong key)`);
  }
  return `${ref}: signature ok (sha256 ${sha256(bytes).slice(0, 12)})`;
}
