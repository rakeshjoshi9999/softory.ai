import { dag, Container, Directory, File, Secret, Service, func, object } from '@dagger.io/dagger';
import { DEPS_IMAGE, POSTGRES_SERVICE, assertWorkspaceEntries, remoteIndexHtml, runtimeInstallCommand, runtimePackageJson, blockCommand, pnpmSetupCommands, ciCommands, imageOutDir, imageSpec, productBuildCommand, scanCommand, SOURCE_EXCLUDES, sbomCommand, signCommand, signImageCommand } from './plan.js';

const NODE_IMAGE = 'node:22-bookworm';
const SYFT_IMAGE = 'anchore/syft:v1.18.1';
const TRIVY_IMAGE = 'aquasec/trivy:0.58.1';
const COSIGN_IMAGE = 'gcr.io/projectsigstore/cosign:v2.4.1';

@object()
export class Factory {
  /** Node + pnpm container with the workspace mounted and dependencies installed. */
  @func()
  async workspace(src: Directory): Promise<Container> {
    assertWorkspaceEntries(await src.entries(), 'the source directory');
    const base = pnpmSetupCommands().reduce((c, argv) => c.withExec(argv), dag.container().from(NODE_IMAGE));
    return base
      .withMountedCache('/root/.local/share/pnpm/store', dag.cacheVolume('pnpm-store'))
      .withDirectory('/work', src, { exclude: [...SOURCE_EXCLUDES] })
      .withWorkdir('/work')
      .withServiceBinding(POSTGRES_SERVICE.alias, this.postgres())
      .withEnvVariable('TEST_DATABASE_URL', POSTGRES_SERVICE.clientEnv.TEST_DATABASE_URL)
      .withExec(['pnpm', 'install', '--frozen-lockfile']);
  }

  /** Pinned PostgreSQL service for tests that need a database. */
  private postgres(): Service {
    const { image, port, env } = POSTGRES_SERVICE;
    return Object.entries(env)
      .reduce((c, [k, v]) => c.withEnvVariable(k, v), dag.container().from(image))
      .withExposedPort(port)
      .asService();
  }

  /** Lint (all projects, or affected ones when `base` is given). */
  @func()
  async lint(src: Directory, base?: string): Promise<string> {
    return (await this.workspace(src)).withExec(blockCommand('lint', base)).stdout();
  }

  /** Unit tests. */
  @func()
  async test(src: Directory, base?: string): Promise<string> {
    return (await this.workspace(src)).withExec(blockCommand('test', base)).stdout();
  }

  /** Build. */
  @func()
  async build(src: Directory, base?: string): Promise<string> {
    return (await this.workspace(src)).withExec(blockCommand('build', base)).stdout();
  }

  /** lint, test and build; any failing block fails the call (non-zero exit). */
  @func()
  async ci(src: Directory, base?: string): Promise<string> {
    let ctr = await this.workspace(src);
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

  /** OCI image of one product: built with Nx, copied onto the kind's runtime base (non-root). */
  @func()
  async image(src: Directory, product: string, kind: string): Promise<Container> {
    const spec = imageSpec(kind);
    const built = (await this.workspace(src)).withExec(productBuildCommand(product));
    let out = built.directory(`/work/${imageOutDir(product)}`);
    if (kind === 'nestjs-service') {
      // production dependencies, installed in a node image because distroless has no npm
      const rootPkg = JSON.parse(await src.file('package.json').contents());
      const deps = dag
        .container()
        .from(DEPS_IMAGE)
        .withWorkdir('/deps')
        .withNewFile('/deps/package.json', runtimePackageJson(rootPkg))
        .withExec(runtimeInstallCommand())
        .directory('/deps/node_modules');
      out = out.withDirectory('node_modules', deps);
    } else {
      out = out.withFile('index.html', built.file(`/work/${remoteIndexHtml(product)}`));
    }
    const ctr = dag
      .container()
      .from(spec.base)
      .withDirectory(spec.dest, out, { owner: spec.user })
      .withUser(spec.user)
      .withExposedPort(spec.port);
    return spec.entrypoint.length > 0 ? ctr.withEntrypoint(spec.entrypoint) : ctr;
  }

  /** Publish the image, then sign the pushed digest with cosign (key from a secret). Returns the digest reference. */
  @func()
  async signedImage(src: Directory, product: string, kind: string, address: string, key: Secret): Promise<string> {
    const ref = await (await this.image(src, product, kind)).publish(address);
    await dag
      .container()
      .from(COSIGN_IMAGE)
      .withSecretVariable('COSIGN_KEY', key)
      .withExec(signImageCommand(ref))
      .sync();
    return ref;
  }

  /** Trivy findings as JSON for an SBOM file (no network image needed) or, when `image` is set, a registry image. */
  @func()
  scan(sbom?: File, image?: string): File {
    if ((sbom === undefined) === (image === undefined)) throw new Error('scan needs exactly one of sbom or image');
    let ctr = dag.container().from(TRIVY_IMAGE).withWorkdir('/in');
    if (sbom !== undefined) ctr = ctr.withMountedFile('/in/sbom.spdx.json', sbom);
    const argv = sbom !== undefined ? scanCommand('sbom', 'sbom.spdx.json') : scanCommand('image', image!);
    return ctr.withExec(argv, { redirectStdout: '/out/findings.json' }).file('/out/findings.json');
  }
}
