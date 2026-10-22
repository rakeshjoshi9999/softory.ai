import type { Tree } from '@nx/devkit';
import { renderTemplates } from './templates.js';

export interface AngularRemoteOptions {
  name: string;
  directory?: string;
  scope?: string;
}

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Pure: relative path -> file content. Deterministic for the same options. */
export function renderRemote(options: AngularRemoteOptions): Record<string, string> {
  if (!NAME.test(options.name)) {
    throw new Error(`Invalid remote name "${options.name}": use kebab-case`);
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

export default function angularRemoteGenerator(tree: Tree, options: AngularRemoteOptions): void {
  const directory = options.directory ?? `products/${options.name}`;
  for (const [path, content] of Object.entries(renderRemote(options))) {
    tree.write(`${directory}/${path}`, content);
  }
}
