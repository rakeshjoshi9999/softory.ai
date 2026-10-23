import { dag, Container, Directory, File, Secret, func, object } from '@dagger.io/dagger';
import { blockCommand, ciCommands, sbomCommand, signCommand } from './plan.js';

const NODE_IMAGE = 'node:22-bookworm';
const SYFT_IMAGE = 'anchore/syft:v1.18.1';
const COSIGN_IMAGE = 'gcr.io/projectsigstore/cosign:v2.4.1';

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

  /** SPDX JSON SBOM of a package tarball, made with Syft. */
  @func()
  sbom(tarball: File, name = 'package.tgz'): File {
    return dag
      .container()
      .from(SYFT_IMAGE)
      .withMountedFile(`/in/${name}`, tarball)
      .withWorkdir('/in')
      .withExec(sbomCommand(name), { redirectStdout: '/out/sbom.spdx.json' })
      .file('/out/sbom.spdx.json');
  }

  /** Detached signature of a tarball (base64, `cosign verify-blob` compatible). The key is a secret, e.g. env:COSIGN_KEY. */
  @func()
  sign(tarball: File, key: Secret, name = 'package.tgz'): File {
    return dag
      .container()
      .from(COSIGN_IMAGE)
      .withMountedFile(`/in/${name}`, tarball)
      .withSecretVariable('COSIGN_KEY', key)
      .withWorkdir('/in')
      .withExec(signCommand(name), { redirectStdout: '/out/package.sig' })
      .file('/out/package.sig');
  }
}
