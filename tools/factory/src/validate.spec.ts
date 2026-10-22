import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from './cli.js';
import { validateFile, validateManifest } from './validate.js';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

describe('material.yaml schema', () => {
  it('accepts the architecture-doc example', () => {
    expect(validateFile(fixture('material/valid.yaml'))).toEqual({ valid: true, kind: 'Material', errors: [] });
  });

  it.each([
    ['invalid-type.yaml', '/metadata/type: must be one of model, api-contract'],
    ['invalid-missing-source.yaml', '/spec: missing required field "source"'],
    ['invalid-emitter-ref.yaml', '/spec/emitters/0: "ts-angular-client" is not valid'],
  ])('rejects %s', (file, message) => {
    const result = validateFile(fixture(`material/${file}`));
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain(message);
  });
});

describe('product.yaml schema', () => {
  it('accepts the architecture-doc example', () => {
    expect(validateFile(fixture('product/valid.yaml'))).toEqual({ valid: true, kind: 'Product', errors: [] });
  });

  it.each([
    ['invalid-api-version.yaml', '/apiVersion: must be "factory/v1" (got "factory/v2")'],
    ['invalid-missing-recipe.yaml', '/spec: missing required field "recipe"'],
    ['invalid-unknown-field.yaml', '/metadata: unknown field "team"'],
  ])('rejects %s', (file, message) => {
    const result = validateFile(fixture(`product/${file}`));
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain(message);
  });
});

describe('validateManifest', () => {
  it('rejects an unknown kind', () => {
    const result = validateManifest('apiVersion: factory/v1\nkind: Widget\n');
    expect(result.errors).toEqual(['(root): "kind" must be one of Material, Product (got "Widget")']);
  });

  it('reports YAML syntax errors', () => {
    const result = validateManifest('kind: [Material\n');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/^YAML syntax:/);
  });
});

describe('factory validate CLI', () => {
  const capture = (argv: string[]) => {
    const lines: string[] = [];
    const code = run(argv, (l) => lines.push(l), (l) => lines.push(l));
    return { code, output: lines.join('\n') };
  };

  it('exits 0 for a valid file', () => {
    const { code, output } = capture(['validate', fixture('product/valid.yaml')]);
    expect(code).toBe(0);
    expect(output).toContain('is a valid Product');
  });

  it('exits 1 with readable errors for an invalid file', () => {
    const { code, output } = capture(['validate', fixture('material/invalid-type.yaml')]);
    expect(code).toBe(1);
    expect(output).toContain('✗');
    expect(output).toContain('/metadata/type: must be one of');
  });

  it('exits 1 for a missing file', () => {
    expect(capture(['validate', fixture('nope.yaml')]).code).toBe(1);
  });

  it('exits 2 with usage when no path is given', () => {
    const { code, output } = capture(['validate']);
    expect(code).toBe(2);
    expect(output).toContain('Usage: factory validate');
  });
});
