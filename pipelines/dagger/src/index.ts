import { dag, Container, Directory, func, object } from '@dagger.io/dagger';
import { blockCommand, ciCommands } from './plan.js';

const NODE_IMAGE = 'node:22-bookworm';

@object()
export class Factory {
  /** Node + pnpm container with the workspace mounted and dependencies installed. */
  @func()
  workspace(src: Directory): Container {
    return dag
      .container()
      .from(NODE_IMAGE)
      .withExec(['corepack', 'enable'])
      .withMountedCache('/root/.local/share/pnpm/store', dag.cacheVolume('pnpm-store'))
      .withDirectory('/work', src, { exclude: ['node_modules', '.nx', 'dist'] })
      .withWorkdir('/work')
      .withExec(['pnpm', 'install', '--frozen-lockfile']);
  }

  /** Lint (all projects, or affected ones when `base` is given). */
  @func()
  async lint(src: Directory, base?: string): Promise<string> {
    return this.workspace(src).withExec(blockCommand('lint', base)).stdout();
  }

  /** Unit tests. */
  @func()
  async test(src: Directory, base?: string): Promise<string> {
    return this.workspace(src).withExec(blockCommand('test', base)).stdout();
  }

  /** Build. */
  @func()
  async build(src: Directory, base?: string): Promise<string> {
    return this.workspace(src).withExec(blockCommand('build', base)).stdout();
  }

  /** lint, test and build; any failing block fails the call (non-zero exit). */
  @func()
  async ci(src: Directory, base?: string): Promise<string> {
    let ctr = this.workspace(src);
    for (const cmd of ciCommands(base)) ctr = ctr.withExec(cmd);
    return ctr.stdout();
  }
}
