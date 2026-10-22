import { readFileSync } from 'node:fs';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { parseDocument } from 'yaml';

export type ManifestKind = 'Material' | 'Product';

export interface ValidationResult {
  valid: boolean;
  kind?: ManifestKind;
  errors: string[];
}

const schemaFiles: Record<ManifestKind, string> = {
  Material: 'material.schema.json',
  Product: 'product.schema.json',
};

const loadSchema = (file: string): object =>
  JSON.parse(readFileSync(new URL(`../../schemas/${file}`, import.meta.url), 'utf8')) as object;

const ajv = new Ajv({ allErrors: true, verbose: true });
const validators = Object.fromEntries(
  Object.entries(schemaFiles).map(([kind, file]) => [kind, ajv.compile(loadSchema(file))]),
) as Record<ManifestKind, ValidateFunction>;

const isKind = (value: unknown): value is ManifestKind =>
  typeof value === 'string' && Object.hasOwn(schemaFiles, value);

const formatError = (e: ErrorObject): string => {
  const where = e.instancePath || '(root)';
  switch (e.keyword) {
    case 'additionalProperties':
      return `${where}: unknown field "${String(e.params['additionalProperty'])}"`;
    case 'required':
      return `${where}: missing required field "${String(e.params['missingProperty'])}"`;
    case 'enum':
      return `${where}: must be one of ${(e.params['allowedValues'] as unknown[]).join(', ')} (got ${JSON.stringify(e.data)})`;
    case 'const':
      return `${where}: must be ${JSON.stringify(e.params['allowedValue'])} (got ${JSON.stringify(e.data)})`;
    case 'pattern': {
      const hint = (e.parentSchema as { description?: string } | undefined)?.description;
      return `${where}: ${JSON.stringify(e.data)} is not valid${hint ? ` — ${hint}` : ''}`;
    }
    default:
      return `${where}: ${e.message ?? 'is invalid'}`;
  }
};

/** Validate the text of a material.yaml or product.yaml; the schema is picked from `kind`. */
export const validateManifest = (text: string): ValidationResult => {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    return { valid: false, errors: doc.errors.map((e) => `YAML syntax: ${e.message}`) };
  }
  const data: unknown = doc.toJS();
  const kind = (data as { kind?: unknown } | null)?.kind;
  if (!isKind(kind)) {
    return {
      valid: false,
      errors: [`(root): "kind" must be one of ${Object.keys(schemaFiles).join(', ')} (got ${JSON.stringify(kind)})`],
    };
  }
  const validate = validators[kind];
  if (validate(data)) return { valid: true, kind, errors: [] };
  const errors = [...new Set((validate.errors ?? []).map(formatError))];
  return { valid: false, kind, errors };
};

export const validateFile = (path: string): ValidationResult => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { valid: false, errors: [`cannot read file: ${(err as Error).message}`] };
  }
  return validateManifest(text);
};
