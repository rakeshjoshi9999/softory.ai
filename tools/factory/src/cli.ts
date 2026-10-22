import { validateFile } from './validate.js';

const usage = 'Usage: factory validate <file> [more files...]';

export const run = (argv: string[], out = console.log, err = console.error): number => {
  const [command, ...paths] = argv;
  if (command !== 'validate' || paths.length === 0) {
    err(usage);
    return 2;
  }
  let failed = 0;
  for (const path of paths) {
    const result = validateFile(path);
    if (result.valid) {
      out(`✓ ${path} is a valid ${result.kind}`);
    } else {
      failed++;
      err(`✗ ${path}${result.kind ? ` (${result.kind})` : ''}`);
      for (const e of result.errors) err(`  - ${e}`);
    }
  }
  return failed === 0 ? 0 : 1;
};

