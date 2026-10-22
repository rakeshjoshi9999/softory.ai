import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const lint = async (filePath: string, code: string) => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages.map((m) => m.ruleId) ?? [];
};

describe('module boundaries', () => {
  it('rejects a product importing an emitter', async () => {
    const rules = await lint(
      'products/sample-product/src/index.ts',
      "import { emitterId } from '@factory/sample-emitter';\nexport const x = emitterId;\n",
    );
    expect(rules).toContain('@nx/enforce-module-boundaries');
  });

  it('allows a product with no forbidden imports', async () => {
    const rules = await lint('products/sample-product/src/index.ts', "export const x = 1;\n");
    expect(rules).not.toContain('@nx/enforce-module-boundaries');
  });
});
