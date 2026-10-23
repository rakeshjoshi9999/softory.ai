import { assemble } from './assemble.js';
import { verifyPackage } from './attest.js';
import { readProvenance, renderProvenance } from './provenance.js';
import { DEFAULT_REGISTRY, release } from './release.js';
import { validateFile } from './validate.js';

const [command, path] = process.argv.slice(2);

if (command === 'release' && path) {
  const published = release(path);
  console.log(published.length ? `published: ${published.join(', ')}` : 'nothing to publish');
  process.exit(0);
}

if (command === 'verify' && path) {
  try {
    const keyPem = process.env['FACTORY_VERIFY_KEY'];
    if (!keyPem) throw new Error('FACTORY_VERIFY_KEY (public key PEM) is required');
    console.log(
      await verifyPackage(path, {
        registry: process.env['FACTORY_REGISTRY'] ?? DEFAULT_REGISTRY,
        store: process.env['FACTORY_ATTESTATION_STORE'] ?? 'dist/attestations',
        publicKeyPem: keyPem,
      }),
    );
    process.exit(0);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

if (command === 'provenance' && path) {
  try {
    const store = process.env['FACTORY_ATTESTATION_STORE'] ?? 'dist/attestations';
    console.log(renderProvenance(readProvenance(path, store, process.env['FACTORY_VERIFY_KEY'])));
    process.exit(0);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

if (command === 'assemble' && path) {
  try {
    const r = await assemble(path);
    console.log(`${r.product}: wrote ${r.written.length} file(s), ${r.unchanged} unchanged; installed ${r.installed.join(', ') || 'no packages'}`);
    process.exit(0);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

if (command !== 'validate' || !path) {
  console.error('usage: factory validate <path> | factory release <material> | factory verify <package>@<version> | factory provenance <package>@<version> | factory assemble <product.yaml>');
  process.exit(2);
}

const result = validateFile(path);
if (result.ok) {
  console.log(`${path}: valid ${result.kind}`);
} else {
  console.error(`${path}: INVALID`);
  for (const e of result.errors) console.error(`  - ${e}`);
  process.exit(1);
}
