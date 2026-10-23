import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { ExtModule } from './ext';

@Module({
  imports: [ExtModule],
  controllers: [HealthController],
})
export class AppModule {}
