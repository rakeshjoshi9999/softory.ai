import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { emit, emitter } from '../src/index.js';

const root = resolve(__dirname, '../../..');
const input = resolve(root, 'materials/orders-api/generated/openapi.yaml');
const committed = resolve(root, 'materials/orders-api/generated/nest-server');
const bundle = { name: 'orders-api', type: 'api-contract' as const, specPath: input };
const dirs: string[] = [];
const outDir = async () => {
  const d = await mkdtemp(join(tmpdir(), 'nest-emit-'));
  dirs.push(d);
  return d;
};
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

describe('nest-server emitter', () => {
  it('declares the Emitter contract', () => {
    expect(emitter).toMatchObject({ id: 'nest-server', accepts: ['api-contract'], target: 'nestjs' });
    expect(emitter.emit).toHaveLength(2);
  });

  it('emits class-validator DTOs and one abstract controller per tag', async () => {
    const out = await outDir();
    const { files } = await emit(bundle, { outputDir: out });
    expect(files).toEqual(
      expect.arrayContaining(['dto/order.dto.ts', 'dto/order-line.dto.ts', 'controllers/orders.controller.base.ts']),
    );
    expect(files.filter((f) => f.endsWith('.controller.base.ts'))).toHaveLength(1);
    const dto = await readFile(join(out, 'dto/order.dto.ts'), 'utf8');
    expect(dto).toContain('export class OrderDto');
    expect(dto).toContain('@MinLength(1)');
    expect(dto).toContain('@ArrayMinSize(1)');
    expect(dto).toContain('@ValidateNested({ each: true })');
    const ctrl = await readFile(join(out, 'controllers/orders.controller.base.ts'), 'utf8');
    expect(ctrl).toContain('export abstract class OrdersControllerBase');
    expect(ctrl).toContain('abstract getOrder(id: string)');
    expect(ctrl).toContain("@Get('/orders/:id')");
  });

  it('is byte-identical across runs', async () => {
    const a = await outDir();
    const b = await outDir();
    const ra = await emit(bundle, { outputDir: a });
    const rb = await emit(bundle, { outputDir: b });
    expect(ra.files).toEqual(rb.files);
    for (const f of ra.files) expect(await readFile(join(a, f), 'utf8')).toBe(await readFile(join(b, f), 'utf8'));
  });

  it('matches the committed orders-api server code', async () => {
    const out = await outDir();
    const { files } = await emit(bundle, { outputDir: out });
    for (const f of files) expect(await readFile(join(out, f), 'utf8'), f).toBe(await readFile(join(committed, f), 'utf8'));
  });

  it('compiles a sample service extending the abstract controller', async () => {
    // Scratch dir must sit under the workspace so module resolution finds node_modules.
    const cache = resolve(root, 'node_modules/.cache');
    await mkdir(cache, { recursive: true });
    const out = await mkdtemp(join(cache, 'nest-sample-'));
    dirs.push(out);
    await emit(bundle, { outputDir: out });
    const sample = join(out, 'orders.controller.ts');
    await copyFile(resolve(__dirname, 'fixtures/orders.controller.sample.txt'), sample);
    const program = ts.createProgram([sample], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noUncheckedIndexedAccess: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      skipLibCheck: true,
      noEmit: true,
    });
    const diags = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(diags).toEqual([]);
  });

  it('fails to compile when an abstract operation is not implemented', () => {
    const bad = join(tmpdir(), `bad-${process.pid}.ts`);
    const host = ts.createCompilerHost({});
    const orig = host.readFile.bind(host);
    host.readFile = (f) =>
      f === bad
        ? `import { OrdersControllerBase } from ${JSON.stringify(join(committed, 'index.ts'))};\nexport class X extends OrdersControllerBase {}`
        : orig(f);
    host.fileExists = ((o) => (f: string) => f === bad || o(f))(host.fileExists.bind(host));
    const program = ts.createProgram(
      [bad],
      { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, experimentalDecorators: true, skipLibCheck: true, noEmit: true },
      host,
    );
    expect(ts.getPreEmitDiagnostics(program).length).toBeGreaterThan(0);
  });
});
