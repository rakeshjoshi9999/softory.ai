import { BadRequestException, Controller, Inject, NotFoundException } from '@nestjs/common';
import type { ConsumerDto, LockfileIngestDto, LockfileIngestedDto, ProvenanceIngestedDto, ProvenanceStatementDto, StateChangeDto, VersionInfoDto } from '../generated/graph-api';
import { IngestControllerBase, VersionsControllerBase } from '../generated/graph-api';
import { BadRequest, GraphStore } from './graph.store';

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof BadRequest) throw new BadRequestException(e.message);
    throw e;
  }
}

const notInGraph = (name: string, version: string) => new NotFoundException(`${name}@${version} is not in the graph`);

/** Routes come from the graph-api material's generated base classes; only the logic is hand-written. */
@Controller()
export class IngestController extends IngestControllerBase {
  constructor(@Inject(GraphStore) private readonly store: GraphStore) {
    super();
  }

  ingestProvenance(body: ProvenanceStatementDto): Promise<ProvenanceIngestedDto> {
    return guard(() => this.store.ingestProvenance(body));
  }

  ingestLockfile(body: LockfileIngestDto): Promise<LockfileIngestedDto> {
    return guard(() => this.store.ingestLockfile(body));
  }
}

@Controller()
export class VersionsController extends VersionsControllerBase {
  constructor(@Inject(GraphStore) private readonly store: GraphStore) {
    super();
  }

  async getVersion(name: string, version: string): Promise<VersionInfoDto> {
    const found = await this.store.versionInfo(name, version);
    if (!found) throw notInGraph(name, version);
    return found;
  }

  async listConsumers(name: string, version: string): Promise<ConsumerDto[]> {
    const found = await this.store.consumers(name, version);
    if (!found) throw notInGraph(name, version);
    return found;
  }

  async setVersionState(name: string, version: string, body: StateChangeDto): Promise<VersionInfoDto> {
    const found = await guard(() => this.store.setState(name, version, body));
    if (!found) throw notInGraph(name, version);
    return found;
  }
}
