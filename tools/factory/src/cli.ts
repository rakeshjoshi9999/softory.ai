import { assemble } from './assemble.js';
import { release } from './release.js';
import { validateFile } from './validate.js';

const [command, path] = process.argv.slice(2);

if (command === 'release' && path) {
  const published = release(path);
  console.log(published.length ? `published: ${published.join(', ')}` : 'nothing to publish');
  process.exit(0);
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
  console.error('usage: factory validate <path> | factory release <material> | factory assemble <product.yaml>');
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
