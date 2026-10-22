import { resolve } from 'node:path';
import { emit } from '../../emitter.js';

export interface EmitExecutorOptions {
  input: string;
  output: string;
}

export default async function runExecutor(options: EmitExecutorOptions, context: { root: string }) {
  try {
    const result = await emit({ input: resolve(context.root, options.input), output: resolve(context.root, options.output) });
    console.log(`${result.emitter.id}@${result.emitter.version}: wrote ${result.files.length} files to ${options.output}`);
    return { success: true };
  } catch (e) {
    console.error(e);
    return { success: false };
  }
}
