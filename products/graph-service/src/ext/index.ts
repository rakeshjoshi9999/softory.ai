import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { IngestController, VersionsController } from './graph.controller';
import { GraphStore } from './graph.store';

/** Hand-written code lives in src/ext/. Add providers and controllers here. */
@Module({
  controllers: [IngestController, VersionsController],
  providers: [
    { provide: Pool, useFactory: () => new Pool({ connectionString: process.env['DATABASE_URL'] }) },
    { provide: GraphStore, useFactory: (pool: Pool) => new GraphStore(pool), inject: [Pool] },
  ],
})
export class ExtModule implements OnModuleInit {
  constructor(@Inject(GraphStore) private readonly store: GraphStore) {}

  async onModuleInit(): Promise<void> {
    await this.store.migrate();
  }
}
