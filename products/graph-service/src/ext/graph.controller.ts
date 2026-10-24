import { BadRequestException, Body, Inject, Controller, Get, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { BadRequest, GraphStore } from './graph.store';

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof BadRequest) throw new BadRequestException(e.message);
    throw e;
  }
}

@Controller()
export class GraphController {
  constructor(@Inject(GraphStore) private readonly store: GraphStore) {}

  @Post('ingest/provenance')
  ingestProvenance(@Body() body: unknown) {
    return guard(() => this.store.ingestProvenance(body));
  }

  @Post('ingest/lockfile')
  ingestLockfile(@Body() body: unknown) {
    return guard(() => this.store.ingestLockfile(body));
  }

  @Get('materials/:name/versions/:version/consumers')
  async consumers(@Param('name') name: string, @Param('version') version: string) {
    const found = await this.store.consumers(name, version);
    if (!found) throw new NotFoundException(`${name}@${version} is not in the graph`);
    return found;
  }

  @Get('materials/:name/versions/:version')
  async version(@Param('name') name: string, @Param('version') version: string) {
    const found = await this.store.versionInfo(name, version);
    if (!found) throw new NotFoundException(`${name}@${version} is not in the graph`);
    return found;
  }

  @Put('materials/:name/versions/:version/state')
  async setState(@Param('name') name: string, @Param('version') version: string, @Body() body: unknown) {
    const found = await guard(() => this.store.setState(name, version, body));
    if (!found) throw new NotFoundException(`${name}@${version} is not in the graph`);
    return found;
  }
}
