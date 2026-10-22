import { validateFile } from './validate.js';

const [command, path] = process.argv.slice(2);

if (command !== 'validate' || !path) {
  console.error('usage: factory validate <path>');
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
