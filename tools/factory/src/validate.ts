import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { parse } from 'yaml';

const schemaDir = new URL('../../schemas/', import.meta.url);
const loadSchema = (file: string): object => JSON.parse(readFileSync(new URL(file, schemaDir), 'utf8'));

const schemas: Record<string, object> = {
  Material: loadSchema('material.schema.json'),
  Product: loadSchema('product.schema.json'),
};

const ajv = new Ajv({ allErrors: true });

export interface ValidationResult {
  ok: boolean;
  kind?: string;
  errors: string[];
}

export function validateDocument(text: string): ValidationResult {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    return { ok: false, errors: [`invalid YAML: ${(e as Error).message}`] };
  }
  const kind = typeof doc === 'object' && doc !== null ? (doc as { kind?: unknown }).kind : undefined;
  const schema = typeof kind === 'string' ? schemas[kind] : undefined;
  if (!schema) {
    return { ok: false, errors: [`"kind" must be one of: ${Object.keys(schemas).join(', ')}`] };
  }
  const validate = ajv.compile(schema);
  if (validate(doc)) return { ok: true, kind: kind as string, errors: [] };
  const errors = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
  return { ok: false, kind: kind as string, errors };
}

export function validateFile(path: string): ValidationResult {
  try {
    return validateDocument(readFileSync(path, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`cannot read ${path}: ${(e as Error).message}`] };
  }
}
