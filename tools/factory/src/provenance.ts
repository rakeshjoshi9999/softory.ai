import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Ajv } from 'ajv';
import { attestationDir, signBlob, tarballName, verifyBlob } from './attest.js';

export interface EmitterRef {
  id: string;
  version: string;
}

export interface ProvenanceInput {
  /** Package tarball: the primary subject. */
  tarball: { name: string; bytes: Buffer };
  /** Package directory whose files are listed as further output digests. */
  pkgDir: string;
  material: { name: string; version: string };
  emitters: EmitterRef[];
  commit: string;
  finishedOn?: string;
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === 'node_modules' ? [] : listFiles(p)) : [p];
  });
}

/** in-toto Statement v1 with a SLSA provenance v1 predicate: which inputs produced this package. */
export function provenanceFor(input: ProvenanceInput) {
  const files = listFiles(input.pkgDir).sort();
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [
      { name: input.tarball.name, digest: { sha256: sha256(input.tarball.bytes) } },
      ...files.map((f) => ({ name: relative(input.pkgDir, f), digest: { sha256: sha256(readFileSync(f)) } })),
    ],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://factory.local/build/emit-and-release/v1',
        externalParameters: { material: input.material },
        resolvedDependencies: [
          { name: 'source', uri: 'git', digest: { gitCommit: input.commit } },
          ...input.emitters.map((e) => ({ name: `emitter:${e.id}`, digest: { version: e.version }, annotations: { id: e.id, version: e.version } })),
        ],
      },
      runDetails: { builder: { id: 'https://factory.local/builder/factory-release' }, metadata: { finishedOn: input.finishedOn ?? new Date().toISOString() } },
    },
  };
}

export type Provenance = ReturnType<typeof provenanceFor>;

const schema = JSON.parse(readFileSync(new URL('../../schemas/provenance.schema.json', import.meta.url), 'utf8')) as object;
const validateShape = new Ajv({ allErrors: true }).compile(schema);

/** Returns schema errors; empty when the statement is well formed. */
export function provenanceErrors(statement: unknown): string[] {
  validateShape(statement);
  return (validateShape.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
}

export function emitterRef(id: string, root = '.'): EmitterRef {
  const file = join(root, 'emitters', id, 'package.json');
  const version = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version : 'unknown';
  return { id, version };
}

export function gitCommit(cwd = '.'): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, stdio: 'pipe' }).toString().trim();
}

/** Writes `<tarball>.provenance.json` and a detached `.sig` made with the package signing key. */
export function writeProvenance(statement: Provenance, tarballPath: string, privateKeyPem: string): { statement: string; sig: string } {
  const out = `${tarballPath}.provenance.json`;
  const text = JSON.stringify(statement, null, 2) + '\n';
  writeFileSync(out, text);
  writeFileSync(`${out}.sig`, signBlob(Buffer.from(text), privateKeyPem) + '\n');
  return { statement: out, sig: `${out}.sig` };
}

export function renderProvenance(s: Provenance): string {
  const d = s.predicate.buildDefinition;
  const commit = d.resolvedDependencies.find((r) => r.name === 'source')?.digest;
  const lines = [
    `package:   ${s.subject[0]!.name} (sha256 ${s.subject[0]!.digest.sha256})`,
    `material:  ${d.externalParameters.material.name}@${d.externalParameters.material.version}`,
    `commit:    ${(commit as { gitCommit?: string } | undefined)?.gitCommit ?? 'unknown'}`,
    'emitters:',
    ...d.resolvedDependencies.filter((r) => r.name.startsWith('emitter:')).map((r) => `  ${(r as { annotations?: EmitterRef }).annotations?.id}@${(r as { annotations?: EmitterRef }).annotations?.version}`),
    `built by:  ${s.predicate.runDetails.builder.id} at ${s.predicate.runDetails.metadata.finishedOn}`,
    `outputs (${s.subject.length - 1} files):`,
    ...s.subject.slice(1).map((o) => `  ${o.digest.sha256.slice(0, 12)}  ${o.name}`),
  ];
  return lines.join('\n');
}

/** Reads and checks the stored statement for `name@version`; the signature is verified when a public key is given. */
export function readProvenance(ref: string, store: string, publicKeyPem?: string): Provenance {
  const at = ref.lastIndexOf('@');
  if (at <= 0) throw new Error(`expected <package>@<version>, got "${ref}"`);
  const name = ref.slice(0, at);
  const version = ref.slice(at + 1);
  const file = join(attestationDir(store, name, version), `${tarballName(name, version)}.provenance.json`);
  if (!existsSync(file)) throw new Error(`${ref}: no provenance statement at ${file}`);
  const text = readFileSync(file);
  if (publicKeyPem && !verifyBlob(text, readFileSync(`${file}.sig`, 'utf8'), publicKeyPem)) {
    throw new Error(`${ref}: provenance signature does not match (tampered or wrong key)`);
  }
  const statement = JSON.parse(text.toString('utf8')) as Provenance;
  const errors = provenanceErrors(statement);
  if (errors.length) throw new Error(`${ref}: malformed provenance: ${errors.join('; ')}`);
  return statement;
}
