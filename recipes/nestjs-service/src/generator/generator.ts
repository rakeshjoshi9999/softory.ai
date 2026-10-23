import type { Tree } from '@nx/devkit';
import { renderTemplates } from './templates.js';

export interface NestjsServiceOptions {
  name: string;
  directory?: string;
  scope?: string;
}

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Pure: relative path -> file content. Deterministic for the same options. */
export function renderService(options: NestjsServiceOptions): Record<string, string> {
  if (!NAME.test(options.name)) {
    throw new Error(`Invalid service name "${options.name}": use kebab-case`);
  }
  const directory = options.directory ?? `products/${options.name}`;
  const depth = directory.split('/').filter(Boolean).length;
  return renderTemplates({
    name: options.name,
    scope: options.scope ?? 'factory',
    directory,
    rootRelative: '../'.repeat(depth),
  });
}

export default function nestjsServiceGenerator(tree: Tree, options: NestjsServiceOptions): void {
  const directory = options.directory ?? `products/${options.name}`;
  for (const [path, content] of Object.entries(renderService(options))) {
    tree.write(`${directory}/${path}`, content);
  }
}
